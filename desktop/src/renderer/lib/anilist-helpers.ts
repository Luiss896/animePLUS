import type { AniListListMedia, AniListMediaListStatus, ShowSearchResult } from "@/shared/types";
import {
  buildShowSearchQueries,
  isDecisiveShowMatch,
  pickBestShowMatch,
  scoreShowCandidate,
  showTitlesFromAniListMedia,
  type ShowMatchQuery,
} from "./show-matching";

/**
 * Score at which a title match is trusted without trying further spellings.
 * Mirrors `CONFIDENT_MATCH_SCORE` in `watch-page.tsx`: the two lookups must agree
 * on what "confident" means or the same show resolves differently per page.
 */
const CONFIDENT_SHOW_MATCH_SCORE = 600;

/** AniList descriptions often include `<br>`, `<i>`, etc. Strip tags for plain text UI. */
export function stripAniListDescription(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function anilistMediaTitle(media: AniListListMedia): string {
  return (
    media.title?.userPreferred ??
    media.title?.english ??
    media.title?.romaji ??
    media.title?.native ??
    `Anime #${media.id}`
  );
}

export function anilistCoverUrl(media: AniListListMedia): string | null {
  return media.coverImage?.extraLarge ?? media.coverImage?.large ?? null;
}

export const ANILIST_LIST_STATUS_LABELS: Record<AniListMediaListStatus, string> = {
  CURRENT: "Watching",
  PLANNING: "Planning",
  COMPLETED: "Completed",
  REPEATING: "Rewatching",
  PAUSED: "Paused",
  DROPPED: "Dropped",
};

export const ANILIST_ADD_TO_LIST_OPTIONS: AniListMediaListStatus[] = [
  "CURRENT",
  "PLANNING",
  "COMPLETED",
  "REPEATING",
  "PAUSED",
  "DROPPED",
];

/**
 * Resolve a streamable provider id for an AniList list entry.
 *
 * AniList ids and provider ids are different namespaces, so the entry's own id
 * can only be compared against a provider that publishes AniList ids: AnimeUnity
 * does (its search results carry `anilist_id` as `id`), HiAnime does not (it
 * exposes its own slug). The previous revision searched once with the verbatim
 * title and fell back to `results[0]`, which silently opened whatever the
 * catalogue happened to rank first — the first season of a show watched in its
 * second, or an unrelated title.
 *
 * The lookup therefore walks several spellings of the title and scores the
 * candidates with the same matcher the watch page uses (`show-matching.ts`).
 * The AniList id is decisive when a provider confirms it; otherwise a candidate
 * must be recognisably the same show *and* not contradict the season. Refusing
 * to answer surfaces as "no stream source found", which is honest and lets the
 * caller fall back to AniList — far better than opening the wrong show.
 */
export async function resolveProviderForAniListMedia(
  media: AniListListMedia
): Promise<{ providerId: string } | null> {
  const titles = showTitlesFromAniListMedia(media);
  const queries = buildShowSearchQueries(titles);
  if (queries.length === 0) return null;

  const matchQuery: ShowMatchQuery = {
    titles,
    anilistMediaId: Number.isInteger(media.id) && media.id > 0 ? media.id : null,
    // `media.episodes` is the announced total, not the episode being watched, so
    // it is deliberately not passed as `episodeIndex`.
    episodeIndex: null,
  };

  const candidates = new Map<string, ShowSearchResult>();
  for (const query of queries) {
    let results: ShowSearchResult[] = [];
    try {
      results = await window.streamProvider.search(query);
    } catch {
      // One failing spelling must not abandon the lookup.
      continue;
    }
    for (const result of results) {
      if (!candidates.has(result.providerId)) candidates.set(result.providerId, result);
    }

    const found = [...candidates.values()];
    // A provider that confirms the AniList id ends the search: no spelling of the
    // title can improve on that.
    if (found.some((candidate) => isDecisiveShowMatch(candidate, matchQuery.anilistMediaId))) {
      break;
    }
    // Stop early on a confident title match, but keep looking while the season is
    // still ambiguous — a later spelling may settle it.
    const confident = pickBestShowMatch(found, matchQuery);
    if (confident && scoreShowCandidate(confident, matchQuery) >= CONFIDENT_SHOW_MATCH_SCORE) break;
  }

  const best = pickBestShowMatch([...candidates.values()], matchQuery);
  if (!best) return null;
  return { providerId: best.providerId };
}
