import { useEffect, useState } from "react";

import { getEnabledStreamProviders, type StreamProviderName } from "@/shared/stream-providers";
import type { AniListShowDetails, ShowDetails } from "@/shared/types";

type AnimeMode = "sub" | "dub";

export type EpisodesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; episodes: string[] }
  | { status: "error"; message: string };

export type RichEpisode = {
  index: number;
  thumbnail?: string | null;
  title?: string | null;
};

export type RichShowDetails = {
  id: string;
  providerId: string;
  title: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
  };
  description: string | null;
  coverImage: string | null;
  bannerImage: string | null;
  episodes: {
    sub?: RichEpisode[];
    dub?: RichEpisode[];
    raw?: RichEpisode[];
  };
  duration?: number | null;
  averageScore?: number | null;
  season?: string | null;
  seasonYear?: number | null;
  status?: string | null;
  anilistMediaId?: number | null;
  anilistListEntry?: {
    id: number;
    status: string;
    progress?: number | null;
  } | null;
  anilistIsFavourite?: boolean;
};

interface UseShowDetailsResult {
  details: RichShowDetails | null;
  episodesByMode: Record<AnimeMode, EpisodesState>;
  loading: boolean;
  error: string | null;
  /**
   * Host that actually answered for this provider id.
   *
   * Provider ids are host-specific, and the active host setting can change
   * between the moment a show id is captured (search results, "recently
   * uploaded" cards) and the moment it is used. The id is authoritative, the
   * setting is only a preference, so every enabled host is tried in turn and this
   * is the one that resolved it — callers must carry it forward to the watch
   * page, otherwise playback repeats the same mistake.
   */
  provider: StreamProviderName | null;
}

function parseEpisodeIndex(episode: string, fallbackIndex: number): number {
  const parsed = Number(episode);
  return Number.isFinite(parsed) ? parsed : fallbackIndex + 1;
}

function normalizeEpisodeTitle(title?: string | null): string | null {
  if (!title) return null;
  return title.replace(/^episode\s*\d+\s*-\s*/i, "").trim();
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Resolve an AniList media id from stream details / route ids.
 * Never treat a provider-native id as AniList (e.g. anidb.app numeric ids collide).
 */
function resolveAniListMediaId(
  animeId: string | undefined,
  providerId: string | undefined,
  streamDetails: ShowDetails
): number | null {
  const fromExplicit = asPositiveInt(streamDetails.anilistId);
  if (fromExplicit != null) return fromExplicit;

  const streamId = asPositiveInt(streamDetails.id);
  if (streamId != null && streamDetails.id !== streamDetails.providerId) {
    return streamId;
  }

  const fromParam = asPositiveInt(animeId);
  if (fromParam != null && animeId !== providerId && animeId !== streamDetails.providerId) {
    return fromParam;
  }

  return null;
}

function mapRichEpisodes(
  providerEpisodes: string[],
  streamingEpisodes?: AniListShowDetails["streamingEpisodes"] | null
): RichEpisode[] {
  return providerEpisodes.map((episode, position) => {
    const aniListEpisode = streamingEpisodes?.[position];
    return {
      index: parseEpisodeIndex(episode, position),
      thumbnail: aniListEpisode?.thumbnail ?? null,
      title: normalizeEpisodeTitle(aniListEpisode?.title),
    };
  });
}

function canonicalizeRichShowDetails(
  streamDetails: ShowDetails,
  subEpisodes: string[],
  dubEpisodes: string[],
  aniListDetails: AniListShowDetails | null,
  mediaId: number | null
): RichShowDetails {
  const coverImage =
    aniListDetails?.coverImage?.extraLarge ??
    aniListDetails?.coverImage?.large ??
    aniListDetails?.coverImage?.medium ??
    streamDetails.thumbnail ??
    null;

  return {
    id: mediaId != null ? String(mediaId) : streamDetails.id,
    providerId: streamDetails.providerId,
    title: {
      english: aniListDetails?.title?.english ?? streamDetails.name ?? null,
      romaji: aniListDetails?.title?.romaji ?? null,
      native: aniListDetails?.title?.native ?? null,
    },
    description: aniListDetails?.description ?? streamDetails.description ?? null,
    coverImage,
    bannerImage: aniListDetails?.bannerImage ?? null,
    episodes: {
      sub:
        subEpisodes.length > 0
          ? mapRichEpisodes(subEpisodes, aniListDetails?.streamingEpisodes)
          : [],
      dub:
        dubEpisodes.length > 0
          ? mapRichEpisodes(dubEpisodes, aniListDetails?.streamingEpisodes)
          : [],
    },
    duration: aniListDetails?.duration ?? null,
    averageScore: aniListDetails?.averageScore ?? null,
    season: aniListDetails?.season ?? null,
    seasonYear: aniListDetails?.seasonYear ?? null,
    status: aniListDetails?.status ?? null,
    anilistMediaId: mediaId,
    anilistListEntry: aniListDetails?.mediaListEntry ?? null,
    anilistIsFavourite: aniListDetails?.isFavourite === true,
  };
}

export function useShowDetails(
  animeId?: string,
  providerId?: string,
  providerOverride?: StreamProviderName
): UseShowDetailsResult {
  const [details, setDetails] = useState<RichShowDetails | null>(null);
  const [episodesByMode, setEpisodesByMode] = useState<Record<AnimeMode, EpisodesState>>({
    sub: { status: "idle" },
    dub: { status: "idle" },
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<StreamProviderName | null>(null);

  useEffect(() => {
    if (!animeId || !providerId) {
      setDetails(null);
      setEpisodesByMode({ sub: { status: "idle" }, dub: { status: "idle" } });
      setError(null);
      setProvider(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setEpisodesByMode({ sub: { status: "loading" }, dub: { status: "loading" } });

    void (async () => {
      try {
        const enabled = getEnabledStreamProviders();
        // The id decides which host can answer; the setting only says where to
        // start. A foreign id makes the first host fail (AnimeUnity answers 500
        // for a HiAnime slug, HiAnime mis-reads an AnimeUnity id), or — worse —
        // resolve to an unrelated show with no episodes, which is why an empty
        // episode list is treated as "keep looking" rather than as success.
        let preferred = providerOverride ?? null;
        if (!preferred) {
          try {
            preferred = await window.streamProvider.getActiveProvider();
          } catch {
            preferred = null;
          }
        }
        if (cancelled) return;

        const order: StreamProviderName[] = [];
        if (preferred) order.push(preferred);
        for (const name of enabled) {
          if (!order.includes(name)) order.push(name);
        }

        let best: {
          host: StreamProviderName;
          details: ShowDetails;
          sub: EpisodesState;
          dub: EpisodesState;
        } | null = null;
        let firstError: string | null = null;
        let nothingToPlay: { host: StreamProviderName; details: ShowDetails } | null = null;

        for (const host of order) {
          const [detailsResult, subResult, dubResult] = await Promise.allSettled([
            window.streamProvider.getShowDetails(providerId, host),
            window.streamProvider.getEpisodes(providerId, "sub", host),
            window.streamProvider.getEpisodes(providerId, "dub", host),
          ]);
          if (cancelled) return;

          if (detailsResult.status !== "fulfilled") {
            firstError ??=
              detailsResult.reason instanceof Error
                ? detailsResult.reason.message
                : `Failed to load details from ${host}`;
            continue;
          }

          const toEpisodesState = (
            result: PromiseSettledResult<string[]>,
            mode: AnimeMode
          ): EpisodesState =>
            result.status === "fulfilled"
              ? { status: "loaded", episodes: result.value }
              : {
                  status: "error",
                  message:
                    result.reason instanceof Error
                      ? result.reason.message
                      : `Failed to load ${mode} episodes`,
                };

          const sub = toEpisodesState(subResult, "sub");
          const dub = toEpisodesState(dubResult, "dub");
          if (!best) {
            nothingToPlay = { host, details: detailsResult.value };
          }
          const hasEpisodes =
            (sub.status === "loaded" && sub.episodes.length > 0) ||
            (dub.status === "loaded" && dub.episodes.length > 0);
          if (hasEpisodes) {
            best = { host, details: detailsResult.value, sub, dub };
            break;
          }
        }

        if (!best && nothingToPlay) {
          // No host listed any episode; show the one that at least resolved.
          best = {
            host: nothingToPlay.host,
            details: nothingToPlay.details,
            sub: { status: "loaded", episodes: [] },
            dub: { status: "loaded", episodes: [] },
          };
        }

        if (!best) {
          setDetails(null);
          setProvider(null);
          setError(firstError ?? "Failed to load details");
          return;
        }

        setProvider(best.host);
        setEpisodesByMode({ sub: best.sub, dub: best.dub });

        const streamDetails = best.details;
        const subEpisodes = best.sub.status === "loaded" ? best.sub.episodes : [];
        const dubEpisodes = best.dub.status === "loaded" ? best.dub.episodes : [];
        const mediaId = resolveAniListMediaId(animeId, providerId, streamDetails);

        let aniListDetails: AniListShowDetails | null = null;
        if (mediaId != null) {
          try {
            aniListDetails = await window.anilist.getShowDetails(mediaId);
          } catch {
            aniListDetails = null;
          }
        }

        if (cancelled) return;

        setDetails(
          canonicalizeRichShowDetails(
            streamDetails,
            subEpisodes,
            dubEpisodes,
            aniListDetails,
            mediaId
          )
        );
      } catch (err: unknown) {
        if (!cancelled) {
          setDetails(null);
          setProvider(null);
          setError(err instanceof Error ? err.message : "Failed to load details");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [animeId, providerId, providerOverride]);

  return { details, episodesByMode, loading, error, provider };
}
