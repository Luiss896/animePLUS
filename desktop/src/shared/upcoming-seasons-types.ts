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

export type UpcomingSeasonsResult =
  | { status: "ok"; seasons: UpcomingSeason[]; fetchedAt: number }
  /** AniList is not connected, so there is no list to read. */
  | { status: "not-connected" }
  /** Connected, but the list has no show with a known upcoming season. */
  | { status: "empty"; fetchedAt: number }
  /** Throttled by AniList; `retryAfterSeconds` says when to try again. */
  | { status: "rate-limited"; retryAfterSeconds: number }
  | { status: "error"; message: string };
