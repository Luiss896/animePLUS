import {
  ArrowLeft,
  Loader2,
  Monitor,
  RefreshCw,
  Server,
  SkipForward,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  type SubtitlePreferences,
  readSubtitlePreferences,
  subtitleCueVariables,
  writeSubtitlePreferences,
} from "@/renderer/helpers/player/subtitle-preferences";
import { cn } from "@/renderer/lib/utils";
import {
  DEFAULT_OUTPUT_RESOLUTION_ID,
  OUTPUT_RESOLUTIONS,
  OUTPUT_RESOLUTION_IDS,
  type OutputResolutionId,
} from "@/shared/output-resolution";
import {
  DEFAULT_SHADER_PRESET_ID,
  SHADER_PRESETS,
  SHADER_PRESET_IDS,
  type ShaderPresetId,
} from "@/shared/shader-presets";

import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Anime4kShaderOverlay, type Anime4kShaderStatus } from "./anime4k-shader-overlay";
import { SubtitlePanel } from "./subtitle-panel";
import { type PlayerSubtitleTrack, VideoJsReactPlayer } from "./videojs-react-player";

const watchSelectTriggerClass =
  "h-8 w-[132px] shrink-0 border-white/25 bg-white/[0.12] text-white shadow-sm backdrop-blur-xl ring-offset-0 ring-offset-transparent placeholder:text-white/55 focus:ring-2 focus:ring-white/30 focus:ring-offset-0 hover:bg-white/[0.18] [&>svg]:text-white/75 [&>span]:truncate [&>span]:whitespace-nowrap";

const watchSelectContentClass =
  "z-[120] max-h-[min(24rem,70vh)] w-[min(20rem,85vw)] rounded-xl border border-white/20 bg-black/50 p-1 text-white shadow-2xl shadow-black/50 backdrop-blur-2xl";

const watchSelectItemClass =
  "rounded-lg py-2 pl-8 pr-2 text-white/95 cursor-pointer focus:bg-white/[0.14] focus:text-white data-[highlighted]:bg-white/[0.14] data-[highlighted]:text-white data-[state=checked]:bg-white/[0.08]";

const SHADER_LABELS: Record<ShaderPresetId, string> = SHADER_PRESET_IDS.reduce(
  (acc, id) => {
    acc[id] = SHADER_PRESETS[id].label;
    return acc;
  },
  {} as Record<ShaderPresetId, string>
);

/**
 * How far the "skip intro" control jumps.
 *
 * Every anime source shows the opening inside the episode, so there is no
 * separate item to skip: the only way to get past it is to move the playhead.
 * 90 seconds covers the usual TV opening (1:25 to 1:30 plus the cold open that
 * sometimes precedes it) while staying short enough that landing a few seconds
 * into the episode is a harmless correction rather than a lost scene.
 *
 * The range it is offered in matters as much as the amount:
 *
 *  - Before `INTRO_SKIP_VISIBLE_FROM_SECONDS` the button would be offered before
 *    the opening has actually started, inviting an accidental jump on every load.
 *  - After `INTRO_SKIP_WINDOW_SECONDS` the opening has passed for any normal
 *    episode, so the same jump would silently cut content. Hiding it there is
 *    what keeps this from being a second, unlabelled seek-forward button.
 */
const INTRO_SKIP_SECONDS = 90;
const INTRO_SKIP_VISIBLE_FROM_SECONDS = 1;
const INTRO_SKIP_WINDOW_SECONDS = 120;

function formatSkipLength(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

interface WatchVideoPlayerShellProps {
  playUrl: string;
  streamRevision: number;
  /** Provider says the source is HLS even though the URL carries no hint. */
  forceHls?: boolean;
  loadingEpisode: boolean;
  transcodeProgress: {
    active: boolean;
    progressPercent: number | null;
    message: string;
  } | null;
  streamError: string | null;
  playbackError: string | null;
  displayName: string;
  isDub: boolean;
  showLoading: boolean;
  hasShowDetails: boolean;
  showError: string | null;
  currentEpisode: number;
  videoRef: React.RefObject<HTMLVideoElement>;
  subtitleTracks?: PlayerSubtitleTrack[];
  /**
   * True when the current source burns subtitles into the video and therefore
   * offers no selectable track (AnimeUnity publishes Italian subs this way).
   * The panel then explains why nothing can be toggled.
   */
  hardcodedSubtitles?: boolean;
  streamQualities?: Array<{ id: string; label: string }>;
  selectedQuality?: string | null;
  /** Warn when no 1080p rendition exists upstream, or when none could be probed. */
  qualityWarning?: string | null;
  /** Hosts the user can switch to without leaving the episode. */
  availableHosts?: Array<{ id: string; label: string }>;
  /** Host currently in use, used to label the picker. */
  currentHost?: string | null;
  /** True while a host switch is resolving the show on the new source. */
  switchingHost?: boolean;
  /**
   * Keep the Host picker usable even though no stream loaded. Without this, a
   * failed load left the picker disabled and the user had to go back to
   * Settings to escape a broken source.
   */
  canSwitchHost?: boolean;
  onHostSelect?: (providerId: string) => void;
  onBack: () => void;
  onQualitySelect?: (qualityId: string) => void;
  onRetryStream: () => void;
  onLoadedMetadata: React.ReactEventHandler<HTMLVideoElement>;
  onPause: React.ReactEventHandler<HTMLVideoElement>;
  onEnded: React.ReactEventHandler<HTMLVideoElement>;
  onPlaying: React.ReactEventHandler<HTMLVideoElement>;
  onError: React.ReactEventHandler<HTMLVideoElement>;
}

export function WatchVideoPlayerShell({
  playUrl,
  streamRevision,
  forceHls,
  loadingEpisode,
  transcodeProgress,
  streamError,
  playbackError,
  displayName,
  isDub,
  showLoading,
  hasShowDetails,
  showError,
  currentEpisode,
  videoRef,
  subtitleTracks,
  hardcodedSubtitles,
  streamQualities,
  selectedQuality,
  qualityWarning,
  availableHosts,
  currentHost,
  switchingHost,
  canSwitchHost,
  onHostSelect,
  onBack,
  onQualitySelect,
  onRetryStream,
  onLoadedMetadata,
  onPause,
  onEnded,
  onPlaying,
  onError,
}: WatchVideoPlayerShellProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [arePlayerControlsVisible, setArePlayerControlsVisible] = useState(true);
  const [isTopChromeHovered, setIsTopChromeHovered] = useState(false);
  const [isSubtitleSelectOpen, setIsSubtitleSelectOpen] = useState(false);
  const [isQualitySelectOpen, setIsQualitySelectOpen] = useState(false);
  const [isShaderSelectOpen, setIsShaderSelectOpen] = useState(false);
  const [isOutputSelectOpen, setIsOutputSelectOpen] = useState(false);
  const [isHostSelectOpen, setIsHostSelectOpen] = useState(false);
  const [activeSubtitleLabel, setActiveSubtitleLabel] = useState<string | null>(null);
  const [shaderPreset, setShaderPreset] = useState<ShaderPresetId>(DEFAULT_SHADER_PRESET_ID);
  const [outputResolution, setOutputResolution] = useState<OutputResolutionId>(
    DEFAULT_OUTPUT_RESOLUTION_ID
  );
  const [shaderStatus, setShaderStatus] = useState<Anime4kShaderStatus>({ kind: "idle" });

  /*
   * Intro skip state.
   *
   * `playbackSeconds` mirrors the media element's own clock because the shell does
   * not receive playback position as a prop: the <video> is the source of truth,
   * and reading it once per `timeupdate` (about four times a second) is cheaper
   * than lifting playback state up into the watch page, which re-renders the
   * player tree.
   *
   * `introSkipped` is latched per stream rather than derived from the clock alone:
   * after a jump of 90 seconds the playhead is still inside the visible window for
   * another half minute, and a button that keeps offering the same jump reads as
   * broken.
   */
  const [playbackSeconds, setPlaybackSeconds] = useState(0);
  const [introSkipped, setIntroSkipped] = useState(false);

  /*
   * Subtitle appearance lives here rather than in the watch page because it is
   * purely presentational: the values are written as CSS custom properties that
   * `.oa-cue-scope video::cue` reads. They persist across sessions via
   * localStorage, so the styling is chosen once and then simply applies.
   */
  const [subtitlePreferences, setSubtitlePreferences] = useState<SubtitlePreferences>(() =>
    readSubtitlePreferences()
  );

  useEffect(() => {
    writeSubtitlePreferences(subtitlePreferences);
  }, [subtitlePreferences]);

  const cueVariables = useMemo(
    () => subtitleCueVariables(subtitlePreferences),
    [subtitlePreferences]
  );

  useEffect(() => {
    // A new stream means the old pipeline is gone; reset the reported status so
    // a stale "active" badge is never shown over a fresh source.
    setShaderStatus({ kind: "idle" });
  }, [streamRevision]);

  useEffect(() => {
    // Another episode, or a reload after an error, gets its own intro.
    setPlaybackSeconds(0);
    setIntroSkipped(false);
  }, [streamRevision]);

  useEffect(() => {
    if (!playUrl) return;
    const video = videoRef.current;
    if (!video) return;

    const sync = () => {
      setPlaybackSeconds(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    };
    sync();
    video.addEventListener("timeupdate", sync);
    video.addEventListener("seeked", sync);
    video.addEventListener("loadedmetadata", sync);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("seeked", sync);
      video.removeEventListener("loadedmetadata", sync);
    };
  }, [playUrl, streamRevision, videoRef]);

  useEffect(() => {
    // Keep subtitles off until the user picks one (or playback starts and we
    // optionally enable the default). Auto-enabling at attach time races the
    // subtitle CDN warm against the first video segments.
    if (!subtitleTracks?.length) {
      setActiveSubtitleLabel(null);
      return;
    }
    setActiveSubtitleLabel(null);
  }, [subtitleTracks, streamRevision]);

  // Enable default subtitles after playback starts — do not wrap onPlaying
  // (unstable inline handlers remount HlsVideo and flicker on cursor move).
  useEffect(() => {
    if (!playUrl || !subtitleTracks?.length) return;
    const video = videoRef.current;
    if (!video) return;

    const onPlaying = () => {
      setActiveSubtitleLabel((current) => {
        if (current != null) return current;
        return (
          subtitleTracks.find((track) => track.default)?.label ?? subtitleTracks[0]?.label ?? null
        );
      });
    };

    video.addEventListener("playing", onPlaying);
    return () => {
      video.removeEventListener("playing", onPlaying);
    };
  }, [playUrl, streamRevision, subtitleTracks, videoRef]);

  const clearHideControlsTimer = () => {
    if (hideControlsTimerRef.current != null) {
      clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
  };

  useEffect(() => {
    if (!playUrl || playbackError) {
      clearHideControlsTimer();
      setArePlayerControlsVisible(true);
      return;
    }

    const root = shellRef.current;
    if (!root) return;

    const controlsElement = root.querySelector<HTMLElement>(".media-controls");
    if (!controlsElement) {
      clearHideControlsTimer();
      setArePlayerControlsVisible(true);
      return;
    }

    const syncControlsVisibility = () => {
      const visible = controlsElement.hasAttribute("data-visible");
      if (visible) {
        clearHideControlsTimer();
        setArePlayerControlsVisible(true);
        return;
      }
      clearHideControlsTimer();
      hideControlsTimerRef.current = setTimeout(() => {
        hideControlsTimerRef.current = null;
        setArePlayerControlsVisible(false);
      }, 180);
    };

    syncControlsVisibility();
    const observer = new MutationObserver(syncControlsVisibility);
    observer.observe(controlsElement, {
      attributes: true,
      attributeFilter: ["data-visible"],
    });

    return () => {
      clearHideControlsTimer();
      observer.disconnect();
    };
  }, [playUrl, playbackError, streamRevision]);

  useEffect(() => {
    if (!playUrl) return;

    const syncVideoLayout = () => {
      const videoElement = videoRef.current;
      if (!videoElement) return;
      videoElement.style.width = "100%";
      videoElement.style.height = "100%";
      videoElement.style.objectFit = "contain";
    };

    const scheduleSyncVideoLayout = () => {
      requestAnimationFrame(() => {
        syncVideoLayout();
        requestAnimationFrame(syncVideoLayout);
      });
    };

    scheduleSyncVideoLayout();
    window.addEventListener("resize", scheduleSyncVideoLayout);
    document.addEventListener("fullscreenchange", scheduleSyncVideoLayout);

    return () => {
      window.removeEventListener("resize", scheduleSyncVideoLayout);
      document.removeEventListener("fullscreenchange", scheduleSyncVideoLayout);
    };
  }, [playUrl, streamRevision, videoRef]);

  const isPlayerUiActive =
    !playUrl ||
    Boolean(playbackError) ||
    arePlayerControlsVisible ||
    isTopChromeHovered ||
    isSubtitleSelectOpen ||
    isQualitySelectOpen ||
    isShaderSelectOpen ||
    isOutputSelectOpen ||
    isHostSelectOpen;

  const canOfferIntroSkip =
    Boolean(playUrl) &&
    !playbackError &&
    !introSkipped &&
    playbackSeconds > INTRO_SKIP_VISIBLE_FROM_SECONDS &&
    playbackSeconds < INTRO_SKIP_WINDOW_SECONDS;

  const onSkipIntro = () => {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    const target = playbackSeconds + INTRO_SKIP_SECONDS;
    // Never seek onto (or past) the last second: an exact seek to `duration` ends
    // the episode, which is the opposite of what this control is for.
    video.currentTime = duration != null ? Math.min(target, Math.max(0, duration - 1)) : target;
    setIntroSkipped(true);
    setPlaybackSeconds(video.currentTime);
  };

  return (
    <div
      ref={shellRef}
      /* `oa-cue-scope` carries the cue custom properties into `video::cue`. */
      className="oa-cue-scope relative flex flex-1 flex-col min-h-0 h-full w-full bg-black overflow-visible"
      style={cueVariables as React.CSSProperties}
    >
      <div className="absolute inset-0 z-0 flex items-center justify-center min-h-0">
        {loadingEpisode && !playUrl ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin" />
            <span className="text-sm">
              {transcodeProgress?.active ? transcodeProgress.message : "Loading stream..."}
            </span>
            {transcodeProgress?.active ? (
              <div className="w-[min(26rem,80vw)] pt-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full bg-white/80 transition-[width] duration-300 ease-out"
                    style={{
                      width: `${Math.max(
                        0,
                        Math.min(100, transcodeProgress.progressPercent ?? 0)
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-1 text-center text-xs text-white/70">
                  {transcodeProgress.progressPercent != null
                    ? `${Math.round(transcodeProgress.progressPercent)}%`
                    : "Estimating..."}
                </div>
              </div>
            ) : null}
          </div>
        ) : streamError && !playUrl ? (
          <div className="flex flex-col items-center gap-3 text-destructive px-4 text-center">
            <span className="text-sm">{streamError}</span>
            <Button type="button" variant="secondary" size="sm" onClick={onRetryStream}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        ) : playUrl ? (
          <div className="relative h-full w-full min-h-0">
            <VideoJsReactPlayer
              key={streamRevision}
              videoRef={videoRef}
              src={playUrl}
              forceHls={forceHls}
              subtitleTracks={subtitleTracks}
              activeSubtitleLabel={activeSubtitleLabel}
              className="absolute inset-0 h-full w-full object-contain bg-black"
              onLoadedMetadata={onLoadedMetadata}
              onPause={onPause}
              onEnded={onEnded}
              onPlaying={onPlaying}
              onError={onError}
            />
            {/*
              Sits above the <video> (z-0) and below the player chrome (z-20).
              The canvas is positioned by JS onto the video's letterboxed box and
              is pointer-events-none, so the @videojs controls, their hover
              behaviour and the injected subtitle tracks all keep working.
            */}
            <Anime4kShaderOverlay
              videoRef={videoRef}
              streamRevision={streamRevision}
              preset={shaderPreset}
              outputResolution={outputResolution}
              onStatusChange={setShaderStatus}
            />
            {qualityWarning ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-16 z-10 flex justify-center px-4">
                <div className="flex items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-950/70 px-3 py-1.5 text-xs text-amber-100 shadow-lg backdrop-blur-md">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                  <span>{qualityWarning}</span>
                </div>
              </div>
            ) : null}
            {/*
              Sits above the control bar (bottom-20 clears it) and above the video
              surface, so it stays reachable while the controls are hidden. The
              skin's own -10s / +10s buttons are two small icon buttons in the
              control bar; this is a labelled action that only exists during the
              opening, which is why it is not forced into that row.
            */}
            {canOfferIntroSkip ? (
              <div className="absolute bottom-20 right-4 z-20">
                <button
                  type="button"
                  data-skip-intro="1"
                  onClick={onSkipIntro}
                  title={`Jump ${String(INTRO_SKIP_SECONDS)} seconds ahead, past the opening`}
                  aria-label={`Skip intro, jump ${String(INTRO_SKIP_SECONDS)} seconds ahead`}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/25 bg-black/65 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70"
                >
                  <SkipForward className="h-4 w-4" aria-hidden="true" />
                  Skip intro
                  <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white/80">
                    {formatSkipLength(INTRO_SKIP_SECONDS)}
                  </span>
                </button>
              </div>
            ) : null}
            {playbackError ? (
              <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/85 px-4 text-center">
                <p className="text-sm text-white/90 max-w-md">{playbackError}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={loadingEpisode}
                  onClick={onRetryStream}
                >
                  {loadingEpisode ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Reload stream
                    </>
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground px-4 text-center">
            <span className="text-sm">Select an episode to play</span>
          </div>
        )}
      </div>

      <div
        className={cn(
          "absolute inset-x-0 top-0 z-20 flex items-center gap-3 px-4 py-3 bg-gradient-to-b from-black/80 via-black/45 to-transparent text-white transition-opacity duration-200",
          isPlayerUiActive ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onMouseEnter={() => {
          setIsTopChromeHovered(true);
        }}
        onMouseLeave={() => {
          setIsTopChromeHovered(false);
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back"
          className="text-white hover:bg-white/15 hover:text-white shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium truncate flex-1 min-w-0">
          {showLoading && !hasShowDetails ? (
            <span className="inline-flex items-center gap-2 text-white/80 font-normal">
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              Loading show...
            </span>
          ) : (
            `${displayName} · Episode ${currentEpisode} (${isDub ? "Dub" : "Sub"})`
          )}
        </span>
        {showError && !hasShowDetails ? (
          <span className="text-xs text-red-300 shrink-0 max-w-[200px] truncate" title={showError}>
            {showError}
          </span>
        ) : null}

        <div className="flex min-w-0 shrink items-center gap-2">
          {availableHosts && availableHosts.length > 1 && onHostSelect ? (
            <Select
              value={currentHost ?? undefined}
              onValueChange={(value) => {
                onHostSelect(value);
              }}
              onOpenChange={setIsHostSelectOpen}
              /*
               * `!playUrl` alone would lock the picker exactly when it is most
               * needed: a failed first load leaves `playUrl` empty, and Host is
               * the only in-page way to recover onto a source that has the
               * episode. Keep it enabled while there is an error to escape from.
               */
              disabled={loadingEpisode || switchingHost || (!playUrl && !canSwitchHost)}
            >
              <SelectTrigger
                className={cn(watchSelectTriggerClass, "w-[152px]")}
                title="Change streaming host — pick one that carries Italian subtitles"
                data-host-select="trigger"
              >
                {switchingHost ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-white/70" />
                ) : (
                  <Server className="h-3.5 w-3.5 shrink-0 text-white/60" />
                )}
                <SelectValue placeholder="Host" />
              </SelectTrigger>
              <SelectContent className={watchSelectContentClass}>
                {availableHosts.map((host) => (
                  <SelectItem
                    key={host.id}
                    value={host.id}
                    className={watchSelectItemClass}
                    data-host-option={host.id}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span>{host.label}</span>
                      <span className="text-[11px] leading-snug text-white/60">
                        {host.id === "animeunity"
                          ? "Italian subtitles guaranteed (burned in)"
                          : "Switch source for this episode"}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select
            value={outputResolution}
            onValueChange={(value) => setOutputResolution(value as OutputResolutionId)}
            onOpenChange={setIsOutputSelectOpen}
            disabled={!playUrl || shaderPreset === "off"}
          >
            <SelectTrigger
              className={cn(watchSelectTriggerClass, "w-[116px]")}
              title="Render output resolution"
            >
              <Monitor className="h-3.5 w-3.5 shrink-0 text-white/60" />
              {/* Text only: Radix clones the selected item's content into the
                  trigger, so carrying the description here would push the
                  dropdown's two-line layout into the compact trigger. */}
              <SelectValue placeholder="Output">
                {OUTPUT_RESOLUTIONS[outputResolution].label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className={watchSelectContentClass}>
              {OUTPUT_RESOLUTION_IDS.map((id) => (
                <SelectItem key={id} value={id} className={watchSelectItemClass}>
                  <span className="flex flex-col gap-0.5">
                    <span>{OUTPUT_RESOLUTIONS[id].label}</span>
                    <span className="text-[11px] leading-snug text-white/60">
                      {OUTPUT_RESOLUTIONS[id].description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={shaderPreset}
            onValueChange={(value) => setShaderPreset(value as ShaderPresetId)}
            onOpenChange={setIsShaderSelectOpen}
            disabled={!playUrl}
          >
            <SelectTrigger
              className={cn(watchSelectTriggerClass, "w-[132px]")}
              title="Anime4K shader (WebGPU)"
            >
              <Sparkles
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  shaderPreset === "off" ? "text-white/50" : "text-emerald-300"
                )}
              />
              <SelectValue placeholder="Shader">{SHADER_LABELS[shaderPreset]}</SelectValue>
            </SelectTrigger>
            <SelectContent className={watchSelectContentClass}>
              {SHADER_PRESET_IDS.map((id) => (
                <SelectItem key={id} value={id} className={watchSelectItemClass}>
                  <span className="flex flex-col gap-0.5">
                    <span>{SHADER_LABELS[id]}</span>
                    <span className="text-[11px] leading-snug text-white/60">
                      {SHADER_PRESETS[id].description}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {streamQualities && streamQualities.length > 1 && onQualitySelect ? (
            <Select
              value={selectedQuality ?? streamQualities[0]?.id}
              onValueChange={onQualitySelect}
              onOpenChange={setIsQualitySelectOpen}
              disabled={loadingEpisode || !playUrl}
            >
              <SelectTrigger className={watchSelectTriggerClass}>
                <SelectValue placeholder="Quality" />
              </SelectTrigger>
              <SelectContent className={watchSelectContentClass}>
                {streamQualities.map((quality) => (
                  <SelectItem key={quality.id} value={quality.id} className={watchSelectItemClass}>
                    {quality.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {/*
            Always rendered, unlike the old Select which only appeared when the
            source shipped a track. Hosts that burn subtitles into the video
            (AnimeUnity) now get an explanatory panel instead of no control at
            all, which is what made the feature look absent.
          */}
          <SubtitlePanel
            tracks={subtitleTracks ?? []}
            activeLabel={activeSubtitleLabel}
            onSelectTrack={setActiveSubtitleLabel}
            preferences={subtitlePreferences}
            onPreferencesChange={setSubtitlePreferences}
            hardcodedOnly={hardcodedSubtitles}
            disabled={loadingEpisode || !playUrl}
            /* Keeps the control bar from auto-hiding while the panel is open. */
            onOpenChange={setIsSubtitleSelectOpen}
          />
        </div>
      </div>

      {/* Shader status: only rendered when there is something worth telling the
          user (an active pass or a pipeline that could not run). */}
      {playUrl && shaderStatus.kind !== "idle" ? (
        <div
          className={cn(
            "pointer-events-none absolute bottom-4 left-4 z-20 rounded-lg border px-2.5 py-1 text-[11px] shadow-lg backdrop-blur-md transition-opacity duration-200",
            shaderStatus.kind === "active"
              ? "border-emerald-400/30 bg-emerald-950/60 text-emerald-100"
              : "border-amber-400/30 bg-amber-950/60 text-amber-100",
            isPlayerUiActive ? "opacity-100" : "opacity-0"
          )}
        >
          {shaderStatus.kind === "active"
            ? `${SHADER_LABELS[shaderStatus.preset]} · ${shaderStatus.output}${
                shaderStatus.adapter ? ` · ${shaderStatus.adapter}` : ""
              }`
            : `Shader unavailable: ${shaderStatus.reason}`}
        </div>
      ) : null}
    </div>
  );
}
