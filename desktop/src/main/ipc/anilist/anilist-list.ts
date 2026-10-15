import type {
  AniListFuzzyDate,
  AniListListEntry,
  AniListMediaListStatus,
  AniListSaveListEntryInput,
  AniListSyncWatchProgressInput,
} from "@/shared/types";

import { getAniListViewerId, postAniListAuthedGraphql } from "./anilist-authed-api";

const MEDIA_LIST_FIELDS = `
  id
  status
  progress
  score
  repeat
  startedAt { year month day }
  completedAt { year month day }
  media {
    id
    title { english romaji native userPreferred }
    coverImage { extraLarge large }
    bannerImage
    episodes
    averageScore
    season
    seasonYear
    status
  }
`;

const MEDIA_LIST_PAGE_QUERY = `
  query ($userId: Int, $status: MediaListStatus, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        total
        perPage
        currentPage
        lastPage
        hasNextPage
      }
      mediaList(userId: $userId, status: $status, sort: UPDATED_TIME_DESC, type: ANIME) {
        ${MEDIA_LIST_FIELDS}
      }
    }
  }
`;

const SAVE_MEDIA_LIST_ENTRY_MUTATION = `
  mutation (
    $id: Int
    $mediaId: Int
    $status: MediaListStatus
    $progress: Int
    $startedAt: FuzzyDateInput
    $completedAt: FuzzyDateInput
  ) {
    SaveMediaListEntry(
      id: $id
      mediaId: $mediaId
      status: $status
      progress: $progress
      startedAt: $startedAt
      completedAt: $completedAt
    ) {
      ${MEDIA_LIST_FIELDS}
    }
  }
`;

const DELETE_MEDIA_LIST_ENTRY_MUTATION = `
  mutation ($id: Int) {
    DeleteMediaListEntry(id: $id) {
      deleted
    }
  }
`;

interface AniListPageInfo {
  total?: number | null;
  perPage?: number | null;
  currentPage?: number | null;
  lastPage?: number | null;
  hasNextPage?: boolean | null;
}

/**
 * `AniListPageInfo` extended with the read outcome, so callers can tell a
 * complete list from one that hit the ceiling.
 */
interface AniListListReadInfo extends AniListPageInfo {
  truncated: boolean;
  entriesRead: number;
  uniqueMediaRead: number;
}

interface AniListListEntryRaw {
  id: number;
  status?: string | null;
  progress?: number | null;
  score?: number | null;
  repeat?: number | null;
  startedAt?: AniListFuzzyDate | null;
  completedAt?: AniListFuzzyDate | null;
  media?: {
    id?: number | null;
    title?: {
      english?: string | null;
      romaji?: string | null;
      native?: string | null;
      userPreferred?: string | null;
    } | null;
    coverImage?: { extraLarge?: string | null; large?: string | null } | null;
    bannerImage?: string | null;
    episodes?: number | null;
    averageScore?: number | null;
    season?: string | null;
    seasonYear?: number | null;
    status?: string | null;
  } | null;
}

function mapListEntry(raw: AniListListEntryRaw): AniListListEntry | null {
  const mediaId = raw.media?.id;
  if (!Number.isInteger(mediaId) || mediaId <= 0) return null;
  if (!raw.status) return null;

  return {
    id: raw.id,
    status: raw.status as AniListMediaListStatus,
    progress: raw.progress ?? 0,
    score: raw.score ?? undefined,
    repeat: raw.repeat ?? 0,
    startedAt: raw.startedAt ?? null,
    completedAt: raw.completedAt ?? null,
    media: {
      id: mediaId,
      title: raw.media?.title ?? null,
      coverImage: raw.media?.coverImage ?? null,
      bannerImage: raw.media?.bannerImage ?? null,
      episodes: raw.media?.episodes ?? null,
      averageScore: raw.media?.averageScore ?? null,
      season: raw.media?.season ?? null,
      seasonYear: raw.media?.seasonYear ?? null,
      status: raw.media?.status ?? null,
    },
  };
}

function todayFuzzyDate(): AniListFuzzyDate {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

/**
 * AniList caps `perPage` at 50 for list connections.
 */
const MEDIA_LIST_PAGE_SIZE = 50;

/**
 * How many entries a single status list is read up to.
 *
 * The loop stops here and reports it through `pageInfo.truncated` instead of
 * pretending the list ended, so a genuinely oversized list is visible rather
 * than silently short.
 */
const MEDIA_LIST_MAX_ENTRIES = 2000;

export interface AniListMediaListResult {
  entries: AniListListEntry[];
  pageInfo: AniListListReadInfo;
}

/**
 * Reads a status list to the end.
 *
 * Bookmark tabs used to render page 1 only: a single request with `perPage: 50`
 * and no follow-up, so on any list longer than 50 entries everything past the
 * 50th — sorted by `UPDATED_TIME_DESC`, i.e. the most recently touched shows,
 * including a freshly added new season — was dropped without a trace. `page` is
 * still accepted so existing callers keep working, but it now only seeds the
 * first page of the walk.
 */
export async function fetchAniListMediaList(
  status: AniListMediaListStatus,
  page = 1,
  perPage = MEDIA_LIST_PAGE_SIZE
): Promise<AniListMediaListResult> {
  const userId = await getAniListViewerId();
  const pageSize = Math.min(Math.max(perPage, 1), MEDIA_LIST_PAGE_SIZE);

  const entries: AniListListEntry[] = [];
  const seenEntryIds = new Set<number>();
  const seenMediaIds = new Set<number>();
  let currentPage = Math.max(page, 1);
  let truncated = false;
  let lastPageInfo: AniListPageInfo = {};

  for (;;) {
    const data = await postAniListAuthedGraphql<{
      Page?: {
        pageInfo?: AniListPageInfo;
        mediaList?: (AniListListEntryRaw | null)[] | null;
      } | null;
    }>(MEDIA_LIST_PAGE_QUERY, { userId, status, page: currentPage, perPage: pageSize });

    const raw = data.Page?.mediaList ?? [];
    lastPageInfo = data.Page?.pageInfo ?? {};

    // An empty page is the real terminator. Without this, exhausting the list
    // on an exact multiple of the page size would keep requesting next pages.
    if (raw.length === 0) break;

    for (const item of raw) {
      if (item == null) continue;
      const entry = mapListEntry(item);
      if (!entry) continue;
      // Guard against double-counting if AniList shifts the window between
      // requests while the list is being re-sorted.
      if (seenEntryIds.has(entry.id)) continue;
      seenEntryIds.add(entry.id);
      seenMediaIds.add(entry.media.id);
      entries.push(entry);
    }

    if (!lastPageInfo.hasNextPage) break;
    if (entries.length >= MEDIA_LIST_MAX_ENTRIES) {
      truncated = true;
      break;
    }
    if (typeof lastPageInfo.lastPage === "number" && currentPage >= lastPageInfo.lastPage) break;

    currentPage += 1;
  }

  return {
    entries,
    pageInfo: {
      ...lastPageInfo,
      currentPage: page,
      perPage: pageSize,
      hasNextPage: truncated,
      truncated,
      total: lastPageInfo.total ?? entries.length,
      entriesRead: entries.length,
      uniqueMediaRead: seenMediaIds.size,
    },
  };
}

export async function saveAniListMediaListEntry(
  input: AniListSaveListEntryInput
): Promise<AniListListEntry> {
  const variables: Record<string, unknown> = {};
  if (input.id != null) variables.id = input.id;
  if (input.mediaId != null) variables.mediaId = input.mediaId;
  if (input.status != null) variables.status = input.status;
  if (input.progress != null) variables.progress = input.progress;
  if (input.startedAt != null) variables.startedAt = input.startedAt;
  if (input.completedAt != null) variables.completedAt = input.completedAt;

  const data = await postAniListAuthedGraphql<{
    SaveMediaListEntry?: AniListListEntryRaw | null;
  }>(SAVE_MEDIA_LIST_ENTRY_MUTATION, variables);

  const entry = data.SaveMediaListEntry ? mapListEntry(data.SaveMediaListEntry) : null;
  if (!entry) {
    throw new Error("Failed to save AniList list entry.");
  }
  return entry;
}

export async function deleteAniListMediaListEntry(listEntryId: number): Promise<void> {
  await postAniListAuthedGraphql(DELETE_MEDIA_LIST_ENTRY_MUTATION, { id: listEntryId });
}

export async function syncAniListWatchProgress(
  input: AniListSyncWatchProgressInput
): Promise<AniListListEntry | null> {
  const { mediaId, episodeNumber, totalEpisodes, currentStatus, listEntryId } = input;
  if (!Number.isInteger(mediaId) || mediaId <= 0) return null;
  if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) return null;

  const isLastEpisode =
    Number.isInteger(totalEpisodes) && totalEpisodes > 0 && episodeNumber >= totalEpisodes;
  const isEpisodeCompleted = input.episodeCompleted === true;

  let status: AniListMediaListStatus;
  if (isLastEpisode && isEpisodeCompleted) {
    status = "COMPLETED";
  } else if (currentStatus === "COMPLETED") {
    status = "REPEATING";
  } else if (currentStatus === "REPEATING") {
    status = "REPEATING";
  } else {
    status = "CURRENT";
  }

  const saveInput: AniListSaveListEntryInput = {
    id: listEntryId,
    mediaId: listEntryId == null ? mediaId : undefined,
    status,
    progress: episodeNumber,
  };

  const isNewWatchSession =
    currentStatus == null || currentStatus === "PLANNING" || currentStatus === "PAUSED";
  if ((status === "CURRENT" || status === "REPEATING") && isNewWatchSession) {
    saveInput.startedAt = todayFuzzyDate();
  }
  if (status === "COMPLETED") {
    saveInput.completedAt = todayFuzzyDate();
    if (Number.isInteger(totalEpisodes) && totalEpisodes > 0) {
      saveInput.progress = totalEpisodes;
    }
  }

  return saveAniListMediaListEntry(saveInput);
}
