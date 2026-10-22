import { getElectronUserAgent } from "@/main/electron-user-agent";
import type { SearchFilterDefinition } from "@/shared/search-filters";
import { Episode, ShowSearchResult } from "@/shared/types";
import {
  parseHlsVideoVariants,
  pickPreferredHlsVariant,
  sortHlsVariantsDescending,
} from "@/shared/utils/hls-master";

import {
  StreamMode,
  StreamProvider,
  StreamQualityOption,
  StreamUrlResult,
} from "../stream-provider";

/**
 * AnimeUnity, Italian-subtitled fallback host.
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
 * Resolution chain:
 *   /archivio?title=X            -> HTML with records="[...]" (JSON, HTML-escaped)
 *   /anime/{id}-{slug}           -> HTML with episodes="[...]"
 *   /embed-url/{episodeId}       -> plain text: the VixCloud embed URL
 *   {player}/embed/...           -> HTML exposing window.masterPlaylist
 *   {player}/playlist/{id}?token=..&expires=..&h=1 -> HLS master
 *
 * The `h=1` parameter is essential: the embed page advertises an `asn` parameter
 * which the API rejects with 403. `h=1` is what the site's own player uses.
 *
 * ## Both hosts move, and they moved at once
 *
 * Verified on 2026-10-17 against public DNS and the live site:
 *
 *   - `www.animeunity.so` no longer resolves at all (NXDOMAIN). The site answers
 *     from `www.animeunity.co`, and the `.it` / `.to` domains redirect there.
 *   - The embed URL the site hands out now points at `vixcloud.cc`, not
 *     `vixcloud.co`, which no longer resolves either.
 *
 * Pinning either name broke every path of this provider at once. Search, episode
 * lists and the "recently uploaded" row all threw `fetch failed`, and the UI could
 * only show that as an empty page: no results in the player's Host menu, nothing
 * in Recently uploaded, and error cards over Continue watching. The site host is
 * therefore resolved at runtime from a candidate list, and the player host is read
 * from the embed URL instead of being assumed.
 */
const CANDIDATE_SITE_BASES = [
  "https://www.animeunity.co",
  "https://www.animeunity.it",
  "https://www.animeunity.to",
] as const;
const SEARCH_LIMIT_PAGES = 1;
const IS_DEV = process.env.NODE_ENV !== "production";

/** A resolved host is reused for this long before being probed again. */
const SITE_BASE_TTL_MS = 30 * 60_000;
/** Probing a dead candidate must not delay the first useful request for long. */
const PROBE_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 20_000;

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

/** One card of the home page "ULTIME AGGIUNTE" list. */
interface LatestUpload {
  providerId: string;
  title: string;
  thumbnail: string | null;
  episodes: number | null;
}

function log(event: string, meta?: Record<string, unknown>): void {
  if (!IS_DEV) return;
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.info(`[animeunity-provider] ${event}${suffix}`);
}

/* -------------------------------------------------------------------------- */
/* Host resolution                                                            */
/* -------------------------------------------------------------------------- */

/** Cached site host plus the moment it was resolved. */
let siteBaseCache: { base: string; at: number } | null = null;
/** In-flight probe, so concurrent requests share one resolution. */
let siteBaseProbe: Promise<string> | null = null;

function siteReferer(base: string): string {
  return `${base}/`;
}

/** Explicit override for tests and for pinning a host without a rebuild. */
function overrideSiteBase(): string | null {
  const override = process.env.ANIMEUNITY_BASE?.trim();
  return override ? override.replace(/\/+$/, "") : null;
}

async function fetchText(
  url: string,
  referer: string,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<string> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "User-Agent": getElectronUserAgent(),
      Referer: referer,
      "X-Requested-With": "XMLHttpRequest",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`AnimeUnity request failed (${response.status}): ${url}`);
  }
  return response.text();
}

/**
 * A host is the site when it answers the archive page with an escaped `records`
 * payload. That single check proves DNS, reachability and the page contract,
 * which is what any later request depends on.
 */
async function hostServesAnimeUnity(base: string): Promise<boolean> {
  try {
    const html = await fetchText(
      `${base}/archivio?title=&page=1`,
      siteReferer(base),
      PROBE_TIMEOUT_MS
    );
    return html.includes("records=");
  } catch {
    return false;
  }
}

async function resolveSiteBase(): Promise<string> {
  const override = overrideSiteBase();
  if (override) return override;

  if (siteBaseCache && Date.now() - siteBaseCache.at < SITE_BASE_TTL_MS) {
    return siteBaseCache.base;
  }

  if (siteBaseProbe === null) {
    siteBaseProbe = (async () => {
      for (const base of CANDIDATE_SITE_BASES) {
        if (await hostServesAnimeUnity(base)) return base;
      }
      throw new Error(
        `AnimeUnity is unreachable: none of ${CANDIDATE_SITE_BASES.join(", ")} answered. ` +
          "Set ANIMEUNITY_BASE to pin a host."
      );
    })().finally(() => {
      siteBaseProbe = null;
    });
  }

  const base = await siteBaseProbe;
  siteBaseCache = { base, at: Date.now() };
  return base;
}

function forgetSiteBase(): void {
  siteBaseCache = null;
}

/**
 * `fetch()` rejects with a `TypeError` when the host cannot be reached at all
 * (DNS failure, connection reset). An HTTP error is reported by `fetchText` as a
 * plain `Error` and must not be retried elsewhere: the host answered, so another
 * candidate would only produce the same status and a slower failure.
 */
function isUnreachableHostError(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Run one request against the resolved site host, re-resolving once if that host
 * has become unreachable since it was cached.
 */
async function withSiteHost<T>(run: (base: string) => Promise<T>): Promise<T> {
  const base = await resolveSiteBase();
  try {
    return await run(base);
  } catch (error) {
    if (!isUnreachableHostError(error)) throw error;
    forgetSiteBase();
    const next = await resolveSiteBase();
    if (next === base) throw error;
    return run(next);
  }
}

/**
 * Origin of the player host that serves the embed, or null when the embed URL is
 * not VixCloud-shaped.
 *
 * Read from the URL rather than pinned: VixCloud moved from `.co` to `.cc` and a
 * pinned value made every AnimeUnity stream fail with "unexpected embed URL".
 */
function playerOriginFromEmbed(embedUrl: string): string | null {
  try {
    const url = new URL(embedUrl);
    if (!/^vixcloud\.[a-z.]+$/i.test(url.hostname)) return null;
    if (!url.pathname.startsWith("/embed/")) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Spell a title the way the archive search actually accepts it.
 *
 * The search is literal about typography: it answers with zero records for
 * "Frieren: Beyond Journey’s End" (typographic apostrophe) and with the full list
 * for "Frieren: Beyond Journey's End" (ASCII apostrophe). Measured in the app log
 * while switching host mid-episode, where the renderer had to spend three of its
 * title spellings before one matched.
 *
 * Since the in-player host switch has a fixed budget of title variants, handing it
 * a query the server cannot match made a working switch look broken.
 */
function toSearchableQuery(query: string): string {
  return query
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .trim();
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

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse the home page "ULTIME AGGIUNTE" (latest added) list.
 *
 * Every card is a `div.latest-anime-container`, server-rendered, carrying the
 * show link (`/anime/{id}-{slug}`), the poster, the title in a `<strong>` and a
 * line such as `24 min - 23 Episodi`. Splitting on the class name is enough to
 * isolate one card per chunk and avoids depending on the surrounding wrappers,
 * which differ between the home page and the archive page.
 */
function parseLatestUploads(html: string): LatestUpload[] {
  const chunks = html.split("latest-anime-container").slice(1);
  const uploads: LatestUpload[] = [];

  for (const chunk of chunks) {
    const providerId = /href="(?:https?:\/\/[^"]+?)?\/anime\/([^"?#]+)/.exec(chunk)?.[1];
    const rawTitle =
      /<strong[^>]*class="[^"]*latest-anime-title[^"]*"[^>]*>([\s\S]*?)<\/strong>/.exec(chunk)?.[1];
    if (!providerId || !rawTitle) continue;

    const title = stripTags(decodeHtmlEntities(rawTitle));
    if (!title) continue;

    const thumbnail = /<img[^>]*\ssrc="([^"]+)"/.exec(chunk)?.[1] ?? null;
    const episodeCount = /(\d+)\s*Episod/i.exec(chunk)?.[1];

    uploads.push({
      providerId: decodeHtmlEntities(providerId).trim(),
      title,
      thumbnail: thumbnail ? decodeHtmlEntities(thumbnail).trim() : null,
      episodes: episodeCount ? Number.parseInt(episodeCount, 10) : null,
    });
  }

  return uploads;
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

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

function absolutePosterUrl(ref: string | null | undefined, base: string): string | null {
  const value = ref?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const sep = value.startsWith("/") ? "" : "/";
  return `${base}${sep}${value}`;
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

/** Home page cards carry no `dub` flag, so the slug and the title decide. */
function isSubItaUpload(upload: LatestUpload): boolean {
  if (/-ita$/i.test(upload.providerId)) return false;
  return !/\(ita\)\s*$/i.test(upload.title);
}

function mapRecordToSearchResult(record: AnimeUnityRecord, base: string): ShowSearchResult | null {
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
    thumbnail: absolutePosterUrl(record.imageurl, base),
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
  private async fetchArchive(
    title: string,
    page: number
  ): Promise<{ records: AnimeUnityRecord[]; base: string }> {
    const startedAt = Date.now();
    const result = await withSiteHost(async (base) => {
      const query = new URLSearchParams({ title, page: String(page) });
      const html = await fetchText(`${base}/archivio?${query.toString()}`, siteReferer(base));
      return { records: parseArchiveRecords(html), base };
    });
    log("archive:done", {
      title,
      page,
      records: result.records.length,
      ms: Date.now() - startedAt,
    });
    return result;
  }

  private async fetchAnimePage(providerId: string): Promise<{
    anime: AnimeUnityAnime | null;
    episodes: AnimeUnityEpisode[];
    base: string;
  }> {
    return withSiteHost(async (base) => {
      const html = await fetchText(`${base}/anime/${providerId}`, siteReferer(base));
      return { ...parseAnimePage(html), base };
    });
  }

  /**
   * Resolve the HLS master for one episode.
   *
   * Two hops are needed because AnimeUnity delegates playback to VixCloud. The
   * `h=1` parameter is the one that actually works: the embed page publishes an
   * `asn` parameter instead, and requesting with it returns 403.
   */
  private async resolveMasterUrl(episodeId: number): Promise<{
    masterUrl: string;
    playerReferer: string;
  }> {
    const startedAt = Date.now();
    const lookup = await withSiteHost(async (base) => ({
      embedUrl: (
        await fetchText(`${base}/embed-url/${String(episodeId)}`, siteReferer(base))
      ).trim(),
      siteUrl: base,
    }));

    const playerOrigin = playerOriginFromEmbed(lookup.embedUrl);
    if (!playerOrigin) {
      throw new Error(
        `AnimeUnity returned an unexpected embed URL: ${lookup.embedUrl.slice(0, 120)}`
      );
    }
    const playerReferer = `${playerOrigin}/`;

    // The embed page is still requested with the site as its referer, which is
    // what the site's own iframe produces.
    const embedHtml = await fetchText(lookup.embedUrl, siteReferer(lookup.siteUrl));
    const decoded = decodeHtmlEntities(embedHtml);

    // The embed page declares its stream as an inline JS object:
    //
    //   window.masterPlaylist = {
    //     params: { 'token': '...', 'expires': '...', 'asn': '', },
    //     url: 'https://vixcloud.cc/playlist/326682',
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
    // `https://vixcloud.cc/playlist/{id}?b=1`, and that flag is load-bearing:
    // requesting the same playlist without it returns 403. Appending with a
    // second `?` (`...?b=1?token=…`) makes the server read the whole thing as the
    // value of `b`, which is also a 403, so merge the query properly instead of
    // concatenating. Verified against the live CDN for episode 110629
    // (The Ramparts of Ice S2 ep 3): `?b=1&token=…` -> 200 with a 1080p ladder,
    // `?b=1?token=…` and `?token=…` (dropping `b`) -> 403.
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
    log("master:resolved", { episodeId, player: playerOrigin, ms: Date.now() - startedAt });
    return { masterUrl, playerReferer };
  }

  getSearchFilters(): SearchFilterDefinition[] {
    return [];
  }

  async search(query: string): Promise<ShowSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.getRecentUploads(1, 24, "sub");
    }

    // ASCII spelling first, the literal one only as a fallback: see
    // `toSearchableQuery` for the measured reason.
    const spellings = [...new Set([toSearchableQuery(trimmed), trimmed])].filter(
      (spelling) => spelling.length > 0
    );

    for (const spelling of spellings) {
      const results: ShowSearchResult[] = [];
      for (let page = 1; page <= SEARCH_LIMIT_PAGES; page += 1) {
        const { records, base } = await this.fetchArchive(spelling, page);
        if (records.length === 0) break;
        for (const record of records) {
          // Only the Italian-subtitled release of each show is offered.
          if (!isSubItaRecord(record)) continue;
          const mapped = mapRecordToSearchResult(record, base);
          if (mapped) results.push(mapped);
        }
      }
      if (results.length > 0) return results;
    }

    return [];
  }

  /**
   * "Recently uploaded" for this host.
   *
   * The archive endpoint is not sorted by recency: with an empty query it returns
   * the default catalogue order, whose first page starts with shows from 2023, so
   * it cannot stand in for a "recent" row. The site's own recency list is the
   * "ULTIME AGGIUNTE" block on the home page, which is what is parsed here.
   *
   * The archive is still used as a fallback, and only when the home page yields
   * no usable card, so a cosmetic layout change cannot empty the row.
   */
  async getRecentUploads(page: number, limit = 24, mode: StreamMode = "sub"): Promise<Episode[]> {
    if (page > 1) return [];
    const wanted = Math.max(1, limit);

    const latest = await withSiteHost(async (base) => {
      const html = await fetchText(siteReferer(base), siteReferer(base));
      return parseLatestUploads(html).map((upload) => ({
        ...upload,
        thumbnail: absolutePosterUrl(upload.thumbnail, base),
      }));
    });

    const subIta = latest.filter(isSubItaUpload);
    if (subIta.length > 0) {
      log("recent:home", { cards: latest.length, subIta: subIta.length });
      return subIta.slice(0, wanted).map((upload) => ({
        id: upload.providerId,
        providerId: upload.providerId,
        title: { english: upload.title, romanji: upload.title },
        thumbnail: upload.thumbnail,
        index: upload.episodes && upload.episodes > 0 ? upload.episodes : 1,
        mode,
      }));
    }

    return this.recentUploadsFromArchive(wanted, mode);
  }

  private async recentUploadsFromArchive(wanted: number, mode: StreamMode): Promise<Episode[]> {
    const { records, base } = await this.fetchArchive("", 1);
    const usable = records
      .filter(isSubItaRecord)
      .map((record) => ({ record, providerId: toProviderId(record) }))
      .filter(
        (entry): entry is { record: AnimeUnityRecord; providerId: string } =>
          entry.providerId != null
      );
    log("recent:archive-fallback", { records: records.length, usable: usable.length });

    return usable.slice(0, wanted).map(({ record, providerId }) => {
      const anilistId = Number.isInteger(record.anilist_id) ? record.anilist_id : null;
      const totalEps = record.real_episodes_count ?? record.episodes_count ?? 0;
      return {
        id: anilistId && anilistId > 0 ? String(anilistId) : providerId,
        providerId,
        title: {
          english: record.title_eng?.trim() || record.title?.trim() || providerId,
          romanji: record.title?.trim() || undefined,
        },
        thumbnail: absolutePosterUrl(record.imageurl, base),
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
    const { anime, episodes, base } = await this.fetchAnimePage(providerId);
    if (!anime) {
      throw new Error(`AnimeUnity show not found: ${providerId}`);
    }
    const anilistId = Number.isInteger(anime.anilist_id) ? anime.anilist_id : null;
    const title = anime.title_eng?.trim() || anime.title?.trim() || String(anime.id ?? providerId);

    log("show:details", { providerId, episodes: episodes.length });
    return {
      id: anilistId && anilistId > 0 ? String(anilistId) : providerId,
      providerId,
      name: title,
      thumbnail: absolutePosterUrl(anime.imageurl, base),
      type: anime.type?.trim() || "TV",
      description: anime.plot?.trim() || null,
    };
  }

  async getStreamUrl(
    _id: string | null,
    providerId: string | null,
    episode: string
  ): Promise<StreamUrlResult> {
    if (!providerId) {
      throw new Error("AnimeUnity requires a providerId");
    }

    const { anime, episodes } = await this.fetchAnimePage(providerId);
    if (episodes.length === 0) {
      throw new Error(`AnimeUnity has no episodes for ${providerId}`);
    }

    // Episodes are matched on the displayed `number`, which is the sequential
    // index the sidebar uses, not the absolute numbering inside `link`
    // (e.g. "DAN.DA.DAN.S03E13..." for what the UI calls episode 1).
    const wanted = episode.trim();
    const match =
      episodes.find((e) => String(e.number ?? "").trim() === wanted) ??
      episodes.find((e) => String(e.number ?? "").trim() === String(Number.parseInt(wanted, 10)));

    if (!match || !Number.isInteger(match.id)) {
      throw new Error(`AnimeUnity episode ${wanted} not found for ${providerId}`);
    }

    const { masterUrl, playerReferer } = await this.resolveMasterUrl(match.id);

    const masterResponse = await fetch(masterUrl, {
      headers: {
        Accept: "*/*",
        "User-Agent": getElectronUserAgent(),
        Referer: playerReferer,
        Origin: playerReferer.slice(0, -1),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      referer: playerReferer,
      // Subtitles are burned into the video; there is no track to expose.
      subtitles: undefined,
      qualities,
      selectedQuality,
      // VixCloud serves the master from `/playlist/{id}` with no `.m3u8`
      // suffix, which the suffix-based playlist detection cannot see.
      isHlsMaster: true,
      anilistMediaId: Number.isInteger(anime?.anilist_id)
        ? (anime?.anilist_id ?? undefined)
        : undefined,
    };
  }
}
