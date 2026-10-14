export type Theme = "dark" | "light" | "system";

export type ThemeConfig = {
  value: Theme;
  label: string;
};

/**
 * Colour palettes ("accent themes") layered on top of the light/dark mode.
 *
 * These are independent of `Theme`: `Theme` decides light vs dark, while a
 * palette recolours the surfaces within that mode. `default` keeps the original
 * achromatic shadcn/zinc look, so an existing user sees no change until they
 * deliberately pick something else.
 */
export const COLOR_PALETTE_IDS = ["default", "steinsgate", "frieren", "cyberpunk"] as const;

export type ColorPaletteId = (typeof COLOR_PALETTE_IDS)[number];

export interface ColorPaletteDefinition {
  id: ColorPaletteId;
  label: string;
  /** Short description shown under the option. */
  description: string;
  /**
   * Two representative colours (CSS colour strings) used to render the swatch
   * in the picker. Kept as plain CSS values so the picker does not depend on the
   * palette being active.
   */
  swatch: [string, string, string];
}

export const COLOR_PALETTES: Record<ColorPaletteId, ColorPaletteDefinition> = {
  default: {
    id: "default",
    label: "Default",
    description: "The original neutral theme.",
    swatch: ["#0a0a0b", "#e4e4e7", "#a1a1aa"],
  },
  steinsgate: {
    id: "steinsgate",
    label: "Steins;Gate",
    description: "Electric blue and amber, on a deep lab-dark base.",
    swatch: ["#050b16", "#2b8fff", "#ffa62b"],
  },
  frieren: {
    id: "frieren",
    label: "Frieren",
    description: "Forest emerald and soft gold, warm and calm.",
    swatch: ["#06120e", "#34d399", "#e3c46b"],
  },
  cyberpunk: {
    id: "cyberpunk",
    label: "Edgerunners",
    description: "Neon yellow and cyan over Night City black.",
    swatch: ["#0a0a05", "#fcee0a", "#00e5ff"],
  },
};

export const DEFAULT_COLOR_PALETTE: ColorPaletteId = "default";

export function isColorPaletteId(value: unknown): value is ColorPaletteId {
  return typeof value === "string" && (COLOR_PALETTE_IDS as readonly string[]).includes(value);
}
