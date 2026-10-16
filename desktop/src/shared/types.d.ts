import { AppUpdateCheckResult } from "./app-update-types";
import type { SearchFilterDefinition, SearchFilterValues } from "./search-filters";
import type { StreamProviderName } from "./stream-providers";
import type { AutoAddResult, UpcomingSeasonsResult } from "./upcoming-seasons-types";
import type { PartyMessage } from "./watch-party/protocol";

interface ThemeContext {
  toggle: () => Promise<boolean>;
  dark: () => Promise<void>;
  light: () => Promise<void>;
  system: () => Promise<boolean>;
  current: () => Promise<"dark" | "light" | "system">;
}

type StreamMode = "sub" | "dub";

/**
 * Derived from the single source of truth in `stream-providers.config.ts`.
 *
 * This used to be a hand-maintained union that listed every provider name a
 * second time, so adding one produced type errors in unrelated renderer files
 * until the list was updated by hand. Aliasing the config type removes that
 * duplication: a new provider is now registered in one place only.
 */
type StreamProvider = StreamProviderName;

interface Show {
  id: string;
  providerId: string;
  name: string;
  episodeCount: number;
  mode: StreamMode;
  hasSub?: boolean;
  hasDub?: boolean;
}

interface Bookmark {
  status: "watching" | "plan_to_watch" | "completed" | "rewatching" | "paused" | "dropped";
  show: Show;
  score?: number;
  startedAt?: Date;
  completedAt?: Date;
  progress: number;
  rewatchedCount: number;
  notes?: string;
}

interface ShowSearchResult {
  id: string;
  providerId: string;
  title: {
    english?: string;
    romanji?: string;
    native?: string;
  };
  thumbnail: string | null;
  availableEpisodes?: {
    sub?: number;
    dub?: number;
    raw?: number;
  };
  score?: number;
  status?: string;
  type?: string;
  episodeDuration?: number;
  season?: {
    quarter?: string;
    year?: number;
  };
}

interface Episode {
  id: string;
  providerId: string;
  title: {
    english?: string;
    romanji?: string;
    native?: string;
  };
  thumbnail: string | null;
  index: number;
  mode: StreamMode;
  /**
   * Name of the series this episode belongs to.
   *
   * Kept separate from `title` because the history entry already stores the
   * *show* name in `title`, so a card showing only `title` could not distinguish
   * "which series" from "which episode". Optional: entries written before this
   * field existed simply lack it.
   */
  showName?: string;
}

interface StreamQualityOption {
  id: string;
  label: string;
  height?: number;
  bandwidth?: number;
}

interface StreamUrlResult {
  url: string;
  referer: string;
  subtitles?: Array<{
    url: string;
    language: string;
    format: string;
    default?: boolean;
  }>;
  qualities?: StreamQualityOption[];
  selectedQuality?: string;
  anilistMediaId?: number;
  /** True when the master is HLS but its URL carries no `.m3u8` suffix. */
  isHlsMaster?: boolean;
}

interface TranscodeProgressResult {
  state: "idle" | "running" | "done" | "error";
  progressPercent: number | null;
  message: string;
}

/**
 * Quality facts about the HLS master most recently served through the local
 * proxy. The proxy collapses multi-rendition masters to a single variant before
 * the player sees them, so this snapshot is the only way the renderer can learn
 * whether a 1080p rendition was ever available upstream.
 */
interface StreamQualitySnapshot {
  servedHeight: number | null;
  maxHeight: number | null;
  meetsPreferred: boolean;
  variantCount: number;
  observedAt: number;
}

/** Anime4K shader strength applied over the video surface. */
type ShaderPresetId = "off" | "mode-b" | "mode-a" | "mode-c" | "mode-aa" | "gan";

interface ShowDetails {
  id: string;
  providerId: string;
  name: string;
  thumbnail: string | null;
  type: string;
  description?: string | null;
  anilistId?: string | null;
}

export interface AniListShowDetails {
  id?: number;
  streamingEpisodes?: Array<{
    thumbnail?: string | null;
    title?: string | null;
  }> | null;
  bannerImage?: string | null;
  coverImage?: {
    extraLarge?: string | null;
    large?: string | null;
    medium?: string | null;
    color?: string | null;
  } | null;
  description?: string | null;
  title?: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
    userPreferred?: string | null;
  } | null;
  duration?: number | null;
  episodes?: number | null;
  averageScore?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  status?: string | null;
  type?: string | null;
  format?: string | null;
  genres?: string[] | null;
  isAdult?: boolean | null;
  popularity?: number | null;
  chapters?: number | null;
  volumes?: number | null;
  startDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
  endDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  } | null;
  nextAiringEpisode?: {
    airingAt: number;
    timeUntilAiring: number;
    episode: number;
  } | null;
  mediaListEntry?: {
    id: number;
    status: string;
    progress?: number | null;
    startedAt?: AniListFuzzyDate | null;
    completedAt?: AniListFuzzyDate | null;
  } | null;
  isFavourite?: boolean | null;
  studios?: Array<{
    isMain?: boolean | null;
    node: { id: number; name: string };
  }>;
}

export interface AniListMediaPageVariables {
  page?: number;
  id?: number;
  type?: string;
  isAdult?: boolean;
  search?: string;
  format?: string[];
  status?: string;
  countryOfOrigin?: string;
  source?: string;
  season?: string;
  seasonYear?: number;
  year?: string;
  onList?: boolean;
  yearLesser?: number;
  yearGreater?: number;
  episodeLesser?: number;
  episodeGreater?: number;
  durationLesser?: number;
  durationGreater?: number;
  chapterLesser?: number;
  chapterGreater?: number;
  volumeLesser?: number;
  volumeGreater?: number;
  licensedBy?: number[];
  isLicensed?: boolean;
  genres?: string[];
  excludedGenres?: string[];
  tags?: string[];
  excludedTags?: string[];
  minimumTagRank?: number;
  /** GraphQL expects `[MediaSort]`; a single string is normalized to a one-element array. */
  sort?: string[] | string;
}

export interface AniListMediaPageResult {
  pageInfo: {
    total?: number | null;
    perPage?: number | null;
    currentPage?: number | null;
    lastPage?: number | null;
    hasNextPage?: boolean | null;
  };
  media: AniListShowDetails[];
}

export type AniListIntegrationStatus = { connected: false } | { connected: true; username: string };

export type AniListMediaListStatus =
  | "CURRENT"
  | "PLANNING"
  | "COMPLETED"
  | "REPEATING"
  | "PAUSED"
  | "DROPPED";

export interface AniListFuzzyDate {
  year?: number | null;
  month?: number | null;
  day?: number | null;
}

export interface AniListListMedia {
  id: number;
  title?: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
    userPreferred?: string | null;
  } | null;
  coverImage?: {
    extraLarge?: string | null;
    large?: string | null;
  } | null;
  bannerImage?: string | null;
  episodes?: number | null;
  averageScore?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  status?: string | null;
}

export interface AniListListEntry {
  id: number;
  status: AniListMediaListStatus;
  progress: number;
  score?: number;
  repeat: number;
  startedAt?: AniListFuzzyDate | null;
  completedAt?: AniListFuzzyDate | null;
  media: AniListListMedia;
}

export type AniListFavouriteMedia = AniListListMedia & {
  isFavourite: boolean;
};

export interface AniListListPageResult {
  entries: AniListListEntry[];
  pageInfo: {
    total?: number | null;
    perPage?: number | null;
    currentPage?: number | null;
    lastPage?: number | null;
    hasNextPage?: boolean | null;
    /**
     * True when the list was longer than the read ceiling and `entries` stops
     * short. Surfaced so an incomplete list is reported instead of looking
     * complete — the old code truncated at 50 entries silently.
     */
    truncated?: boolean;
    /** Entries actually returned. */
    entriesRead?: number;
    /** Distinct media behind those entries (a show can hold several entries). */
    uniqueMediaRead?: number;
  };
}

export interface AniListFavouritesPageResult {
  media: AniListFavouriteMedia[];
  pageInfo: {
    total?: number | null;
    perPage?: number | null;
    currentPage?: number | null;
    lastPage?: number | null;
    hasNextPage?: boolean | null;
  };
}

export interface AniListSaveListEntryInput {
  id?: number;
  mediaId?: number;
  status?: AniListMediaListStatus;
  progress?: number;
  startedAt?: AniListFuzzyDate;
  completedAt?: AniListFuzzyDate;
}

export interface AniListSyncWatchProgressInput {
  mediaId: number;
  episodeNumber: number;
  totalEpisodes?: number;
  currentStatus?: AniListMediaListStatus | null;
  listEntryId?: number | null;
  episodeCompleted?: boolean;
}

interface HistoryEntry {
  id: string;
  provider: StreamProvider;
  episode: Episode;
  currentDurationMs: number;
  totalDurationMs: number;
  timestamp: number;
}

interface RecentlyWatchedContext {
  upsert: (entry: HistoryEntry) => Promise<void>;
  upsertSync: (entry: HistoryEntry) => void;
  read: () => Promise<HistoryEntry[]>;
  clear: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/** Connection state reported by whichever transport is running. */
type PartyConnectionState =
  | "idle"
  | "listening"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

interface PartyStatusEvent {
  state: PartyConnectionState;
  error?: string;
}

interface PartyHostInfo {
  port: number;
  pin: string;
  addresses: string[];
}

/**
 * Watch party bridge.
 *
 * `onMessage`/`onStatus` register a single handler rather than returning an
 * unsubscribe function: the preload owns one `ipcRenderer` listener per channel and
 * forwards to the most recently registered callback, which avoids depending on
 * how `contextBridge` proxies functions in both directions.
 */
interface WatchPartyContext {
  startHost: (hostName?: string) => Promise<PartyHostInfo>;
  join: (
    address: string,
    pin: string
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  send: (message: unknown) => Promise<{ ok: boolean; error?: string }>;
  stop: () => Promise<void>;
  listAddresses: () => Promise<
    Array<{ address: string; iface: string; isPrivate: boolean }>
  >;
  getDisplayName: () => Promise<string>;
  setDisplayName: (name: string) => Promise<string>;
  warmInbound: () => Promise<number | null>;
  stopWarmInbound: () => Promise<void>;
  onMessage: (cb: (msg: PartyMessage) => void) => void;
  onStatus: (cb: (status: PartyStatusEvent) => void) => void;
  clearHandlers: () => void;
}

interface PrivacyContext {
  getIncognito: () => Promise<boolean>;
  setIncognito: (enabled: boolean) => Promise<boolean>;
}

interface AppContext {
  version: () => Promise<string>;
  os: () => Promise<string>;
  /** True when required system dependencies are missing (e.g. Git Bash on Windows). */
  dependenciesRequired: () => Promise<boolean>;
  checkForUpdate: () => Promise<AppUpdateCheckResult>;
  /** Opens the app log directory in the system file manager. */
  openLogsDirectory: () => Promise<void>;
}

interface WindowControlsContext {
  minimize: () => Promise<void>;
  close: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  isMaximized: () => Promise<boolean>;
}

export interface UrlOpenerContext {
  openUrl: (url: string) => Promise<void>;
}

interface StreamProviderContext {
  getActiveProvider: () => Promise<StreamProvider>;
  setActiveProvider: (provider: StreamProvider) => Promise<StreamProvider>;
  /**
   * `providerName` searches a specific host without changing the active one,
   * which is what lets the player resolve a show on another host before
   * switching to it.
   */
  search: (
    query: string,
    filters?: SearchFilterValues,
    providerName?: StreamProvider
  ) => Promise<ShowSearchResult[]>;
  getSearchFilters: () => Promise<SearchFilterDefinition[]>;
  getEpisodes: (
    providerId: string,
    mode?: "sub" | "dub",
    providerName?: StreamProvider
  ) => Promise<string[]>;
  getStreamUrl: (
    id: string | null,
    providerId: string | null,
    episode: string,
    mode?: "sub" | "dub",
    providerName?: StreamProvider
  ) => Promise<StreamUrlResult>;
  getStreamProxyBaseUrl: () => Promise<string>;
  prepareTranscodedStream: (
    targetUrl: string,
    referer: string | null,
    variant?: string | null
  ) => Promise<boolean>;
  cancelTranscodedStream: (targetUrl: string, variant?: string | null) => Promise<boolean>;
  getTranscodeProgress: (
    targetUrl: string,
    variant?: string | null
  ) => Promise<TranscodeProgressResult>;
  getShowDetails: (providerId: string, providerName?: StreamProvider) => Promise<ShowDetails>;
  getRecentUploads: (page: number, limit?: number) => Promise<Episode[]>;
  /** Quality facts about the master most recently served through the proxy. */
  getLastQualitySnapshot: () => Promise<StreamQualitySnapshot | null>;
}

export interface AniListContext {
  getShowDetails: (mediaId: number) => Promise<AniListShowDetails>;
  search: (variables: AniListMediaPageVariables) => Promise<AniListMediaPageResult>;
  getPopularSeason: () => Promise<AniListShowDetails[]>;

  connect: () => Promise<{ ok: true } | { ok: false; error: string }>;
  disconnect: () => Promise<void>;
  getStatus: () => Promise<AniListIntegrationStatus>;
  openPinAuthPage: () => Promise<void>;
  submitManualToken: (token: string) => Promise<{ ok: true } | { ok: false; error: string }>;

  getMediaList: (
    status: AniListMediaListStatus,
    page?: number
  ) => Promise<AniListListPageResult>;
  getFavourites: (page?: number) => Promise<AniListFavouritesPageResult>;
  saveListEntry: (input: AniListSaveListEntryInput) => Promise<AniListListEntry>;
  deleteListEntry: (listEntryId: number) => Promise<void>;
  toggleFavourite: (mediaId: number) => Promise<boolean>;
  syncWatchProgress: (input: AniListSyncWatchProgressInput) => Promise<AniListListEntry | null>;
  /** Upcoming seasons for shows on the user's list. `force` bypasses the cache. */
  getUpcomingSeasons: (force?: boolean) => Promise<UpcomingSeasonsResult>;
  /** Whether announced sequels are added to the list automatically. */
  getAutoAddSequels: () => Promise<boolean>;
  setAutoAddSequels: (enabled: boolean) => Promise<boolean>;
  /** Runs an auto-add pass now; returns what was added. */
  runAutoAddSequels: () => Promise<AutoAddResult>;
}

declare global {
  interface Window {
    app: AppContext;
    theme: ThemeContext;
    privacy: PrivacyContext;
    streamProvider: StreamProviderContext;
    anilist: AniListContext;
    recentlyWatched: RecentlyWatchedContext;
    watchParty: WatchPartyContext;
    windowControls: WindowControlsContext;
    urlOpener: UrlOpenerContext;
  }
}
