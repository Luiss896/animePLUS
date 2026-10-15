import type {
  AiringShow,
  UpcomingSeason,
  UpcomingSeasonsResult,
  UpcomingSeasonSource,
} from "@/shared/upcoming-seasons-types";

import { AniListRateLimitError } from "./anilist-api";
import { getAniListViewerId, postAniListAuthedGraphql } from "./anilist-authed-api";

/**
 * Discovers upcoming seasons for shows on the user's AniList list.
 *
 * Design constraints, all driven by the real API:
 *
 * 1. RATE LIMIT. AniList documents 90 req/min but currently serves 30/min and
 *    drops to HTTP 429 past that. This module therefore makes a FIXED, small
 *    number of requests per refresh (three: list, then one batched media query
 *    per chunk) instead of one request per show.
 *
 * 2. `id_in` BATCHING. `Page.media(id_in: [...])` accepts many ids at once, so
 *    the whole list is resolved in one round trip regardless of its size.
 *
 * 3. SEQUEL CHAIN, TWO LEVELS. `relations` only exposes the *immediately*
 *    adjacent entry, so a finished show points at its already-aired sequel
 *    rather than the upcoming one. The nested query below asks for relations
 *    two levels deep, which is what surfaces the genuinely upcoming entry
 *    (verified: Frieren -> 2nd Season (aired) -> 3rd Season (FALL 2027)).
 *
 * 4. EMPTY IS NORMAL. A season/year with no data returns HTTP 200 and an empty
 *    array, not an error, so "no upcoming seasons" is a state and not a failure.
 */

/**
 * Maximum list entries inspected, across all pages.
 *
 * This used to be a single fixed page of 50 with no indication when the list was
 * longer, which silently dropped entries: a user with 54 shows had whichever 4
 * fell outside the first page vanish from the page entirely — including shows
 * already on their list and airing right now. The list is now paginated up to
 * this ceiling, and hitting it is reported rather than hidden.
 */
const MAX_SOURCE_SHOWS = 300;

/** AniList page size ceiling for both the list and the media queries. */
const MEDIA_PAGE_SIZE = 50;

/** Cache lifetime. Seasons change rarely; the list changes more often. */
const CACHE_TTL_MS = 30 * 60 * 1000;

/** How deep to follow SEQUEL edges. Two levels covers the common case. */
const MAX_SEQUEL_HOPS = 2;

/**
 * One query that returns the user's list entries with enough media detail, and
 * a second that walks relations two levels down. Both are deliberately fixed
 * strings so the request count never depends on list size.
 */
const LIST_QUERY = `
  query ($userId: Int, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total currentPage lastPage hasNextPage }
      mediaList(userId: $userId, type: ANIME, sort: UPDATED_TIME_DESC) {
        id
        status
        progress
        media {
          id
          title { english romaji userPreferred }
          coverImage { large extraLarge }
          episodes
          status
          nextAiringEpisode { episode airingAt timeUntilAiring }
        }
      }
    }
  }
`;

const RELATIONS_QUERY = `
  query ($ids: [Int]) {
    Page(page: 1, perPage: ${MEDIA_PAGE_SIZE}) {
      media(id_in: $ids, type: ANIME) {
        id
        relations {
          edges {
            relationType
            node {
              id
              title { english romaji userPreferred }
              coverImage { large extraLarge }
              status
              season
              seasonYear
              episodes
              nextAiringEpisode { episode airingAt timeUntilAiring }
              startDate { year month day }
              relations {
                edges {
                  relationType
                  node {
                    id
                    title { english romaji userPreferred }
                    coverImage { large extraLarge }
                    status
                    season
                    seasonYear
                    episodes
                    nextAiringEpisode { episode airingAt timeUntilAiring }
                    startDate { year month day }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/* -------------------------------------------------------------------------- */
/* Raw API shapes                                                             */
/* -------------------------------------------------------------------------- */

interface RawTitle {
  english?: string | null;
  romaji?: string | null;
  userPreferred?: string | null;
}

interface RawCover {
  large?: string | null;
  extraLarge?: string | null;
}

interface RawFuzzyDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

interface RawRelatedNode {
  id?: number | null;
  title?: RawTitle | null;
  coverImage?: RawCover | null;
  status?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  episodes?: number | null;
  nextAiringEpisode?: RawAiringSchedule | null;
  startDate?: RawFuzzyDate | null;
  relations?: { edges?: (RawRelationEdge | null)[] | null } | null;
}

interface RawRelationEdge {
  relationType?: string | null;
  node?: RawRelatedNode | null;
}

interface RawAiringSchedule {
  episode?: number | null;
  airingAt?: number | null;
  timeUntilAiring?: number | null;
}

interface RawListEntry {
  id?: number | null;
  status?: string | null;
  progress?: number | null;
  media?: {
    id?: number | null;
    title?: RawTitle | null;
    coverImage?: RawCover | null;
    episodes?: number | null;
    status?: string | null;
    nextAiringEpisode?: RawAiringSchedule | null;
  } | null;
}

interface RawMediaWithRelations {
  id?: number | null;
  relations?: { edges?: (RawRelationEdge | null)[] | null } | null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function pickTitle(title: RawTitle | null | undefined): string {
  return (
    title?.english?.trim() ||
    title?.romaji?.trim() ||
    title?.userPreferred?.trim() ||
    "Unknown title"
  );
}

function pickCover(cover: RawCover | null | undefined): string | null {
  return cover?.extraLarge ?? cover?.large ?? null;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Sort key for an upcoming entry: nearest first, undated last.
 *
 * AniList often omits the day and sometimes the month, so a missing component
 * falls back to the start of its period rather than excluding the entry.
 */
function seasonSortKey(season: UpcomingSeason): number {
  const { seasonYear, startDate } = season;
  const year = startDate?.year ?? seasonYear ?? null;
  if (year == null) return Number.MAX_SAFE_INTEGER;
  const month = startDate?.month ?? 1;
  const day = startDate?.day ?? 1;
  return year * 10000 + month * 100 + day;
}

function toUpcoming(
  node: RawRelatedNode,
  hops: number,
  source: UpcomingSeasonSource
): UpcomingSeason | null {
  if (!isPositiveInt(node.id)) return null;
  return {
    mediaId: node.id,
    title: pickTitle(node.title),
    coverImage: pickCover(node.coverImage),
    season: node.season ?? null,
    seasonYear: node.seasonYear ?? null,
    startDate: node.startDate
      ? {
          year: node.startDate.year ?? null,
          month: node.startDate.month ?? null,
          day: node.startDate.day ?? null,
        }
      : null,
    hops,
    source,
  };
}

/**
 * Relation types worth following from a show on the user's list.
 *
 * `SEQUEL` is the obvious one; `PREQUEL` is its mirror and is what AniList
 * actually reports in many real cases, because the edge is stored from the
 * older entry's point of view inconsistently across the database. Cyberpunk:
 * Edgerunners, for instance, links to its second season as `OTHER`, not
 * `SEQUEL`, and following only `SEQUEL` hid that season completely.
 */
const FORWARD_RELATION_TYPES = new Set(["SEQUEL", "PREQUEL", "OTHER"]);

/** Normalise a title for comparison: lowercase, alphanumerics and single spaces. */
function normalizeTitle(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether an `OTHER`-linked node is plausibly a continuation of the source show.
 *
 * `OTHER` is AniList's catch-all and also covers spin-offs, parodies, recaps and
 * compilations, so it cannot be trusted on its own. But some genuine sequels are
 * only reachable that way, so the edge is accepted when the titles clearly share
 * a franchise: the node's title must contain the source's title (or its first
 * significant words), which admits "Cyberpunk: Edgerunners 2" for "Cyberpunk:
 * Edgerunners" while rejecting an unrelated entry that happens to be linked.
 *
 * Deliberately conservative: a missing season is easier to live with than an
 * "Upcoming" list filled with things that are not sequels.
 */
function looksLikeSameFranchise(
  nodeTitle: string | null | undefined,
  sourceTitle: string | null | undefined
): boolean {
  const node = normalizeTitle(nodeTitle);
  const source = normalizeTitle(sourceTitle);
  if (!node || !source) return false;
  if (node.includes(source)) return true;

  // Fall back to the leading words, so a subtitle such as "Season 2" or a
  // trailing parenthetical does not defeat the match.
  const words = source.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return false;
  const stem = words.slice(0, Math.min(3, words.length)).join(" ");
  return stem.length >= 6 && node.includes(stem);
}

/**
 * Collect upcoming entries reachable from one show's relations.
 *
 * Walks the forward edges (see `FORWARD_RELATION_TYPES`) up to
 * `MAX_SEQUEL_HOPS`, and only accepts nodes whose status is NOT_YET_RELEASED —
 * an aired sequel already belongs to the "airing now" section, and reporting it
 * here too would duplicate it.
 *
 * The walk deliberately continues *through* an already-airing node instead of
 * stopping at it: the chain Frieren S1 -> S2 (airing) -> S3 (announced) only
 * reaches S3 by passing through S2, so treating an aired node as a dead end
 * would hide every season announced after one that is currently running.
 *
 * `airingFromRelations` collects the airing nodes encountered on the way; the
 * caller merges them into the "airing now" list, because a sequel can be on air
 * without ever appearing as an entry on the user's own list.
 */
function collectUpcomingFromRelations(
  edges: (RawRelationEdge | null)[] | null | undefined,
  source: UpcomingSeasonSource,
  seen: Set<number>,
  airingFromRelations?: Map<number, RawRelatedNode>
): UpcomingSeason[] {
  const results: UpcomingSeason[] = [];
  if (!edges) return results;

  for (const edge of edges) {
    const relationType = edge?.relationType;
    if (!edge || !relationType || !FORWARD_RELATION_TYPES.has(relationType)) continue;
    const node = edge.node;
    if (!node) continue;

    // `OTHER` needs corroboration: it also links spin-offs and recaps.
    const forward =
      relationType !== "OTHER" ||
      looksLikeSameFranchise(pickTitle(node.title), source.title);
    if (!forward) continue;

    if (node.status === "NOT_YET_RELEASED" && isPositiveInt(node.id) && !seen.has(node.id)) {
      const upcoming = toUpcoming(node, 1, source);
      if (upcoming) {
        seen.add(node.id);
        results.push(upcoming);
      }
    }

    // An airing sequel is not "upcoming", but it is still worth showing on the
    // Following page: the user finished the previous season, so the currently
    // running one is exactly what they want to see.
    if (node.status === "RELEASING" && isPositiveInt(node.id) && airingFromRelations) {
      if (!airingFromRelations.has(node.id)) {
        airingFromRelations.set(node.id, node);
      }
    }

    // Second hop: the latest-aired sequel may itself point at the upcoming one.
    if (MAX_SEQUEL_HOPS >= 2) {
      for (const nested of collectUpcomingFromRelations(
        node.relations?.edges ?? null,
        source,
        seen,
        airingFromRelations
      )) {
        results.push({ ...nested, hops: nested.hops + 1 });
      }
    }
  }

  return results;
}

/**
 * Split a list into chunks that fit a single `id_in` query.
 *
 * Each chunk costs one request, so the chunk count directly controls the rate
 * budget. With 50 ids and 30 requests/minute there is ample headroom.
 */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Build the currently-airing list from the user's own list entries.
 *
 * A show qualifies when AniList reports RELEASING status *and* supplies a
 * `nextAiringEpisode`: the status alone is not enough, because a long-running
 * show can be RELEASING with no schedule attached, and such an entry carries no
 * actionable information for a "when does the next episode drop" view.
 *
 * The weekday is computed here, in the main process, so it reflects the machine's
 * local timezone rather than whatever the renderer guesses. `getDay()` returns
 * 0 = Sunday, matching the grouping used by the UI.
 */
function collectAiringShows(entries: (RawListEntry | null)[] | null | undefined): AiringShow[] {
  const shows: AiringShow[] = [];
  const seen = new Set<number>();

  for (const entry of entries ?? []) {
    const media = entry?.media;
    if (!media || !isPositiveInt(media.id)) continue;
    if (seen.has(media.id)) continue;

    const schedule = media.nextAiringEpisode;
    if (media.status !== "RELEASING") continue;
    if (!schedule || typeof schedule.airingAt !== "number") continue;

    seen.add(media.id);

    const airingAtMs = schedule.airingAt * 1000;
    const airingDate = new Date(airingAtMs);

    shows.push({
      mediaId: media.id,
      title: pickTitle(media.title),
      coverImage: pickCover(media.coverImage),
      nextEpisode: schedule.episode ?? null,
      airingAtMs,
      weekdayIndex: Number.isNaN(airingDate.getTime()) ? null : airingDate.getDay(),
      timeUntilAiring: schedule.timeUntilAiring ?? null,
      totalEpisodes: media.episodes ?? null,
      progress: entry?.progress ?? 0,
      listStatus: entry?.status ?? "CURRENT",
      isBeingWatched: entry?.status === "CURRENT" || entry?.status === "REPEATING",
      isOnList: true,
    });
  }

  // Soonest first within each day, and undated last.
  shows.sort((a, b) => (a.airingAtMs ?? Infinity) - (b.airingAtMs ?? Infinity));
  return shows;
}

/**
 * Turn an airing SEQUEL node reached through relations into an airing show.
 *
 * These shows are not entries on the user's list, so there is no list status or
 * progress to report: `isBeingWatched` is false and the UI marks them as "On
 * your list" precisely because they are not. Without this, a show airing right
 * now — reachable only as a relation of a season the user did finish — fell
 * between the "airing" and "upcoming" sections and appeared in neither.
 */
function relatedNodeToAiringShow(node: RawRelatedNode): AiringShow | null {
  if (!isPositiveInt(node.id)) return null;

  const schedule = node.nextAiringEpisode;
  const hasSchedule = Boolean(schedule) && typeof schedule?.airingAt === "number";
  const airingAtMs = hasSchedule ? (schedule as RawAiringSchedule).airingAt! * 1000 : null;
  const airingDate = airingAtMs == null ? null : new Date(airingAtMs);

  return {
    mediaId: node.id,
    title: pickTitle(node.title),
    coverImage: pickCover(node.coverImage),
    nextEpisode: hasSchedule ? (schedule?.episode ?? null) : null,
    airingAtMs,
    weekdayIndex:
      airingDate == null || Number.isNaN(airingDate.getTime()) ? null : airingDate.getDay(),
    timeUntilAiring: hasSchedule ? (schedule?.timeUntilAiring ?? null) : null,
    totalEpisodes: node.episodes ?? null,
    progress: 0,
    listStatus: "RELATED",
    isBeingWatched: false,
    isOnList: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                         */
/* -------------------------------------------------------------------------- */

let cache: { result: UpcomingSeasonsResult; expiresAt: number } | null = null;

export function clearUpcomingSeasonsCache(): void {
  cache = null;
}

/**
 * Fetch upcoming seasons for the connected user's list.
 *
 * Never throws for expected conditions: "not connected", "nothing upcoming",
 * throttling and network errors are all returned as discriminated results so
 * the renderer can render a meaningful state instead of an error boundary.
 */
export async function fetchUpcomingSeasons(
  options: { force?: boolean } = {}
): Promise<UpcomingSeasonsResult> {
  const now = Date.now();
  if (!options.force && cache && cache.expiresAt > now) {
    return cache.result;
  }

  const remember = (result: UpcomingSeasonsResult): UpcomingSeasonsResult => {
    // Only successful, complete results are worth caching.
    if (result.status === "ok" || result.status === "empty") {
      cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return result;
  };

  try {
    const userId = await getAniListViewerId();

    // Paginate the whole list, not just the first page. A single page silently
    // truncates: with 54 entries a fixed perPage of 50 dropped 4 of them, and
    // whichever shows fell outside the window disappeared from this page even
    // though they were on the user's list and airing.
    const allEntries: RawListEntry[] = [];
    let page = 1;
    let truncated = false;

    for (;;) {
      const listData = await postAniListAuthedGraphql<{
        Page?: {
          pageInfo?: { hasNextPage?: boolean | null; lastPage?: number | null } | null;
          mediaList?: (RawListEntry | null)[] | null;
        } | null;
      }>(LIST_QUERY, { userId, page, perPage: MEDIA_PAGE_SIZE });

      for (const entry of listData.Page?.mediaList ?? []) {
        if (entry) allEntries.push(entry);
      }

      const info = listData.Page?.pageInfo;
      if (!info?.hasNextPage) break;
      if (allEntries.length >= MAX_SOURCE_SHOWS) {
        truncated = true;
        break;
      }
      page += 1;
    }

    // Build the source set: only entries with a usable media id, de-duplicated
    // by media id (a show can appear in both a status list and a custom list).
    const sources = new Map<number, UpcomingSeasonSource>();
    for (const entry of allEntries) {
      const media = entry.media;
      if (!media || !isPositiveInt(media.id)) continue;
      if (sources.has(media.id)) continue;

      sources.set(media.id, {
        mediaId: media.id,
        title: pickTitle(media.title),
        coverImage: pickCover(media.coverImage),
        listStatus: entry.status ?? "CURRENT",
        progress: entry.progress ?? 0,
        totalEpisodes: media.episodes ?? null,
      });
    }

    // Currently airing shows come from the list response itself — no extra
    // request, since `nextAiringEpisode` is already part of LIST_QUERY. Airing
    // sequels found through relations are merged in further below.
    const airing = collectAiringShows(allEntries);

    if (sources.size === 0) {
      return remember({ status: "empty", fetchedAt: Date.now() });
    }

    const seen = new Set<number>();
    const seasons: UpcomingSeason[] = [];
    /** Airing sequels found through relations, keyed by media id. */
    const airingFromRelations = new Map<number, RawRelatedNode>();

    // One request per chunk. 50 sources -> a single request.
    for (const ids of chunk(
      Array.from(sources.keys()),
      MEDIA_PAGE_SIZE
    )) {
      const data = await postAniListAuthedGraphql<{
        Page?: { media?: (RawMediaWithRelations | null)[] | null } | null;
      }>(RELATIONS_QUERY, { ids });

      for (const media of data.Page?.media ?? []) {
        if (!media || !isPositiveInt(media.id)) continue;
        const source = sources.get(media.id);
        if (!source) continue;

        seasons.push(
          ...collectUpcomingFromRelations(
            media.relations?.edges ?? null,
            source,
            seen,
            airingFromRelations
          )
        );
      }
    }

    // Merge the airing sequels into the airing list. A show already present —
    // because it is on the user's list — wins, since it carries real progress.
    const airingIds = new Set(airing.map((show) => show.mediaId));
    for (const [mediaId, node] of airingFromRelations) {
      if (airingIds.has(mediaId)) continue;
      const show = relatedNodeToAiringShow(node);
      if (!show) continue;
      airingIds.add(mediaId);
      airing.push(show);
    }

    // Keep the airing list ordered by next episode, undated last.
    airing.sort((a, b) => (a.airingAtMs ?? Infinity) - (b.airingAtMs ?? Infinity));

    // Nothing airing and nothing announced is a legitimate empty state.
    if (seasons.length === 0 && airing.length === 0) {
      return remember({ status: "empty", fetchedAt: Date.now() });
    }

    seasons.sort((a, b) => seasonSortKey(a) - seasonSortKey(b));

    return remember({ status: "ok", seasons, airing, fetchedAt: Date.now(), truncated });
  } catch (error) {
    if (error instanceof AniListRateLimitError) {
      return { status: "rate-limited", retryAfterSeconds: error.retryAfterSeconds };
    }
    if (error instanceof Error && error.name === "AniListNotConnectedError") {
      return { status: "not-connected" };
    }
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Failed to load upcoming seasons",
    };
  }
}
