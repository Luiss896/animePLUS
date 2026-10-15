import { getElectronUserAgent } from "@/main/electron-user-agent";
import type { SearchFilterDefinition } from "@/shared/search-filters";
import { Episode, ShowSearchResult } from "@/shared/types";
import {
  parseHlsVideoVariants,
  pickPreferredHlsVariant,
  sortHlsVariantsDescending,
} from "@/shared/utils/hls-master";

import { StreamMode, StreamProvider, StreamQualityOption, StreamUrlResult } from "../stream-provider";

/**
 * AnimeUnity — Italian-subtitled fallback host.
 *
 * Why this provider exists: the other sources are not guaranteed to carry
 * Italian subtitles. AnimeUnity publishes two separate entries per show, and the
 * `dub` flag distinguishes them exactly:
 *
 *   dub = 0  ->  "...1080p.CR.WEB-DL.JPN.AAC2.0.H.264.mkv"   Japanese audio + Italian subs
 *   dub = 1  ->  "...1080p.NF.WEB-DL.ITA.AAC2.0.H.264.mkv"   Italian dub
 *
 * Only `dub = 0` is used here, which is what "SUB ITA with Japanese audio" means.
 * The subtitles are burned into the video, so there is no subtitle track to
 * expose and the player's subtitle selector stays empty for this host.
 *
 * Resolution chain (all verified against the live site):
 *   /archivio?title=X            -> HTML with records="[...]" (JSON, HTML-escaped)
 *   /anime/{id}-{slug}           -> HTML with episodes="[...]"
 *   /embed-url/{episodeId}       -> plain text: the VixCloud embed URL
 *   vixcloud.co/embed/...        -> HTML exposing window.masterPlaylist
 *   vixcloud.co/playlist/{id}?token=..&expires=..&h=1 -> HLS master
 *
 * The `h=1` parameter is essential: the embed page advertises an `asn` parameter
 * which the API rejects with 403. `h=1` is what the site's own player uses.
 */
const API = process.env.ANIMEUNITY_BASE || "https://www.animeunity.so";
const SITE_REFERER = `${API.replace(/\/$/, "")}/`;
/** VixCloud rejects requests without a matching Referer/Origin. */
const VIX_REFERER = "https://vixcloud.co/";
const SEARCH_LIMIT_PAGES = 1;
const IS_DEV = process.env.NODE_ENV !== "production";

interface AnimeUnityRecord {
  id?: number;
  title?: string | null;
  title_eng?: string | null;
  title_it?: string | null;
  imageurl?: string | null;
  plot?: string | null;
  date?: string | null;
  episodes_count?: number | null;
  real_episodes_count?: number | null;
  status?: string | null;
  type?: string | null;
  slug?: string | null;
  score?: string | null;
  season?: string | null;
  /** 0 = Japanese audio with Italian subs, 1 = Italian dub. */
  dub?: number | null;
  anilist_id?: number | null;
  mal_id?: number | null;
}

interface AnimeUnityEpisode {
  id?: number;
  number?: string | number | null;
  link?: string | null;
  file_name?: string | null;
  created_at?: string | null;
  scws_id?: number | null;
}

interface AnimeUnityAnime {
  id?: number;
  title?: string | null;
  imageurl?: string | null;
  plot?: string | null;
  date?: string | null;
  episodes_count?: number | null;
  status?: string | null;
  type?: string | null;
  slug?: string | null;
  title_eng?: string | null;
  anilist_id?: number | null;
}

function log(event: string, meta?: Record<string, unknown>): void {
  if (!IS_DEV) return;
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.info(`[animeunity-provider] ${event}${suffix}`);
}

/* -------------------------------------------------------------------------- */
/* HTML parsing                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Decode the entities AnimeUnity uses inside its HTML attributes.
 *
 * The site embeds JSON in attributes such as `records="{&quot;id&quot;:1,...}"`,
 * so every quote arrives escaped and the raw attribute value contains no literal
 * `"`. That is what makes a simple `[^"]*` capture safe here.
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\\\//g, "/");
}

function parseJsonAttribute<T>(html: string, attribute: string): T | null {
  const match = html.match(new RegExp(`${attribute}="([^"]*)"`));
  if (!match?.[1]) return null;
  const decoded = decodeHtmlEntities(match[1]);
  try {
    return JSON.parse(decoded) as T;
  } catch (error: unknown) {
    log("parse:failed", {
      attribute,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Archive rows come wrapped in a custom `<archivio records="...">` element. */
function parseArchiveRecords(html: string): AnimeUnityRecord[] {
  return parseJsonAttribute<AnimeUnityRecord[]>(html, "records") ?? [];
}

function parseAnimePage(html: string): {
  anime: AnimeUnityAnime | null;
  episodes: AnimeUnityEpisode[];
} {
  const anime = parseJsonAttribute<AnimeUnityAnime>(html, "anime");
  const episodes = parseJsonAttribute<AnimeUnityEpisode[]>(html, "episodes") ?? [];
  return { anime, episodes };
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function mapStatus(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  if (v.includes("corso") || v.includes("airing") || v.includes("current")) return "RELEASING";
  if (v.includes("terminato") || v.includes("finished")) return "FINISHED";
  if (v.includes("non ancora") || v.includes("not yet")) return "NOT_YET_RELEASED";
  if (v.includes("cancell")) return "CANCELLED";
  return raw;
}

const SEASON_BY_ITALIAN: Record<string, string> = {
  inverno: "WINTER",
  primavera: "SPRING",
  estate: "SUMMER",
  autunno: "FALL",
};

function mapSeason(record: {
  season?: string | null;
  date?: string | null;
}): ShowSearchResult["season"] | undefined {
  const raw = record.season?.trim().toLowerCase() ?? "";
  const quarter = SEASON_BY_ITALIAN[raw];
  const year = Number.parseInt(record.date ?? "", 10);
  if (!quarter && !Number.isFinite(year)) return undefined;
  return {
    quarter,
    year: Number.isFinite(year) && year > 0 ? year : undefined,
  };
}

function parseScore(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(Math.round(value * 10), 100);
}

function absolutePosterUrl(ref: string | null | undefined): string | null {
  const value = ref?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const sep = value.startsWith("/") ? "" : "/";
  return `${API}${sep}${value}`;
}

/** The URL path segment used by the site: `{id}-{slug}`. */
function toProviderId(record: AnimeUnityRecord): string | null {
  if (!Number.isInteger(record.id) || (record.id ?? 0) <= 0) return null;
  const slug = record.slug?.trim();
  return slug ? `${record.id}-${slug}` : String(record.id);
}

/**
 * Keep only the Italian-subtitled entry.
 *
 * `dub = 1` is the Italian dub, which this provider deliberately excludes: the
 * whole point is guaranteeing Italian subtitles over the original Japanese
 * audio. The `-ita` slug suffix is the same signal in URL form, so a record
 * missing the numeric flag is still rejected when its slug gives it away.
 */
function isSubItaRecord(record: AnimeUnityRecord): boolean {
  if (record.dub === 1) return false;
  const slug = record.slug?.trim().toLowerCase() ?? "";
  return !slug.endsWith("-ita");
}

function mapRecordToSearchResult(record: AnimeUnityRecord): ShowSearchResult | null {
  const providerId = toProviderId(record);
  if (!providerId) return null;

  const titleIt = record.title_it?.trim?.() ?? null;
  const english = record.title_eng?.trim() || record.title?.trim() || providerId;
  const romanji = record.title?.trim() || undefined;
  const anilistId = Number.isInteger(record.anilist_id) ? record.anilist_id : null;
  const totalEps = record.real_episodes_count ?? record.episodes_count ?? null;

  return {
    id: anilistId && anilistId > 0 ? String(anilistId) : providerId,
    providerId,
    title: {
      english: titleIt ?? english,
      romanji,
    },
    thumbnail: absolutePosterUrl(record.imageurl),
    availableEpisodes: {
      sub: totalEps && totalEps > 0 ? totalEps : undefined,
      // This provider only exposes the Italian-subtitled releases.
      dub: undefined,
    },
    score: parseScore(record.score),
    status: mapStatus(record.status),
    type: record.type?.trim() || undefined,
    season: mapSeason(record),
  };
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

export class AnimeUnityStreamProvider implements StreamProvider {
  private async fetchText(url: string, referer: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "User-Agent": getElectronUserAgent(),
        Referer: referer,
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!response.ok) {
      throw new Error(`AnimeUnity request failed (${response.status}): ${url}`);
    }
    return response.text();
  }

  private async fetchArchive(title: string, page: number): Promise<AnimeUnityRecord[]> {
    const startedAt = Date.now();
    const query = new URLSearchParams({ title, page: String(page) });
    const html = await this.fetchText(`${API}/archivio?${query.toString()}`, SITE_REFERER);
    const records = parseArchiveRecords(html);
    log("archive:done", { title, page, records: records.length, ms: Date.now() - startedAt });
    return records;
  }

  private async fetchAnimePage(providerId: string): Promise<{
    anime: AnimeUnityAnime | null;
    episodes: AnimeUnityEpisode[];
  }> {
    const html = await this.fetchText(`${API}/anime/${providerId}`, SITE_REFERER);
    return parseAnimePage(html);
  }

  /**
   * Resolve the HLS master for one episode.
   *
   * Two hops are needed because AnimeUnity delegates playback to VixCloud. The
   * `h=1` parameter is the one that actually works: the embed page publishes an
   * `asn` parameter instead, and requesting with it returns 403.
   */
  private async resolveMasterUrl(episodeId: number): Promise<{ masterUrl: string }> {
    const startedAt = Date.now();
    const embedUrl = (
      await this.fetchText(`${API}/embed-url/${String(episodeId)}`, SITE_REFERER)
    ).trim();

    if (!/^https?:\/\/vixcloud\.co\/embed\//i.test(embedUrl)) {
      throw new Error(`AnimeUnity returned an unexpected embed URL: ${embedUrl.slice(0, 120)}`);
    }

    const embedHtml = await this.fetchText(embedUrl, SITE_REFERER);
    const decoded = decodeHtmlEntities(embedHtml);

    // The embed page declares its stream as an inline JS object:
    //
    //   window.masterPlaylist = {
    //     params: { 'token': '...', 'expires': '...', 'asn': '', },
    //     url: 'https://vixcloud.co/playlist/326682',
    //   }
    //   window.canPlayFHD = true
    //
    // A brace-matching regex is not usable here: `params` closes with `},`
    // before `url` appears, so any "stop at the first closing brace" pattern
    // truncates the object before the URL. Slice from the assignment to the next
    // statement instead, then read the three fields independently.
    const marker = "window.masterPlaylist";
    const markerAt = decoded.indexOf(marker);
    if (markerAt < 0) {
      throw new Error("AnimeUnity embed page did not expose a master playlist");
    }
    const afterMarker = decoded.slice(markerAt + marker.length);
    const nextStatementAt = afterMarker.search(/\n\s*window\./);
    const block = nextStatementAt >= 0 ? afterMarker.slice(0, nextStatementAt) : afterMarker;

    const baseUrl = block.match(/\burl:\s*'([^']+)'/)?.[1];
    const token = block.match(/'token':\s*'([^']+)'/)?.[1];
    const expires = block.match(/'expires':\s*'([^']+)'/)?.[1];

    if (!baseUrl || !token || !expires) {
      log("master:extract-failed", { episodeId, blockLength: block.length });
      throw new Error("AnimeUnity embed page did not expose a master playlist");
    }

    // The `url` is not always bare: VixCloud serves some episodes from
    // `https://vixcloud.co/playlist/{id}?b=1`, and that flag is load-bearing —
    // requesting the same playlist without it returns 403. Appending with a
    // second `?` (`...?b=1?token=…`) makes the server read the whole thing as the
    // value of `b`, which is also a 403, so merge the query properly instead of
    // concatenating. Verified against the live CDN for episode 110629
    // (The Ramparts of Ice S2 ep 3): `?b=1&token=…` → 200 with a 1080p ladder,
    // `?b=1?token=…` and `?token=…` (dropping `b`) → 403.
    const masterUrl = (() => {
      try {
        const url = new URL(baseUrl);
        url.searchParams.set("token", token);
        url.searchParams.set("expires", expires);
        url.searchParams.set("h", "1");
        return url.toString();
      } catch {
        return `${baseUrl}?token=${token}&expires=${expires}&h=1`;
      }
    })();
    log("master:resolved", { episodeId, ms: Date.now() - startedAt });
    return { masterUrl };
  }

  getSearchFilters(): SearchFilterDefinition[] {
    return [];
  }

  async search(query: string): Promise<ShowSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.getRecentUploads(1, 24, "sub");
    }

    const results: ShowSearchResult[] = [];
    for (let page = 1; page <= SEARCH_LIMIT_PAGES; page += 1) {
      const records = await this.fetchArchive(trimmed, page);
      if (records.length === 0) break;
      for (const record of records) {
        // Only the Italian-subtitled release of each show is offered.
        if (!isSubItaRecord(record)) continue;
        const mapped = mapRecordToSearchResult(record);
        if (mapped) results.push(mapped);
      }
    }
    return results;
  }

  async getRecentUploads(page: number, limit = 24, mode: StreamMode = "sub"): Promise<Episode[]> {
    if (page > 1) return [];
    const records = await this.fetchArchive("", page);
    const usable = records.filter((r) => isSubItaRecord(r) && toProviderId(r) != null);

    return usable.slice(0, Math.max(1, limit)).map((record) => {
      const providerId = toProviderId(record)!;
      const anilistId = Number.isInteger(record.anilist_id) ? record.anilist_id : null;
      const totalEps = record.real_episodes_count ?? record.episodes_count ?? 0;
      return {
        id: anilistId && anilistId > 0 ? String(anilistId) : providerId,
        providerId,
        title: {
          english: record.title_eng?.trim() || record.title?.trim() || providerId,
          romanji: record.title?.trim() || undefined,
        },
        thumbnail: absolutePosterUrl(record.imageurl),
        index: totalEps > 0 ? totalEps : 1,
        mode,
      };
    });
  }

  async getEpisodesList(providerId: string): Promise<string[]> {
    const { episodes } = await this.fetchAnimePage(providerId);

    const labels = new Set<string>();
    for (const episode of episodes) {
      const number = episode.number;
      if (number == null) continue;
      const label = String(number).trim();
      if (label) labels.add(label);
    }

    return [...labels].sort((a, b) => {
      const na = Number.parseFloat(a);
      const nb = Number.parseFloat(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }

  async getShowDetails(providerId: string): Promise<{
    id: string;
    providerId: string;
    name: string;
    thumbnail: string | null;
    type: string;
    description: string | null;
  }> {
    const { anime, episodes } = await this.fetchAnimePage(providerId);
    if (!anime) {
      throw new Error(`AnimeUnity show not found: ${providerId}`);
    }
    const anilistId = Number.isInteger(anime.anilist_id) ? anime.anilist_id : null;
    const title =
      anime.title_eng?.trim() || anime.title?.trim() || String(anime.id ?? providerId);

    log("show:details", { providerId, episodes: episodes.length });
    return {
      id: anilistId && anilistId > 0 ? String(anilistId) : providerId,
      providerId,
      name: title,
      thumbnail: absolutePosterUrl(anime.imageurl),
      type: anime.type?.trim() || "TV",
      description: anime.plot?.trim() || null,
    };
  }

  async getStreamUrl(
    _id: string | null,
    providerId: string | null,
    episode: string,
    _mode: StreamMode
  ): Promise<StreamUrlResult> {
    if (!providerId) {
      throw new Error("AnimeUnity requires a providerId");
    }

    const { anime, episodes } = await this.fetchAnimePage(providerId);
    if (episodes.length === 0) {
      throw new Error(`AnimeUnity has no episodes for ${providerId}`);
    }

    // Episodes are matched on the displayed `number`, which is the sequential
    // index the sidebar uses — not the absolute numbering inside `link`
    // (e.g. "DAN.DA.DAN.S03E13..." for what the UI calls episode 1).
    const wanted = episode.trim();
    const match =
      episodes.find((e) => String(e.number ?? "").trim() === wanted) ??
      episodes.find((e) => String(e.number ?? "").trim() === String(Number.parseInt(wanted, 10)));

    if (!match || !Number.isInteger(match.id)) {
      throw new Error(`AnimeUnity episode ${wanted} not found for ${providerId}`);
    }

    const { masterUrl } = await this.resolveMasterUrl(match.id!);

    const masterResponse = await fetch(masterUrl, {
      headers: {
        Accept: "*/*",
        "User-Agent": getElectronUserAgent(),
        Referer: VIX_REFERER,
        Origin: VIX_REFERER.slice(0, -1),
      },
    });
    if (!masterResponse.ok) {
      throw new Error(`AnimeUnity master playlist failed (${masterResponse.status})`);
    }
    const master = await masterResponse.text();
    if (!master.trimStart().startsWith("#EXTM3U")) {
      throw new Error("AnimeUnity master playlist was not a valid HLS manifest");
    }

    const variants = parseHlsVideoVariants(master);
    let qualities: StreamQualityOption[] | undefined;
    let selectedQuality: string | undefined;
    if (variants.length > 0) {
      const preferred = pickPreferredHlsVariant(variants);
      qualities = sortHlsVariantsDescending(variants).map((v) => ({
        id: v.uri,
        label: v.label,
        height: v.height ?? undefined,
        bandwidth: v.bandwidth ?? undefined,
      }));
      selectedQuality = preferred?.uri;
    }

    log("stream:resolved", {
      providerId,
      episode: wanted,
      episodeId: match.id,
      qualities: qualities?.map((q) => q.label) ?? null,
      hasItalianSubs: true,
      anilistMediaId: anime?.anilist_id ?? null,
    });

    return {
      url: masterUrl,
      // VixCloud checks this Referer on both the playlist and the segments.
      referer: VIX_REFERER,
      // Subtitles are burned into the video; there is no track to expose.
      subtitles: undefined,
      qualities,
      selectedQuality,
      // VixCloud serves the master from `/playlist/{id}` with no `.m3u8`
      // suffix, which the suffix-based playlist detection cannot see.
      isHlsMaster: true,
      anilistMediaId: Number.isInteger(anime?.anilist_id) ? anime?.anilist_id ?? undefined : undefined,
    };
  }
}
