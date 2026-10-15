import { Captions, Check, EyeOff } from "lucide-react";
import React from "react";

import { Button } from "@/renderer/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/renderer/components/ui/popover";
import { Switch } from "@/renderer/components/ui/switch";
import { cn } from "@/renderer/lib/utils";
import {
  DEFAULT_SUBTITLE_PREFERENCES,
  SUBTITLE_FONT_SIZE_MAX,
  SUBTITLE_FONT_SIZE_MIN,
  SUBTITLE_FONT_SIZE_STEP,
  SUBTITLE_OPACITY_MAX,
  SUBTITLE_OPACITY_MIN,
  SUBTITLE_OPACITY_STEP,
  type SubtitlePreferences,
} from "@/renderer/helpers/player/subtitle-preferences";

export interface SubtitlePanelTrack {
  label: string;
  language?: string;
}

interface SubtitlePanelProps {
  tracks: SubtitlePanelTrack[];
  /** Label of the active track, or null when subtitles are off. */
  activeLabel: string | null;
  onSelectTrack: (label: string | null) => void;
  preferences: SubtitlePreferences;
  onPreferencesChange: (next: SubtitlePreferences) => void;
  /**
   * True when the current source carries no selectable subtitle track at all.
   * Some hosts (AnimeUnity) burn Italian subtitles into the video, so there is
   * nothing to switch on — the panel says so instead of showing dead controls.
   */
  hardcodedOnly?: boolean;
  disabled?: boolean;
  /** Notifies the shell so the control bar does not hide while the panel is open. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

const triggerClass =
  "h-8 w-[132px] shrink-0 border-white/25 bg-white/[0.12] text-white shadow-sm backdrop-blur-xl ring-offset-0 ring-offset-transparent placeholder:text-white/55 focus:ring-2 focus:ring-white/30 focus:ring-offset-0 hover:bg-white/[0.18] [&>svg]:text-white/75 [&>span]:truncate [&>span]:whitespace-nowrap";

const rowLabelClass = "text-[11px] font-medium uppercase tracking-wide text-white/55";

const rangeClass =
  "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/20 accent-white outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40";

export function SubtitlePanel({
  tracks,
  activeLabel,
  onSelectTrack,
  preferences,
  onPreferencesChange,
  hardcodedOnly,
  disabled,
  onOpenChange,
  className,
}: SubtitlePanelProps) {
  const subtitlesOn = activeLabel != null && tracks.length > 0;
  const hasTracks = tracks.length > 0;

  const setPreference = <K extends keyof SubtitlePreferences>(
    key: K,
    value: SubtitlePreferences[K]
  ) => {
    onPreferencesChange({ ...preferences, [key]: value });
  };

  /*
   * Appearance controls are only meaningful while cues are actually rendered.
   * Disabling them (rather than hiding) keeps the panel a stable size and makes
   * it obvious that turning subtitles on is what enables them.
   */
  const appearanceDisabled = !subtitlesOn;

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          title={
            hardcodedOnly
              ? "Subtitles are burned into this source"
              : hasTracks
                ? "Subtitle options"
                : "No subtitle track for this source"
          }
          className={cn(triggerClass, className)}
        >
          <Captions className="h-3.5 w-3.5 shrink-0" />
          <span>{hardcodedOnly ? "Hardcoded" : subtitlesOn ? "Subtitles" : "Subtitles off"}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-72 rounded-xl border border-white/15 bg-black/80 p-3 text-white shadow-2xl shadow-black/60 backdrop-blur-2xl"
      >
        {hardcodedOnly ? (
          <p className="text-[12px] leading-snug text-white/70">
            This source burns Italian subtitles directly into the video, so they cannot be turned
            off or restyled. Switch host to use selectable tracks.
          </p>
        ) : !hasTracks ? (
          <p className="text-[12px] leading-snug text-white/70">
            The current source provides no subtitle track. Try another host from the Host menu.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className={rowLabelClass}>Subtitles</span>
              <Switch
                checked={subtitlesOn}
                onCheckedChange={(checked) => {
                  // Turning off clears the selection; turning on falls back to the
                  // first available track, since the panel only renders when at
                  // least one exists.
                  onSelectTrack(checked ? (tracks[0]?.label ?? null) : null);
                }}
                aria-label="Toggle subtitles"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className={rowLabelClass}>Track</span>
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => onSelectTrack(null)}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                    !subtitlesOn ? "bg-white/[0.14]" : "hover:bg-white/[0.08]"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <EyeOff className="h-3.5 w-3.5 text-white/60" />
                    Off
                  </span>
                  {!subtitlesOn ? <Check className="h-3.5 w-3.5" /> : null}
                </button>
                {tracks.map((track) => {
                  const selected = subtitlesOn && track.label === activeLabel;
                  return (
                    <button
                      key={track.label}
                      type="button"
                      onClick={() => onSelectTrack(track.label)}
                      className={cn(
                        "flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                        selected ? "bg-white/[0.14]" : "hover:bg-white/[0.08]"
                      )}
                    >
                      <span className="truncate">{track.language || track.label}</span>
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className={rowLabelClass}>Text size</span>
                <span className="text-[11px] tabular-nums text-white/70">
                  {preferences.fontSizePx}px
                </span>
              </div>
              <input
                type="range"
                min={SUBTITLE_FONT_SIZE_MIN}
                max={SUBTITLE_FONT_SIZE_MAX}
                step={SUBTITLE_FONT_SIZE_STEP}
                value={preferences.fontSizePx}
                disabled={appearanceDisabled}
                onChange={(e) => setPreference("fontSizePx", Number(e.target.value))}
                aria-label="Subtitle text size"
                className={rangeClass}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className={rowLabelClass}>Background</span>
                <span className="text-[11px] tabular-nums text-white/70">
                  {Math.round(preferences.backgroundOpacity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={SUBTITLE_OPACITY_MIN}
                max={SUBTITLE_OPACITY_MAX}
                step={SUBTITLE_OPACITY_STEP}
                value={preferences.backgroundOpacity}
                disabled={appearanceDisabled}
                onChange={(e) => setPreference("backgroundOpacity", Number(e.target.value))}
                aria-label="Subtitle background opacity"
                className={rangeClass}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-2">
              <span className={rowLabelClass}>Text colour</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={preferences.color}
                  disabled={appearanceDisabled}
                  onChange={(e) => setPreference("color", e.target.value)}
                  aria-label="Subtitle text colour"
                  className="h-7 w-9 cursor-pointer rounded border border-white/20 bg-transparent disabled:cursor-not-allowed disabled:opacity-40"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={appearanceDisabled}
                  onClick={() => onPreferencesChange({ ...DEFAULT_SUBTITLE_PREFERENCES })}
                  className="h-7 px-2 text-[11px] text-white/75 hover:bg-white/10 hover:text-white"
                >
                  Reset
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
