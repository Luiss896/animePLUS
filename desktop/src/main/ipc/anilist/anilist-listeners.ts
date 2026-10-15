import { ipcMain } from "electron";

import { isIncognitoEnabled } from "@/main/ipc/privacy/privacy-store";
import type {
  AniListMediaListStatus,
  AniListMediaPageVariables,
  AniListSaveListEntryInput,
  AniListSyncWatchProgressInput,
} from "@/shared/types";

import {
  ANILIST_CONNECT_CHANNEL,
  ANILIST_DELETE_LIST_ENTRY_CHANNEL,
  ANILIST_DISCONNECT_CHANNEL,
  ANILIST_GET_FAVOURITES_CHANNEL,
  ANILIST_GET_MEDIA_LIST_CHANNEL,
  ANILIST_GET_STATUS_CHANNEL,
  ANILIST_OPEN_PIN_AUTH_CHANNEL,
  ANILIST_POPULAR_SEASON_CHANNEL,
  ANILIST_SAVE_LIST_ENTRY_CHANNEL,
  ANILIST_SEARCH_CHANNEL,
  ANILIST_SHOW_DETAILS_CHANNEL,
  ANILIST_SUBMIT_MANUAL_TOKEN_CHANNEL,
  ANILIST_SYNC_WATCH_PROGRESS_CHANNEL,
  ANILIST_TOGGLE_FAVOURITE_CHANNEL,
  ANILIST_UPCOMING_SEASONS_CHANNEL,
  ANILIST_AUTO_ADD_SEQUELS_GET_CHANNEL,
  ANILIST_AUTO_ADD_SEQUELS_SET_CHANNEL,
  ANILIST_AUTO_ADD_RUN_CHANNEL,
} from "./anilist-channels";
import {
  autoAddMissingSequels,
  isAutoAddSequelsEnabled,
  setAutoAddSequelsEnabled,
} from "./anilist-auto-add";
import { fetchAniListFavourites, toggleAniListFavourite } from "./anilist-favourites";
import {
  deleteAniListMediaListEntry,
  fetchAniListMediaList,
  saveAniListMediaListEntry,
  syncAniListWatchProgress,
} from "./anilist-list";
import {
  clearAniListAccessToken,
  connectAniListAccount,
  getAniListIntegrationStatus,
  openAniListPinAuthInBrowser,
  submitAniListManualToken,
} from "./anilist-oauth";
import { getAniListPopularSeasonAnime } from "./anilist-popular-season";
import { searchAniListMedia } from "./anilist-search";
import { getAniListShowDetails } from "./anilist-show-details";
import { getAniListViewerId } from "./anilist-authed-api";
import { clearUpcomingSeasonsCache, fetchUpcomingSeasons } from "./anilist-upcoming-seasons";

/**
 * Drops the cached Following result after anything that changes the user's list.
 *
 * The cache lives for 30 minutes, so without this a show added from the app — or
 * simply watched — stayed invisible on Following until the entry expired, which
 * reads as "the page ignores my new additions". Refresh bypassed the cache by
 * passing `force`, but every other path showed stale data.
 */
function invalidateUpcomingSeasons(): void {
  clearUpcomingSeasonsCache();
}

export function addAniListListeners() {
  ipcMain.handle(ANILIST_SHOW_DETAILS_CHANNEL, (_event, mediaId: number) =>
    getAniListShowDetails(mediaId)
  );
  ipcMain.handle(ANILIST_SEARCH_CHANNEL, (_event, variables: AniListMediaPageVariables) =>
    searchAniListMedia(variables)
  );
  ipcMain.handle(ANILIST_POPULAR_SEASON_CHANNEL, () => getAniListPopularSeasonAnime());

  ipcMain.handle(ANILIST_CONNECT_CHANNEL, () => connectAniListAccount());

  ipcMain.handle(ANILIST_DISCONNECT_CHANNEL, () => clearAniListAccessToken());

  ipcMain.handle(ANILIST_OPEN_PIN_AUTH_CHANNEL, () => openAniListPinAuthInBrowser());

  ipcMain.handle(ANILIST_SUBMIT_MANUAL_TOKEN_CHANNEL, (_event, rawToken: unknown) =>
    submitAniListManualToken(rawToken)
  );

  ipcMain.handle(ANILIST_GET_STATUS_CHANNEL, () => getAniListIntegrationStatus());

  ipcMain.handle(
    ANILIST_GET_MEDIA_LIST_CHANNEL,
    (_event, status: AniListMediaListStatus, page?: number) =>
      fetchAniListMediaList(status, page ?? 1)
  );

  ipcMain.handle(ANILIST_GET_FAVOURITES_CHANNEL, (_event, page?: number) =>
    fetchAniListFavourites(page ?? 1)
  );

  ipcMain.handle(
    ANILIST_SAVE_LIST_ENTRY_CHANNEL,
    async (_event, input: AniListSaveListEntryInput) => {
      const entry = await saveAniListMediaListEntry(input);
      invalidateUpcomingSeasons();
      return entry;
    }
  );

  ipcMain.handle(ANILIST_DELETE_LIST_ENTRY_CHANNEL, async (_event, listEntryId: number) => {
    await deleteAniListMediaListEntry(listEntryId);
    invalidateUpcomingSeasons();
  });

  ipcMain.handle(ANILIST_TOGGLE_FAVOURITE_CHANNEL, (_event, mediaId: number) =>
    toggleAniListFavourite(mediaId)
  );

  ipcMain.handle(
    ANILIST_SYNC_WATCH_PROGRESS_CHANNEL,
    async (_event, input: AniListSyncWatchProgressInput) => {
      if (isIncognitoEnabled()) return null;
      const entry = await syncAniListWatchProgress(input);
      // Progress can move a show between statuses, which changes what is airing.
      invalidateUpcomingSeasons();
      return entry;
    }
  );

  ipcMain.handle(ANILIST_UPCOMING_SEASONS_CHANNEL, (_event, force?: boolean) =>
    fetchUpcomingSeasons({ force: force === true })
  );

  ipcMain.handle(ANILIST_AUTO_ADD_SEQUELS_GET_CHANNEL, () => isAutoAddSequelsEnabled());

  ipcMain.handle(ANILIST_AUTO_ADD_SEQUELS_SET_CHANNEL, (_event, enabled: unknown) => {
    setAutoAddSequelsEnabled(enabled === true);
    return isAutoAddSequelsEnabled();
  });

  ipcMain.handle(ANILIST_AUTO_ADD_RUN_CHANNEL, async () => {
    if (isIncognitoEnabled()) {
      return { enabled: false, added: [], truncated: false };
    }
    if (!isAutoAddSequelsEnabled()) {
      return { enabled: false, added: [], truncated: false };
    }
    const userId = await getAniListViewerId();
    return autoAddMissingSequels(userId);
  });
}
