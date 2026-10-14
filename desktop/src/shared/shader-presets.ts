/**
 * Anime4K shader presets exposed in the player.
 *
 * Anime4K is optimised for *native 1080p* anime sources; its own documentation
 * warns that Mode A "can amplify ringing/banding if already present" and that
 * the chains are not meant to reconstruct downscaled 720p/SD material. The
 * presets are therefore ordered from safest to most aggressive, and the default
 * is the conservative one: on a compressed 720p stream an aggressive restore
 * pass makes artefacts *more* visible, which is the opposite of fidelity.
 *
 * Order in this array is the order shown in the UI.
 */
export const SHADER_PRESET_IDS = ["off", "mode-b", "mode-a", "mode-c", "mode-aa", "gan"] as const;

export type ShaderPresetId = (typeof SHADER_PRESET_IDS)[number];

export interface ShaderPresetDefinition {
  id: ShaderPresetId;
  /** Short label shown in the select trigger. */
  label: string;
  /** One-line explanation shown in the dropdown. */
  description: string;
  /**
   * Whether this preset needs GPU work at all. `off` short-circuits the whole
   * WebGPU pipeline and renders the plain <video>, which is both the fastest
   * and the safest option.
   */
  enabled: boolean;
}

export const SHADER_PRESETS: Record<ShaderPresetId, ShaderPresetDefinition> = {
  off: {
    id: "off",
    label: "Shader off",
    description: "No processing. Lowest GPU use, no added artefacts.",
    enabled: false,
  },
  "mode-b": {
    id: "mode-b",
    label: "Anime4K B",
    description: "Restore (soft) + upscale. Safest enhancement on compressed sources.",
    enabled: true,
  },
  "mode-a": {
    id: "mode-a",
    label: "Anime4K A",
    description: "Restore + upscale. Sharper, but amplifies existing banding/ringing.",
    enabled: true,
  },
  "mode-c": {
    id: "mode-c",
    label: "Anime4K C",
    description: "Denoise + upscale. Trades fine detail for smoother gradients.",
    enabled: true,
  },
  "mode-aa": {
    id: "mode-aa",
    label: "Anime4K A+A",
    description: "Double restore + upscale. Needs a clean 1080p source to pay off.",
    enabled: true,
  },
  gan: {
    id: "gan",
    label: "Anime4K GAN",
    description: "Heaviest chain. Best detail on pristine sources, most GPU and artefacts.",
    enabled: true,
  },
};

/**
 * Default remains `off` on principle, but note the preset is never changed
 * automatically: an earlier auto-downgrade watchdog was removed because it
 * measured source frame interval rather than GPU cost and disabled the shader
 * even on fast hardware. Selecting a preset is always the user's call.
 */
export const DEFAULT_SHADER_PRESET_ID: ShaderPresetId = "off";

export function isShaderPresetId(value: unknown): value is ShaderPresetId {
  return typeof value === "string" && (SHADER_PRESET_IDS as readonly string[]).includes(value);
}
