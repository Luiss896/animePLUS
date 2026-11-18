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
 * Italian subtitles, and AnimeUnity always has them. The site publishes each
 * show once, with one entry per audio variant: `jpn` (original Japanese audio
 * with Italian subtitles burned into the video — the "SUB ITA" release) and
 * `ita` (Italian dub). Only the sub-ITA release is used here, which is what the
 * provider has always promised; the dub entries are filtered out so search and
 * episode lists keep meaning the same thing.
 *
 * ## The site was rewritten in November 2026, and its API with it
 *
 * The previous revision of this file scraped the old server-rendered site. On
 * 2026-11-18 that site is gone: every old endpoint answers 404 on the new origin,
 * so the domain change alone was not the whole story. What the provider uses now,
 * verified against the live site end to end:
 *
 *   /api/archive?query=X&page=N -> JSON: the catalogue search. Records carry the
 *                                  `anilist_id` that cross-host matching needs.
 *   /api/anime/{id}/episodes    -> JSON: `{ episodes, start, tab_size, total }`,
 *                                  urchins of `tab_size` (120) episodes.
 *   /anime/{id}-{slug}          -> page whose Inertia `data-page` payload has the
 *                                  show (`anime`) for the details page.
 *   /anime/{id}-{slug}/{video}  -> page whose payload has `embedUrl`: the VixCloud
 *                                  player URL for exactly that video.
 *   {player}/embed/...          -> HTML exposing `window.masterPlaylist`.
 *   {player}/playlist/{id}?token=..&expires=..&h=1 -> HLS master.
 *
 * The `h=1` parameter is still essential: without it VixCloud answers 403 (only
 * `canPlayFHD=1` in the embed URL is not enough). The sub-ITA stream has no
 * separate subtitle track — the subtitles are burned in, as before — so the
 * player's subtitle selector stays empty for this host.
 *
 * ## The host moves often, so it is discovered, not pinned
 *
 * AnimeUnity changes TLD and its old domains keep redirecting to the new one for
 * a while. Hard-coding either end of that chain is what broke this provider every
 * time: `.so` -> `.co` in October, `.co` -> `.cx` in November. The host is
 * therefore resolved at runtime, and the resolution survives a move:
 *
 *   1. `ANIMEUNITY_BASE` pins a host explicitly (tests, emergencies).
 *   2. A resolved host is cached for {@link SITE_BASE_TTL_MS}.
 *   3. The current known host is probed; requests follow redirects and the
 *      *final* origin is kept, so any old domain still redirecting is enough.
 *   4. The historical domains are probed in parallel, same way.
 *   5. Only if nothing answers, `animeunity.<tld>` is swept across a list of
 *      plausible TLDs.
 *
 * Every candidate must answer `/api/archive` with the real catalogue contract —
 * a redirect to the current host passes, a parked or impostor `animeunity.*`
 * domain (there are many) does not. The sweep additionally demands the
 * catalogue fingerprint (Frieren on AniList id 154587) so an unrelated site can
 * never win. When a cached host starts failing mid-session, the failure path
 * re-resolves and retries once on the new origin.
 */
const SEARCH_LIMIT_PAGES = 1;
const IS_DEV = process.env.NODE_ENV !== "production";

/** A resolved host is reused for this long before being probed again. */
const SITE_BASE_TTL_MS = 30 * 60_000;
/** Probing one host must not delay the first useful request for long. */
const PROBE_TIMEOUT_MS = 8_000;
const REQUEST_TIMEOUT_MS = 20_000;
/** The episodes endpoint returns 120 episodes at a time. */
const EPISODES_PER_PAGE = 120;
/** Hard stop for pathological shows; 40 pages is 4800 episodes. */
const EPISODES_MAX_PAGES = 40;
const EPISODES_CACHE_TTL_MS = 10 * 60_000;
const EPISODES_CACHE_MAX_ENTRIES = 40;

/**
 * The catalogue record used as a domain fingerprint: Frieren is on AniList as
 * media 154587 and the site stores that same id in every archive record. A probe
 * only accepts a swept candidate when this record is present.
 */
const PROBE_QUERY = "frieren";
const PROBE_ANILIST_ID = 154587;

/**
 * Hostname probed first. It is the canonical origin as of 2026-11-18 and serves
 * both the site and its API from the apex domain (there is no `www`).
 */
const CURRENT_SITE_HOST = "animeunity.cx";

/**
 * Hostnames that have served AnimeUnity over time. Every live one currently
 * answers with a redirect to the current origin, and the probe keeps the final
 * origin — which is what makes this list survive a move without being edited:
 * an old domain only has to keep redirecting.
 */
const KNOWN_SITE_HOSTS = [
  "animeunity.co",
  "www.animeunity.co",
  "animeunity.it",
  "www.animeunity.it",
  "animeunity.to",
  "www.animeunity.to",
  "animeunity.tv",
  "www.animeunity.tv",
  "animeunity.gg",
  "www.animeunity.gg",
  "animeunity.net",
  "www.animeunity.net",
  "animeunity.so", // oldest known, NXDOMAIN since 2026-10
  "www.animeunity.so",
] as const;

/**
 * TLDs swept when no known domain answers any more. Only reached when the site
 * has moved *and* stopped redirecting from all old domains; the sweep is a last
 * resort, not part of normal operation. Impostor domains exist on some of these
 * TLDs (animeunity.bar, .site, .online, ...) and are rejected by the catalogue
 * fingerprint.
 */
const DISCOVERY_TLDS = [
  "cx",
  "co",
  "it",
  "to",
  "tv",
  "gg",
  "net",
  "so",
  "com",
  "org",
  "sx",
  "bz",
  "si",
  "in",
  "me",
  "cc",
  "vip",
  "xyz",
  "top",
  "site",
  "online",
  "cyou",
  "cam",
  "link",
  "club",
  "live",
  "app",
  "io",
  "ws",
  "fm",
  "is",
  "nu",
  "se",
  "st",
  "pw",
  "icu",
  "best",
  "fun",
  "space",
  "store",
] as const;

/** Audio variants considered "sub" (original audio); `ita` is the Italian dub. */
const SUB_LANGUAGE_PREFERENCE = ["jpn", "chn", "kor", "eng"] as const;

/* -------------------------------------------------------------------------- */
/* Site host discovery                                                        */
/* -------------------------------------------------------------------------- */

interface ArchivePayload {
  current_page?: number;
  data?: AnimeUnityAnime[] | null;
  total?: number;
}

/** A candidate host that answered the catalogue probe. */
interface DiscoveredSite {
  origin: string;
  /** True when the response carried the catalogue fingerprint. */
  signature: boolean;
}

/** Cached resolved origin plus the moment it was resolved. */
let siteBaseCache: { origin: string; at: number } | null = null;
/** In-flight resolution, so concurrent requests share one probe round. */
let siteBaseResolution: Promise<string> | null = null;

/** Explicit override for tests and for pinning a host without a rebuild. */
function overrideSiteBase(): string | null {
  const raw = process.env.ANIMEUNITY_BASE?.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function siteReferer(origin: string): string {
  return `${origin}/`;
}

function siteHeaders(origin: string, accept: string): Record<string, string> {
  return {
    Accept: accept,
    "User-Agent": getElectronUserAgent(),
    Referer: siteReferer(origin),
    "X-Requested-With": "XMLHttpRequest",
  };
}

function playerHeaders(playerReferer: string): Record<string, string> {
  return {
    Accept: "*/*",
    "User-Agent": getElectronUserAgent(),
    Referer: playerReferer,
    Origin: playerReferer.slice(0, -1),
  };
}

/** The host answered, but not with something this provider can use. */
class AnimeUnityContractError extends Error {}

/** The host answered with an HTTP error status. */
class AnimeUnityRequestError extends Error {
  constructor(
    readonly status: number,
    readonly url: string
  ) {
    super(`AnimeUnity request failed (${status}): ${url}`);
  }
}

/** `fetch()` with the provider's timeout and a typed error for HTTP statuses. */
async function fetchAnimeUnity(
  url: string,
  headers: Record<string, string>,
  timeoutMs = REQUEST_TIMEOUT_MS
): Promise<Response> {
  const response = await fetch(url, {
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new AnimeUnityRequestError(response.status, url);
  return response;
}

/** Fetch a JSON API endpoint and remember the origin it actually answered from. */
async function fetchSiteJson<T>(origin: string, path: string): Promise<{ data: T; origin: string }> {
  const response = await fetchAnimeUnity(`${origin}${path}`, siteHeaders(origin, "application/json, text/plain, */*"));
  const text = await response.text();
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new AnimeUnityContractError(`AnimeUnity answered with something that is not JSON: ${origin}${path}`);
  }
  return { data, origin: new URL(response.url).origin };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A host serves this provider only when `/api/archive` answers with the
 * catalogue contract: a paginated JSON object whose records look like AnimeUnity
 * records (`slug`, `title`, `images`). Anything else — a parked page, an
 * impostor site, a host that lost its API — is not a valid candidate.
 */
function readArchiveProbe(payload: unknown): { records: AnimeUnityAnime[]; signature: boolean } | null {
  if (!isRecord(payload)) return null;
  if (!Array.isArray(payload.data) || payload.data.length === 0) return null;
  const records = payload.data.filter(isRecord) as AnimeUnityAnime[];
  const shaped = records.some(
    (record) =>
      typeof record.slug === "string" && typeof record.title === "string" && isRecord(record.images)
  );
  if (!shaped) return null;
  const signature = records.some(
    (record) =>
      typeof record.slug === "string" &&
      record.slug.includes("frieren") &&
      record.anilist_id === PROBE_ANILIST_ID
  );
  return { records, signature };
}

async function probeSiteHost(host: string, signal: AbortSignal): Promise<DiscoveredSite | null> {
  const url = `https://${host}/api/archive?${new URLSearchParams({ query: PROBE_QUERY, page: "1" }).toString()}`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: siteHeaders(`https://${host}`, "application/json, text/plain, */*"),
      signal,
    });
    if (!response.ok) return null;
    const payload: unknown = JSON.parse(await response.text());
    const archive = readArchiveProbe(payload);
    if (!archive) return null;
    return { origin: new URL(response.url).origin, signature: archive.signature };
  } catch {
    return null;
  }
}

/**
 * Probe candidate hosts in parallel and return the first one that answers the
 * catalogue contract.
 *
 * A fingerprint match wins immediately; when nothing carries the fingerprint,
 * `allowShapeFallback` decides whether the first contract-shaped answer is still
 * acceptable. Known official domains get that fallback (the site could rename a
 * catalogue entry); swept TLDs do not, because there an impostor is the more
 * likely explanation.
 */
async function discoverSite(
  hosts: readonly string[],
  options: { allowShapeFallback: boolean; budgetMs: number }
): Promise<DiscoveredSite | null> {
  if (hosts.length === 0) return null;

  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), options.budgetMs);

  try {
    return await new Promise<DiscoveredSite | null>((resolve) => {
      let pending = hosts.length;
      let shapeOnly: DiscoveredSite | null = null;
      let settled = false;

      const finish = (result: DiscoveredSite | null): void => {
        if (settled) return;
        settled = true;
        controller.abort();
        resolve(result);
      };

      for (const host of hosts) {
        void probeSiteHost(host, controller.signal)
          .then((result) => {
            if (!result) return;
            if (result.signature) {
              finish(result);
              return;
            }
            if (shapeOnly === null) shapeOnly = result;
          })
          .catch(() => undefined)
          .finally(() => {
            pending -= 1;
            if (pending === 0) finish(options.allowShapeFallback ? shapeOnly : null);
          });
      }
    });
  } finally {
    clearTimeout(deadline);
  }
}

function sweptHosts(): string[] {
  const hosts: string[] = [];
  for (const tld of DISCOVERY_TLDS) {
    hosts.push(`animeunity.${tld}`);
    hosts.push(`www.animeunity.${tld}`);
  }
  return hosts;
}

async function discoverSiteBase(): Promise<string> {
  const current = await discoverSite([CURRENT_SITE_HOST], {
    allowShapeFallback: true,
    budgetMs: PROBE_TIMEOUT_MS,
  });
  if (current) {
    console.info("[animeunity-provider] site:resolved", { origin: current.origin, via: "current" });
    return current.origin;
  }

  const known = await discoverSite(KNOWN_SITE_HOSTS, {
    allowShapeFallback: true,
    budgetMs: PROBE_TIMEOUT_MS,
  });
  if (known) {
    console.info("[animeunity-provider] site:resolved", { origin: known.origin, via: "known" });
    return known.origin;
  }

  // Last resort: the site moved to a TLD that none of its old domains redirects
  // from. Only a catalogue fingerprint is accepted here.
  const swept = await discoverSite(sweptHosts(), {
    allowShapeFallback: false,
    budgetMs: PROBE_TIMEOUT_MS,
  });
  if (swept) {
    console.warn("[animeunity-provider] site:resolved-by-sweep", { origin: swept.origin });
    return swept.origin;
  }

  throw new Error(
    "AnimeUnity is unreachable: no known host and no domain candidate answered with the " +
      "catalogue. Set ANIMEUNITY_BASE to pin a host."
  );
}

async function resolveSiteBase(): Promise<string> {
  const override = overrideSiteBase();
  if (override) return override;

  if (siteBaseCache && Date.now() - siteBaseCache.at < SITE_BASE_TTL_MS) {
    return siteBaseCache.origin;
  }

  if (siteBaseResolution === null) {
    siteBaseResolution = discoverSiteBase()
      .then((origin) => {
        siteBaseCache = { origin, at: Date.now() };
        return origin;
      })
      .finally(() => {
        siteBaseResolution = null;
      });
  }

  return siteBaseResolution;
}

function forgetSiteBase(origin: string): void {
  if (siteBaseCache?.origin === origin) siteBaseCache = null;
}

function describeError(error: unknown): string {
  if (error instanceof AnimeUnityRequestError) return `http-${error.status}`;
  if (error instanceof AnimeUnityContractError) return "contract";
  if (error instanceof Error) return error.name;
  return String(error);
}

/**
 * True when the failure means "this host no longer serves the site" rather than
 * "this request was bad".
 *
 * 404/410/421 are host-migration signals (the new origin does not know the old
 * path). 403/429/5xx are not: the host answered, so rotating would only hammer a
 * different name that redirects to the same server. A network-level failure is
 * always worth a re-resolution, because the domain may simply have moved.
 */
function shouldRotateHost(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException) {
    return error.name === "TimeoutError" || error.name === "AbortError";
  }
  if (error instanceof AnimeUnityContractError) return true;
  if (error instanceof AnimeUnityRequestError) {
    return error.status === 404 || error.status === 410 || error.status === 421;
  }
  return false;
}

/**
 * Run one request against the resolved site host, re-resolving once if the host
 * has stopped serving the site since it was cached.
 */
async function withSiteHost<T>(run: (origin: string) => Promise<T>): Promise<T> {
  const origin = await resolveSiteBase();
  try {
    return await run(origin);
  } catch (error) {
    if (!shouldRotateHost(error)) throw error;
    forgetSiteBase(origin);
    const next = await resolveSiteBase();
    if (next === origin) throw error;
    console.warn("[animeunity-provider] site:rotated", {
      from: origin,
      to: next,
      reason: describeError(error),
    });
    return run(next);
  }
}

/**
 * Origin of the player host that serves the embed, or null when the embed URL is
 * not VixCloud-shaped.
 *
 * Read from the URL instead of pinned: VixCloud is on `.cc` today but has moved
 * before (`.co` -> `.cc`), and a pinned value made every stream fail with
 * "unexpected embed URL".
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

/* -------------------------------------------------------------------------- */
/* HTML / Inertia parsing                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Decode the entities AnimeUnity uses inside its HTML attributes.
 *
 * The Vue pages embed their props JSON in `data-page="..."`, so every quote
 * arrives escaped and the raw attribute value contains no literal `"`. That is
 * what makes a simple `[^"]*` capture safe here.
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

/**
 * Read the Inertia page payload out of a Vue page.
 *
 * The site is an Inertia app: every page carries `data-page="..."` with the
 * component name and its props as JSON. This replaces the old site's
 * `records="..."` / `episodes="..."` attributes — same idea, new attribute.
 */
function parseInertiaProps<T>(html: string): { props: T; version: string | null } | null {
  const match = /data-page="([^"]*)"/.exec(html);
  if (!match?.[1]) return null;
  let page: unknown;
  try {
    page = JSON.parse(decodeHtmlEntities(match[1]));
  } catch (error: unknown) {
    log("parse:failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!isRecord(page) || !isRecord(page.props)) return null;
  return {
    props: page.props as T,
    version: typeof page.version === "string" ? page.version : null,
  };
}

function log(event: string, meta?: Record<string, unknown>): void {
  if (!IS_DEV) return;
  const suffix = meta ? ` ${JSON.stringify(meta)}` : "";
  console.info(`[animeunity-provider] ${event}${suffix}`);
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

interface AnimeUnityImages {
  banner?: string | null;
  cover?: string | null;
  poster?: string | null;
  logo?: string | null;
}

interface AnimeUnityVariant {
  language?: string | null;
  status?: string | null;
  episodes_count?: number | null;
}

/** One catalogue record: an `api.archive` item or an anime page's `anime`. */
interface AnimeUnityAnime {
  id?: number;
  slug?: string | null;
  title?: string | null;
  title_ja?: string | null;
  title_it?: string | null;
  type?: string | null;
  season?: string | null;
  year?: number | null;
  total_episodes?: number | null;
  default_status?: string | null;
  score?: string | null;
  images?: AnimeUnityImages | null;
  variants?: AnimeUnityVariant[] | null;
  plot?: string | null;
  anilist_id?: number | null;
  mal_id?: number | null;
}

interface AnimeUnityEpisodeVideo {
  id?: number;
  language?: string | null;
  runtime?: number | null;
  scws_id?: number | null;
  is_hidden?: boolean | null;
}

interface AnimeUnityEpisode {
  id?: number;
  number?: string | number | null;
  seq_number_start?: number | null;
  seq_number_end?: number | null;
  videos?: AnimeUnityEpisodeVideo[] | null;
}

/** Payload of `/api/anime/{id}/episodes`. */
interface AnimeUnityEpisodesPayload {
  episodes?: AnimeUnityEpisode[] | null;
  start?: number | null;
  tab_size?: number | null;
  total?: number | null;
}

/** Props of the anime page and of the episode page (both are `Anime` pages). */
interface AnimeUnityPageProps {
  anime?: AnimeUnityAnime | null;
  episode?: AnimeUnityEpisode | null;
  video?: AnimeUnityEpisodeVideo | null;
  embedUrl?: string | null;
}

/** One card of the home page "recently uploaded" feed. */
interface AnimeUnityLatestEpisode {
  id?: number;
  language?: string | null;
  runtime?: number | null;
  is_hidden?: boolean | null;
  episode?: {
    id?: number;
    number?: string | number | null;
    anime?: AnimeUnityAnime | null;
  } | null;
}

function mapStatus(raw: string | null | undefined): string | undefined {
  const value = raw?.trim().toLowerCase();
  if (!value) return undefined;
  if (value === "ongoing" || value.includes("corso") || value.includes("airing")) return "RELEASING";
  if (value === "hiatus") return "RELEASING";
  if (value === "completed" || value.includes("terminato") || value.includes("finished")) {
    return "FINISHED";
  }
  if (value === "upcoming" || value.includes("non ancora")) return "NOT_YET_RELEASED";
  if (value.includes("cancell")) return "CANCELLED";
  return undefined;
}

const SEASON_BY_CODE: Record<string, string> = {
  winter: "WINTER",
  spring: "SPRING",
  summer: "SUMMER",
  fall: "FALL",
  autumn: "FALL",
  inverno: "WINTER",
  primavera: "SPRING",
  estate: "SUMMER",
  autunno: "FALL",
};

function mapSeason(anime: AnimeUnityAnime): ShowSearchResult["season"] | undefined {
  const quarter = SEASON_BY_CODE[anime.season?.trim().toLowerCase() ?? ""];
  const year =
    typeof anime.year === "number" && Number.isInteger(anime.year) ? anime.year : undefined;
  if (!quarter && year == null) return undefined;
  return { quarter, year: year != null && year > 0 ? year : undefined };
}

function parseScore(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.min(Math.round(value * 10), 100);
}

function mapType(raw: string | null | undefined): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return upper === "TV" || upper === "MOVIE" || upper === "OVA" || upper === "ONA" ||
    upper === "SPECIAL" || upper === "MUSIC"
    ? upper
    : value;
}

function absoluteImageUrl(ref: string | null | undefined, base: string): string | null {
  const value = ref?.trim();
  if (!value) return null;
  try {
    return new URL(value, `${base}/`).toString();
  } catch {
    return null;
  }
}

/** The poster first, then the cover and the banner: same priority as the site. */
function posterUrl(anime: AnimeUnityAnime, base: string): string | null {
  const images = anime.images;
  return (
    absoluteImageUrl(images?.poster, base) ??
    absoluteImageUrl(images?.cover, base) ??
    absoluteImageUrl(images?.banner, base)
  );
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

/** The URL path segment used by the site: `{id}-{slug}`. */
function toProviderId(anime: AnimeUnityAnime): string | null {
  const id = asPositiveInt(anime.id);
  if (id == null) return null;
  const slug = anime.slug?.trim();
  return slug ? `${id}-${slug}` : String(id);
}

function variantLanguage(variant: AnimeUnityVariant | null | undefined): string {
  return variant?.language?.trim().toLowerCase() ?? "";
}

/**
 * The sub-ITA variant of a record: original audio (jpn/chn/kor/eng), never the
 * Italian dub. Null when the site only has the dub.
 */
function subVariant(anime: AnimeUnityAnime): AnimeUnityVariant | null {
  const variants = Array.isArray(anime.variants) ? anime.variants : [];
  if (variants.length === 0) return null;
  for (const language of SUB_LANGUAGE_PREFERENCE) {
    const match = variants.find((variant) => variantLanguage(variant) === language);
    if (match) return match;
  }
  return variants.find((variant) => {
    const language = variantLanguage(variant);
    return language.length > 0 && language !== "ita";
  }) ?? null;
}

/** Records without variant metadata are kept: the site is the only authority. */
function hasSubRelease(anime: AnimeUnityAnime): boolean {
  const variants = Array.isArray(anime.variants) ? anime.variants : [];
  if (variants.length === 0) return true;
  return subVariant(anime) !== null;
}

/** Episode count of the sub-ITA release, falling back to the show total. */
function subEpisodeCount(anime: AnimeUnityAnime): number | undefined {
  for (const candidate of [subVariant(anime)?.episodes_count, anime.total_episodes]) {
    if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
      return candidate;
    }
  }
  return undefined;
}

function mapAnimeToSearchResult(anime: AnimeUnityAnime, base: string): ShowSearchResult | null {
  const providerId = toProviderId(anime);
  if (!providerId || !hasSubRelease(anime)) return null;

  const anilistId = asPositiveInt(anime.anilist_id);
  const romanji = anime.title?.trim() || providerId;
  const italian = anime.title_it?.trim() || null;

  return {
    id: anilistId != null ? String(anilistId) : providerId,
    providerId,
    title: {
      english: italian ?? romanji,
      romanji,
    },
    thumbnail: posterUrl(anime, base),
    availableEpisodes: {
      // This provider only exposes the Italian-subtitled release.
      sub: subEpisodeCount(anime),
      dub: undefined,
    },
    score: parseScore(anime.score),
    status: mapStatus(anime.default_status),
    type: mapType(anime.type),
    season: mapSeason(anime),
  };
}

function usableVideos(episode: AnimeUnityEpisode): AnimeUnityEpisodeVideo[] {
  const videos = Array.isArray(episode.videos) ? episode.videos : [];
  return videos.filter(
    (video): video is AnimeUnityEpisodeVideo & { id: number } =>
      asPositiveInt(video.id) != null && video.is_hidden !== true
  );
}

/**
 * The sub-ITA video of an episode: original audio, never the Italian dub.
 * `null` when the episode has no sub-ITA release (dub-only episodes are not
 * offered by this provider).
 */
function pickSubVideo(episode: AnimeUnityEpisode): AnimeUnityEpisodeVideo | null {
  const videos = usableVideos(episode);
  if (videos.length === 0) return null;
  for (const language of SUB_LANGUAGE_PREFERENCE) {
    const match = videos.find(
      (video) => video.language?.trim().toLowerCase() === language
    );
    if (match) return match;
  }
  return (
    videos.find((video) => {
      const language = video.language?.trim().toLowerCase() ?? "";
      return language.length > 0 && language !== "ita";
    }) ?? null
  );
}

function findEpisode(episodes: AnimeUnityEpisode[], wanted: string): AnimeUnityEpisode | undefined {
  const label = wanted.trim();
  const exact = episodes.find((episode) => String(episode.number ?? "").trim() === label);
  if (exact) return exact;
  const numeric = Number.parseFloat(label);
  if (!Number.isFinite(numeric)) return undefined;
  return episodes.find((episode) => {
    const number = Number.parseFloat(String(episode.number ?? ""));
    return Number.isFinite(number) && number === numeric;
  });
}

function compareEpisodeLabels(a: string, b: string): number {
  const na = Number.parseFloat(a);
  const nb = Number.parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

/** Normalise the archive query so typography alone cannot empty a search. */
function toSearchableQuery(query: string): string {
  return query
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u00A0/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                   */
/* -------------------------------------------------------------------------- */

/** `{id}-{slug}` (or a bare numeric id) split into the parts the API needs. */
interface AnimeUnityProviderId {
  animeId: number;
  /** Full path segment used by the site: `{id}-{slug}`. */
  pathSegment: string;
}

function parseProviderId(providerId: string): AnimeUnityProviderId | null {
  const match = /^\s*(\d+)(?:-[^/?#]*)?\s*$/.exec(providerId);
  const animeId = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
  if (!Number.isInteger(animeId) || animeId <= 0) return null;
  return { animeId, pathSegment: providerId.trim() };
}

export class AnimeUnityStreamProvider implements StreamProvider {
  private readonly episodesCache = new Map<
    string,
    { episodes: AnimeUnityEpisode[]; at: number }
  >();
  private readonly episodesInFlight = new Map<string, Promise<AnimeUnityEpisode[]>>();

  /**
   * Search the catalogue.
   *
   * `api.archive` is used rather than the lighter `api.search` because archive
   * records carry `anilist_id`: that is the only id the app can use to match the
   * show against AniList and to continue it on a different host.
   */
  async search(query: string): Promise<ShowSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.getRecentUploads(1, 24, "sub");
    }

    // Exact spelling first; the normalised one only as a fallback. The archive
    // search accepts typographic apostrophes today, but the fallback keeps a
    // server-side normalisation change from emptying the results.
    const spellings = [...new Set([trimmed, toSearchableQuery(trimmed)])].filter(
      (spelling) => spelling.length > 0
    );

    for (const spelling of spellings) {
      const results: ShowSearchResult[] = [];
      for (let page = 1; page <= SEARCH_LIMIT_PAGES; page += 1) {
        const payload = await this.fetchArchive(spelling, page);
        for (const record of payload.records) {
          const mapped = mapAnimeToSearchResult(record, payload.origin);
          if (mapped) results.push(mapped);
        }
        if (payload.records.length === 0) break;
      }
      if (results.length > 0) return results;
    }

    return [];
  }

  private async fetchArchive(
    query: string,
    page: number
  ): Promise<{ records: AnimeUnityAnime[]; origin: string }> {
    const startedAt = Date.now();
    const result = await withSiteHost(async (origin) => {
      const path = `/api/archive?${new URLSearchParams({ query, page: String(page) }).toString()}`;
      const { data, origin: finalOrigin } = await fetchSiteJson<ArchivePayload>(origin, path);
      if (!Array.isArray(data.data)) {
        throw new AnimeUnityContractError("AnimeUnity archive response has no records array");
      }
      return { records: data.data.filter(isRecord) as AnimeUnityAnime[], origin: finalOrigin };
    });
    log("archive:done", {
      query,
      page,
      records: result.records.length,
      ms: Date.now() - startedAt,
    });
    return result;
  }

  /**
   * "Recently uploaded" for this host.
   *
   * The home feed of the new site is `api.home.latest-episodes`: one entry per
   * video, already ordered by recency and filterable by `language=sub`. The feed
   * can list several episodes of the same show, while the app's row is one card
   * per show, so the first (newest) episode of each show is kept.
   */
  async getRecentUploads(page: number, limit = 24, mode: StreamMode = "sub"): Promise<Episode[]> {
    if (page > 1) return [];
    const wanted = Math.max(1, limit);

    const latest = await withSiteHost(async (origin) => {
      const { data, origin: finalOrigin } = await fetchSiteJson<{
        data?: AnimeUnityLatestEpisode[] | null;
      }>(origin, "/api/home/latest-episodes?page=1&language=sub");
      if (!Array.isArray(data.data)) {
        throw new AnimeUnityContractError("AnimeUnity latest-episodes response has no data array");
      }
      return { entries: data.data, origin: finalOrigin };
    });

    const episodes: Episode[] = [];
    const seen = new Set<string>();
    for (const entry of latest.entries) {
      const anime = entry.episode?.anime;
      if (!anime || entry.is_hidden === true) continue;
      const providerId = toProviderId(anime);
      if (!providerId || seen.has(providerId)) continue;
      if (!hasSubRelease(anime)) continue;
      if (entry.language?.trim().toLowerCase() === "ita") continue;

      const episodeNumber = Number.parseFloat(String(entry.episode?.number ?? ""));
      const index = Number.isFinite(episodeNumber) ? episodeNumber : 1;
      const romanji = anime.title?.trim() || providerId;
      const italian = anime.title_it?.trim() || null;

      seen.add(providerId);
      episodes.push({
        // Same convention as the old provider used for this row: the row has no
        // AniList id to work with, so `id` mirrors `providerId`. The stream
        // resolution reports the real AniList id once the show page is loaded.
        id: providerId,
        providerId,
        title: { english: italian ?? romanji, romanji },
        thumbnail: posterUrl(anime, latest.origin),
        index,
        mode,
        showName: romanji,
      });
      if (episodes.length >= wanted) break;
    }

    log("recent:done", { entries: latest.entries.length, cards: episodes.length });
    return episodes;
  }

  /** Episode labels of the sub-ITA release, ascending. */
  async getEpisodesList(providerId: string): Promise<string[]> {
    const parsed = parseProviderId(providerId);
    if (!parsed) {
      throw new Error(`AnimeUnity provider id is not shaped as {id}-{slug}: ${providerId}`);
    }

    const episodes = await this.loadEpisodes(parsed.animeId);
    const labels = new Set<string>();
    for (const episode of episodes) {
      if (!pickSubVideo(episode)) continue;
      const label = String(episode.number ?? "").trim();
      if (label) labels.add(label);
    }
    return [...labels].sort(compareEpisodeLabels);
  }

  async getShowDetails(providerId: string): Promise<{
    id: string;
    providerId: string;
    name: string;
    thumbnail: string | null;
    type: string;
    description: string | null;
    anilistId?: string | null;
  }> {
    const parsed = parseProviderId(providerId);
    if (!parsed) {
      throw new Error(`AnimeUnity provider id is not shaped as {id}-{slug}: ${providerId}`);
    }

    const page = await this.fetchAnimePage(parsed.pathSegment);
    const anime = page.props.anime;
    if (!anime) {
      throw new Error(`AnimeUnity show not found: ${providerId}`);
    }

    const anilistId = asPositiveInt(anime.anilist_id);
    const romanji = anime.title?.trim() || String(anime.id ?? providerId);
    const italian = anime.title_it?.trim() || null;
    // The site canonicalises a stale slug on redirect; returning the canonical
    // segment lets history entries refresh themselves.
    const canonical = toProviderId(anime) ?? providerId;

    log("show:details", { providerId, canonical });
    return {
      id: anilistId != null ? String(anilistId) : providerId,
      providerId: canonical,
      name: italian ?? romanji,
      thumbnail: posterUrl(anime, page.origin),
      type: mapType(anime.type) ?? "TV",
      description: anime.plot?.trim() || null,
      anilistId: anilistId != null ? String(anilistId) : null,
    };
  }

  /**
   * Resolve the HLS master for one episode.
   *
   * The sub-ITA video is picked from the episode list, then the episode page for
   * that exact video is read: its Inertia payload carries the VixCloud embed URL,
   * signed for that video. The embed page and master are then handled exactly as
   * before (same `h=1` requirement, same Referer rules).
   *
   * `mode` is deliberately not used to pick an audio track: this provider only
   * offers the sub-ITA release, so the dub tab resolves the same stream it always
   * did. It is only reported in the debug log so that is visible.
   */
  async getStreamUrl(
    _id: string | null,
    providerId: string | null,
    episode: string,
    mode: StreamMode
  ): Promise<StreamUrlResult> {
    if (!providerId) {
      throw new Error("AnimeUnity requires a providerId");
    }
    const parsed = parseProviderId(providerId);
    if (!parsed) {
      throw new Error(`AnimeUnity provider id is not shaped as {id}-{slug}: ${providerId}`);
    }

    const episodes = await this.loadEpisodes(parsed.animeId);
    const match = findEpisode(episodes, episode);
    if (!match) {
      throw new Error(`AnimeUnity episode ${episode} not found for ${providerId}`);
    }
    const video = pickSubVideo(match);
    const videoId = asPositiveInt(video?.id);
    if (!video || videoId == null) {
      throw new Error(
        `AnimeUnity has no Italian-subtitled release for ${providerId} episode ${episode}`
      );
    }

    const page = await this.fetchEpisodePage(parsed.pathSegment, videoId);
    const embedUrl = page.props.embedUrl?.trim();
    if (!embedUrl) {
      throw new Error(
        `AnimeUnity did not expose an embed URL for ${providerId} episode ${episode}`
      );
    }

    const { masterUrl, playerReferer } = await this.resolveMasterUrl(embedUrl, page.origin);

    let masterResponse: Response;
    try {
      masterResponse = await fetchAnimeUnity(masterUrl, playerHeaders(playerReferer));
    } catch (error) {
      if (error instanceof AnimeUnityRequestError) {
        throw new Error(`AnimeUnity master playlist failed (${error.status})`);
      }
      throw error;
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
      qualities = sortHlsVariantsDescending(variants).map((variant) => ({
        id: variant.uri,
        label: variant.label,
        height: variant.height ?? undefined,
        bandwidth: variant.bandwidth ?? undefined,
      }));
      selectedQuality = preferred?.uri;
    }

    const anilistMediaId = asPositiveInt(page.props.anime?.anilist_id) ?? undefined;
    log("stream:resolved", {
      providerId,
      episode,
      videoId,
      mode,
      anilistMediaId: anilistMediaId ?? null,
      qualities: qualities?.map((quality) => quality.label) ?? null,
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
      anilistMediaId,
    };
  }

  getSearchFilters(): SearchFilterDefinition[] {
    return [];
  }

  /* ------------------------------------------------------------------------ */
  /* Data access                                                              */
  /* ------------------------------------------------------------------------ */

  private async fetchAnimePage(
    providerId: string
  ): Promise<{ props: AnimeUnityPageProps; origin: string }> {
    return withSiteHost(async (origin) => {
      const response = await fetchAnimeUnity(
        `${origin}/anime/${providerId}`,
        siteHeaders(origin, "text/html,application/xhtml+xml,*/*;q=0.8")
      );
      const html = await response.text();
      const parsed = parseInertiaProps<AnimeUnityPageProps>(html);
      if (!parsed) {
        throw new AnimeUnityContractError(`AnimeUnity anime page had no readable page payload: ${providerId}`);
      }
      return { props: parsed.props, origin: new URL(response.url).origin };
    });
  }

  /**
   * Read one episode page: the payload carries the signed VixCloud embed URL for
   * the exact video in the path. The site canonicalises a stale slug on the way,
   * so old history entries keep working after a slug change.
   */
  private async fetchEpisodePage(
    providerId: string,
    videoId: number
  ): Promise<{ props: AnimeUnityPageProps; origin: string }> {
    return withSiteHost(async (origin) => {
      const response = await fetchAnimeUnity(
        `${origin}/anime/${providerId}/${videoId}`,
        siteHeaders(origin, "text/html,application/xhtml+xml,*/*;q=0.8")
      );
      const html = await response.text();
      const parsed = parseInertiaProps<AnimeUnityPageProps>(html);
      if (!parsed) {
        throw new AnimeUnityContractError(
          `AnimeUnity episode page had no readable page payload: ${providerId} video ${videoId}`
        );
      }
      return { props: parsed.props, origin: new URL(response.url).origin };
    });
  }

  /**
   * Resolve the HLS master for one signed embed URL.
   *
   * Two hops are needed because AnimeUnity delegates playback to VixCloud. The
   * `h=1` parameter is the one that actually works: the embed page advertises an
   * `asn` parameter instead, and requesting with it returns 403.
   */
  private async resolveMasterUrl(
    embedUrl: string,
    siteOrigin: string
  ): Promise<{ masterUrl: string; playerReferer: string }> {
    const playerOrigin = playerOriginFromEmbed(embedUrl);
    if (!playerOrigin) {
      throw new Error(`AnimeUnity returned an unexpected embed URL: ${embedUrl.slice(0, 120)}`);
    }
    const playerReferer = `${playerOrigin}/`;

    // The embed page is requested with the AnimeUnity origin as referer, which is
    // what the site's own iframe produces.
    const embedHtml = await fetchAnimeUnity(
      embedUrl,
      siteHeaders(siteOrigin, "text/html,application/xhtml+xml,*/*;q=0.8")
    ).then((response) => response.text());
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
      log("master:extract-failed", { blockLength: block.length });
      throw new Error("AnimeUnity embed page did not expose a master playlist");
    }

    // The `url` is not always bare: VixCloud serves some episodes from
    // `https://vixcloud.cc/playlist/{id}?b=1`, and that flag is load-bearing:
    // requesting the same playlist without it returns 403. Appending with a
    // second `?` (`...?b=1?token=…`) makes the server read the whole thing as the
    // value of `b`, which is also a 403, so merge the query properly instead of
    // concatenating.
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

    return { masterUrl, playerReferer };
  }

  /**
   * Episode list of a show, cached: the sidebar asks for it, and stream
   * resolution needs the same list a moment later.
   *
   * The API returns one page of `tab_size` episodes at a time but the first
   * response also carries `total`, so the remaining pages can be fetched in
   * parallel. Without that, a 1000+ episode show would take ten sequential
   * round trips before the sidebar showed anything.
   */
  private async loadEpisodes(animeId: number): Promise<AnimeUnityEpisode[]> {
    const key = String(animeId);
    const cached = this.episodesCache.get(key);
    if (cached && Date.now() - cached.at < EPISODES_CACHE_TTL_MS) {
      return cached.episodes;
    }

    const inFlight = this.episodesInFlight.get(key);
    if (inFlight !== undefined) return inFlight;

    const promise = this.fetchAllEpisodes(animeId)
      .then((episodes) => {
        this.episodesCache.set(key, { episodes, at: Date.now() });
        if (this.episodesCache.size > EPISODES_CACHE_MAX_ENTRIES) {
          const oldest = [...this.episodesCache.keys()][0];
          if (oldest !== undefined) this.episodesCache.delete(oldest);
        }
        return episodes;
      })
      .finally(() => {
        this.episodesInFlight.delete(key);
      });

    this.episodesInFlight.set(key, promise);
    return promise;
  }

  private async fetchAllEpisodes(animeId: number): Promise<AnimeUnityEpisode[]> {
    const first = await this.fetchEpisodesPage(animeId, 1);
    if (first.episodes.length === 0) return [];

    const total = asPositiveInt(first.total) ?? first.episodes.length;
    const pageSize = asPositiveInt(first.tab_size) ?? EPISODES_PER_PAGE;
    const pageCount = Math.min(
      Math.max(1, Math.ceil(total / Math.max(1, pageSize))),
      EPISODES_MAX_PAGES
    );
    if (pageCount <= 1 || first.episodes.length < pageSize) {
      return first.episodes;
    }

    const starts: number[] = [];
    for (let page = 1; page < pageCount; page += 1) {
      starts.push(1 + page * pageSize);
    }
    const pages = await Promise.all(
      starts.map((start) => this.fetchEpisodesPage(animeId, start))
    );

    const byId = new Map<number, AnimeUnityEpisode>();
    for (const page of [first, ...pages]) {
      for (const episode of page.episodes) {
        const id = asPositiveInt(episode.id);
        if (id == null) continue;
        byId.set(id, episode);
      }
    }
    log("episodes:done", { animeId, pages: pageCount, episodes: byId.size });
    return [...byId.values()];
  }

  private async fetchEpisodesPage(
    animeId: number,
    start: number
  ): Promise<AnimeUnityEpisodesPayload & { episodes: AnimeUnityEpisode[] }> {
    return withSiteHost(async (origin) => {
      const { data } = await fetchSiteJson<AnimeUnityEpisodesPayload>(
        origin,
        `/api/anime/${animeId}/episodes?${new URLSearchParams({ start: String(start) }).toString()}`
      );
      if (!Array.isArray(data.episodes)) {
        throw new AnimeUnityContractError(`AnimeUnity episodes response has no episodes array: ${animeId}`);
      }
      return {
        ...data,
        episodes: data.episodes.filter(isRecord) as AnimeUnityEpisode[],
      };
    });
  }
}
