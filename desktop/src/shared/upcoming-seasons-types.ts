/**
 * Types for the "Following" page: upcoming seasons of shows the user has on
 * their AniList list.
 *
 * The discovery strategy is a SEQUEL-chain walk rather than a single lookup,
 * because AniList only exposes the *immediately* related node. A show whose
 * latest entry has already aired points to the next one only through that
 * entry's own relations — e.g. Frieren (2023) relates to "2nd Season" (2026),
 * which in turn relates to "3rd Season", the one that is actually upcoming.
 * Chaining two levels is what surfaces the interesting result.
 */

export interface UpcomingSeasonSource {
  /** AniList media id of the show on the user's list. */
  mediaId: number;
  title: string;
  coverImage: string | null;
  /** The user's list status for the source show, e.g. CURRENT or COMPLETED. */
  listStatus: string;
  /** The user's watch progress on the source show. */
  progress: number;
  totalEpisodes: number | null;
}

export interface UpcomingSeason {
  /** AniList media id of the upcoming entry. */
  mediaId: number;
  title: string;
  coverImage: string | null;
  /** Season label as returned by AniList: WINTER | SPRING | SUMMER | FALL. */
  season: string | null;
  seasonYear: number | null;
  /** Partial date; AniList frequently omits day and sometimes month. */
  startDate: {
    year: number | null;
    month: number | null;
    day: number | null;
  } | null;
  /** How many SEQUEL hops away from the source show this entry is. */
  hops: number;
  /** The show on the user's list that this upcoming season belongs to. */
  source: UpcomingSeasonSource;
}

/* -------------------------------------------------------------------------- */
/* Currently airing                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A show on the user's list that is airing right now.
 *
 * Distinct from `UpcomingSeason`: these are already running, so the useful
 * information is the next episode and *when* it drops, not a premiere date.
 * The timing comes from `Media.nextAiringEpisode`, which AniList populates only
 * for RELEASING media — verified: 48 of 50 currently-airing shows returned a
 * concrete airing timestamp.
 */
export interface AiringShow {
  mediaId: number;
  title: string;
  coverImage: string | null;
  /** Next episode number, or null when AniList has no schedule for it. */
  nextEpisode: number | null;
  /** Epoch milliseconds of the next airing, in absolute UTC terms. */
  airingAtMs: number | null;
  /**
   * Local weekday index (0 = Sunday … 6 = Saturday) derived from `airingAtMs`
   * in the *user's* timezone, so the grouping matches what they experience.
   */
  weekdayIndex: number | null;
  /** Seconds until the next episode, as reported by AniList. */
  timeUntilAiring: number | null;
  /** Total episodes, when known. */
  totalEpisodes: number | null;
  /** The user's progress on this show. */
  progress: number;
  /** The user's list status, e.g. CURRENT or REPEATING. */
  listStatus: string;
  /**
   * True when the show is on the user's list as CURRENT/REPEATING. Shows that
   * are simply airing but only "planned" are marked false and shown de-emphasised.
   */
  isBeingWatched: boolean;
}

export type UpcomingSeasonsResult =
  | {
      status: "ok";
      /** Future, not-yet-aired seasons (grouped in the Upcoming section). */
      seasons: UpcomingSeason[];
      /** Shows airing right now (grouped by weekday in the Ongoing section). */
      airing: AiringShow[];
      fetchedAt: number;
    }
  /** AniList is not connected, so there is no list to read. */
  | { status: "not-connected" }
  /** Connected, but nothing is airing and no future season is announced. */
  | { status: "empty"; fetchedAt: number }
  /** Throttled by AniList; `retryAfterSeconds` says when to try again. */
  | { status: "rate-limited"; retryAfterSeconds: number }
  | { status: "error"; message: string };
