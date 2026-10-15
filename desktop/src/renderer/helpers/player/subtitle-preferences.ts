/**
 * Subtitle appearance preferences.
 *
 * Kept in `localStorage` alongside the theme and language preferences, which is
 * where this app already stores view-only renderer settings — no main-process
 * round trip is needed for something the renderer alone consumes.
 *
 * The values are applied as CSS custom properties on the player root, because
 * subtitle tracks are native `<track>` elements and the only styling hook the
 * browser offers is the `::cue` pseudo-element (see `global.css`).
 */

const STORAGE_KEY = "player.subtitles";

export interface SubtitlePreferences {
  /** Multiplier-free pixel size, applied to `::cue` font-size. */
  fontSizePx: number;
  /** Opacity of the box drawn behind each cue, 0–1. */
  backgroundOpacity: number;
  /** Cue text colour, any CSS colour string. */
  color: string;
}

export const SUBTITLE_FONT_SIZE_MIN = 12;
export const SUBTITLE_FONT_SIZE_MAX = 40;
export const SUBTITLE_FONT_SIZE_STEP = 2;

export const SUBTITLE_OPACITY_MIN = 0;
export const SUBTITLE_OPACITY_MAX = 1;
export const SUBTITLE_OPACITY_STEP = 0.05;

export const DEFAULT_SUBTITLE_PREFERENCES: SubtitlePreferences = {
  fontSizePx: 20,
  backgroundOpacity: 0.75,
  color: "#ffffff",
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function normalizeSubtitlePreferences(raw: unknown): SubtitlePreferences {
  if (typeof raw !== "object" || raw === null) return DEFAULT_SUBTITLE_PREFERENCES;
  const o = raw as Record<string, unknown>;

  const size =
    typeof o.fontSizePx === "number"
      ? clamp(o.fontSizePx, SUBTITLE_FONT_SIZE_MIN, SUBTITLE_FONT_SIZE_MAX)
      : DEFAULT_SUBTITLE_PREFERENCES.fontSizePx;

  const opacity =
    typeof o.backgroundOpacity === "number"
      ? clamp(o.backgroundOpacity, SUBTITLE_OPACITY_MIN, SUBTITLE_OPACITY_MAX)
      : DEFAULT_SUBTITLE_PREFERENCES.backgroundOpacity;

  const color =
    typeof o.color === "string" && o.color.trim()
      ? o.color.trim()
      : DEFAULT_SUBTITLE_PREFERENCES.color;

  return { fontSizePx: size, backgroundOpacity: opacity, color };
}

export function readSubtitlePreferences(): SubtitlePreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SUBTITLE_PREFERENCES;
    return normalizeSubtitlePreferences(JSON.parse(raw) as unknown);
  } catch {
    // Unparseable or unavailable storage must never break playback.
    return DEFAULT_SUBTITLE_PREFERENCES;
  }
}

export function writeSubtitlePreferences(prefs: SubtitlePreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore quota / disabled-storage errors.
  }
}

/**
 * Inline style carrying the cue variables consumed by `.oa-cue-scope video::cue`.
 * Applied to the player shell so every nested `<video>` inherits them.
 */
export function subtitleCueVariables(prefs: SubtitlePreferences): Record<string, string> {
  return {
    "--oa-cue-size": `${prefs.fontSizePx}px`,
    "--oa-cue-bg-opacity": String(prefs.backgroundOpacity),
    "--oa-cue-color": prefs.color,
  };
}
