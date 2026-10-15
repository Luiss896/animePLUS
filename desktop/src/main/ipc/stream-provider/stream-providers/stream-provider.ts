import type { SearchFilterDefinition, SearchFilterValues } from "@/shared/search-filters";
import type { StreamProviderName } from "@/shared/stream-providers";
import { Episode, ShowSearchResult } from "@/shared/types";

import { AllAnimeStreamProvider } from "./allanime/allanime-stream-provider";
import { AnidbStreamProvider } from "./anidb/anidb-stream-provider";
import { AnimePaheStreamProvider } from "./animepahe-stream-provider";
import { AnimeParadiseStreamProvider } from "./animeparadise-stream-provider";
import { AnimeUnityStreamProvider } from "./animeunity/animeunity-stream-provider";
import { HianimeStreamProvider } from "./hianime/hianime-stream-provider";
import { ReanimeStreamProvider } from "./reanime/reanime-stream-provider";
import { SenshiStreamProvider } from "./senshi/senshi-stream-provider";

export type { StreamProviderName };

export interface StreamSubtitleTrack {
  url: string;
  language: string;
  format: string;
  default?: boolean;
}

export interface StreamQualityOption {
  /** Stable id — usually the variant playlist URI from the master. */
  id: string;
  label: string;
  height?: number;
  bandwidth?: number;
}

export interface StreamUrlResult {
  url: string;
  referer: string;
  subtitles?: StreamSubtitleTrack[];
  /** HLS video renditions when the provider returns a multi-variant master. */
  qualities?: StreamQualityOption[];
  /** Default/selected quality id from `qualities` (highest when omitted by callers). */
  selectedQuality?: string;
  /** AniList media id when the provider can resolve one (e.g. HiAnime embed MAL). */
  anilistMediaId?: number;
  /**
   * True when `url` is an HLS master whose URL does **not** end in `.m3u8`.
   *
   * Playlist detection is otherwise purely suffix-based (`isHlsPlaylistUrl`),
   * and some hosts serve HLS from extensionless paths — VixCloud uses
   * `/playlist/{id}?token=...`. Without this flag the player receives a proxy
   * URL with no `.m3u8` suffix, does not treat the stream as HLS, and hands the
   * manifest to the browser's native demuxer, which fails.
   */
  isHlsMaster?: boolean;
}

export type StreamMode = "sub" | "dub";

export interface StreamProvider {
  getStreamUrl(
    id: string | null,
    providerId: string | null,
    episode: string,
    mode: StreamMode
  ): Promise<StreamUrlResult>;
  getRecentUploads(page: number, limit?: number, mode?: StreamMode): Promise<Episode[]>;
  search(query: string, filters?: SearchFilterValues): Promise<ShowSearchResult[]>;
  /** Provider-specific browse filters; empty → search UI shows only the query bar. */
  getSearchFilters(): SearchFilterDefinition[];
}

export const streamProviders: Record<StreamProviderName, StreamProvider> = {
  hianime: new HianimeStreamProvider(),
  allanime: new AllAnimeStreamProvider(),
  animeunity: new AnimeUnityStreamProvider(),
  anidb: new AnidbStreamProvider(),
  animepahe: new AnimePaheStreamProvider(),
  animeparadise: new AnimeParadiseStreamProvider(),
  reanime: new ReanimeStreamProvider(),
  senshi: new SenshiStreamProvider(),
};
