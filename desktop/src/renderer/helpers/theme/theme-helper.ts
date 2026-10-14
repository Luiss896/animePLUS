import { Theme } from "@/shared/types/theme";
import { DEFAULT_COLOR_PALETTE, isColorPaletteId, type ColorPaletteId } from "@/shared/types/theme";

const THEME_KEY = "theme";
const PALETTE_KEY = "theme.palette";

export interface ThemePreferences {
  system: Theme;
  local: Theme | null;
}

export async function getCurrentTheme(): Promise<ThemePreferences> {
  const currentTheme = await window.theme.current();
  const localTheme = localStorage.getItem(THEME_KEY) as Theme | null;

  return {
    system: currentTheme,
    local: localTheme,
  };
}

export async function setTheme(newTheme: Theme) {
  switch (newTheme) {
    case "dark":
      await window.theme.dark();
      updateDocumentTheme(true);
      break;
    case "light":
      await window.theme.light();
      updateDocumentTheme(false);
      break;
    case "system": {
      const isDarkMode = await window.theme.system();
      updateDocumentTheme(isDarkMode);
      break;
    }
  }

  localStorage.setItem(THEME_KEY, newTheme);
}

export async function toggleTheme() {
  const isDarkMode = await window.theme.toggle();
  const newTheme = isDarkMode ? "dark" : "light";

  updateDocumentTheme(isDarkMode);
  localStorage.setItem(THEME_KEY, newTheme);
}

/** Paint dark immediately, then honor a saved light or system choice. */
export function applyStoredThemeClass() {
  const stored = localStorage.getItem(THEME_KEY);
  const theme: Theme = stored === "light" || stored === "system" ? stored : "dark";
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  updateDocumentTheme(isDark);
  // Applied here too so the palette is correct on the very first paint and the
  // UI never flashes the default colours before React mounts.
  applyStoredPalette();
}

/* -------------------------------------------------------------------------- */
/* Colour palettes                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Read the stored palette, falling back to the neutral default.
 *
 * Deliberately localStorage rather than electron-store: the value must be
 * readable synchronously at import time (see `applyStoredThemeClass`) to avoid a
 * flash of the wrong colours, and the existing light/dark preference is stored
 * the same way, so this keeps one mechanism instead of two.
 */
export function getStoredPalette(): ColorPaletteId {
  const stored = localStorage.getItem(PALETTE_KEY);
  return isColorPaletteId(stored) ? stored : DEFAULT_COLOR_PALETTE;
}

/**
 * Write the palette to the document root as `data-palette`.
 *
 * The `dark`/`light` class mechanism is left untouched — the palette is an
 * orthogonal layer that only overrides colour tokens, so no existing styling
 * behaviour changes. `default` removes the attribute entirely so the plain
 * `:root`/`.dark` tokens apply exactly as before.
 */
export function applyPalette(palette: ColorPaletteId) {
  const root = document.documentElement;
  if (palette === DEFAULT_COLOR_PALETTE) {
    root.removeAttribute("data-palette");
    return;
  }
  root.setAttribute("data-palette", palette);
}

export function applyStoredPalette() {
  applyPalette(getStoredPalette());
}

export function setPalette(palette: ColorPaletteId) {
  localStorage.setItem(PALETTE_KEY, palette);
  applyPalette(palette);
  // Let listeners (settings UI, player shell) re-read without prop plumbing.
  window.dispatchEvent(new CustomEvent("animeplus:palette-change", { detail: palette }));
}

export async function syncThemeWithLocal() {
  const { local } = await getCurrentTheme();
  if (!local) {
    await setTheme("dark");
    return;
  }

  await setTheme(local);
}

function updateDocumentTheme(isDarkMode: boolean) {
  if (!isDarkMode) {
    document.documentElement.classList.remove("dark");
  } else {
    document.documentElement.classList.add("dark");
  }
}
