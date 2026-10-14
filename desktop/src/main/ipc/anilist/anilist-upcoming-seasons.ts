import type {
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

/** How many list entries are inspected. Keeps the query bounded and quick. */
const MAX_SOURCE_SHOWS = 50;

/** AniList page size ceiling for the media page. */
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
  query ($userId: Int, $perPage: Int) {
    Page(page: 1, perPage: $perPage) {
      mediaList(userId: $userId, type: ANIME, sort: UPDATED_TIME_DESC) {
        id
        status
        progress
        media {
          id
          title { english romaji userPreferred }
          coverImage { large extraLarge }
          episodes
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
  startDate?: RawFuzzyDate | null;
  relations?: { edges?: (RawRelationEdge | null)[] | null } | null;
}

interface RawRelationEdge {
  relationType?: string | null;
  node?: RawRelatedNode | null;
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
 * Collect upcoming SEQUEL entries reachable from one show's relations.
 *
 * Walks the SEQUEL edge up to `MAX_SEQUEL_HOPS`, and only accepts nodes whose
 * status is NOT_YET_RELEASED — an aired sequel is not news, and reporting it
 * would make the page useless for shows that already have several seasons.
 */
function collectUpcomingFromRelations(
  edges: (RawRelationEdge | null)[] | null | undefined,
  source: UpcomingSeasonSource,
  seen: Set<number>
): UpcomingSeason[] {
  const results: UpcomingSeason[] = [];
  if (!edges) return results;

  for (const edge of edges) {
    if (!edge || edge.relationType !== "SEQUEL") continue;
    const node = edge.node;
    if (!node) continue;

    if (node.status === "NOT_YET_RELEASED" && isPositiveInt(node.id) && !seen.has(node.id)) {
      const upcoming = toUpcoming(node, 1, source);
      if (upcoming) {
        seen.add(node.id);
        results.push(upcoming);
      }
    }

    // Second hop: the latest-aired sequel may itself point at the upcoming one.
    if (MAX_SEQUEL_HOPS >= 2) {
      for (const nested of collectUpcomingFromRelations(
        node.relations?.edges ?? null,
        source,
        seen
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

    const listData = await postAniListAuthedGraphql<{
      Page?: { mediaList?: (RawListEntry | null)[] | null } | null;
    }>(LIST_QUERY, { userId, perPage: MAX_SOURCE_SHOWS });

    // Build the source set: only entries with a usable media id, de-duplicated
    // by media id (a show can appear in both a status list and a custom list).
    const sources = new Map<number, UpcomingSeasonSource>();
    for (const entry of listData.Page?.mediaList ?? []) {
      const media = entry?.media;
      if (!media || !isPositiveInt(media.id)) continue;
      if (sources.has(media.id)) continue;

      sources.set(media.id, {
        mediaId: media.id,
        title: pickTitle(media.title),
        coverImage: pickCover(media.coverImage),
        listStatus: entry?.status ?? "CURRENT",
        progress: entry?.progress ?? 0,
        totalEpisodes: media.episodes ?? null,
      });
    }

    if (sources.size === 0) {
      return remember({ status: "empty", fetchedAt: Date.now() });
    }

    const seen = new Set<number>();
    const seasons: UpcomingSeason[] = [];

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
          ...collectUpcomingFromRelations(media.relations?.edges ?? null, source, seen)
        );
      }
    }

    if (seasons.length === 0) {
      return remember({ status: "empty", fetchedAt: Date.now() });
    }

    seasons.sort((a, b) => seasonSortKey(a) - seasonSortKey(b));

    return remember({ status: "ok", seasons, fetchedAt: Date.now() });
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
