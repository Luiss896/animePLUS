/**
 * Output resolution handling for the Anime4K WebGPU pass.
 *
 * Why this exists
 * ---------------
 * A 1080p source on a 2560x1440 display has to be enlarged by 4/3 to fill the
 * screen. If that enlargement is left to the compositor it happens *after* the
 * shader, i.e. the CNN works at 1920x1080 and its output is then resampled by a
 * generic filter — two resampling steps, and the shader's work is partly thrown
 * away.
 *
 * `anime4k-webgpu` draws to whatever `getCurrentTexture()` reports, so the
 * canvas size *is* the output size. Sizing the canvas to the target resolution
 * moves the enlargement inside the pipeline, where the package already handles
 * non-integer factors: for 1.2 < ratio < 2.0 it runs a CNN x2 and then a
 * `Downscale` pass onto exactly `targetDimensions`. For 1080p -> 1440p the ratio
 * is 1.3333, which falls in that band, so the enlargement is done by the
 * package's own high-quality path rather than a hand-written resampler.
 */
import type { ShaderPresetId } from "@/shared/shader-presets";

export const OUTPUT_RESOLUTION_IDS = ["source", "display", "hd1080", "qhd1440", "uhd2160"] as const;

export type OutputResolutionId = (typeof OUTPUT_RESOLUTION_IDS)[number];

export interface OutputResolutionDefinition {
  id: OutputResolutionId;
  label: string;
  description: string;
}

export const OUTPUT_RESOLUTIONS: Record<OutputResolutionId, OutputResolutionDefinition> = {
  source: {
    id: "source",
    label: "Source",
    description: "Canvas matches the video. Sharpest per-pixel, but the screen still scales it.",
  },
  display: {
    id: "display",
    label: "Display",
    description: "Matches this monitor 1:1. No scaling by the compositor.",
  },
  hd1080: {
    id: "hd1080",
    label: "1080p",
    description: "1920x1080 output.",
  },
  qhd1440: {
    id: "qhd1440",
    label: "1440p",
    description: "2560x1440 output.",
  },
  uhd2160: {
    id: "uhd2160",
    label: "4K",
    description: "3840x2160 output. Heaviest option.",
  },
};

export const DEFAULT_OUTPUT_RESOLUTION_ID: OutputResolutionId = "display";

/** Fixed output sizes, in CSS-independent device pixels. */
const FIXED_SIZES: Partial<Record<OutputResolutionId, { width: number; height: number }>> = {
  hd1080: { width: 1920, height: 1080 },
  qhd1440: { width: 2560, height: 1440 },
  uhd2160: { width: 3840, height: 2160 },
};

export interface ResolvedOutputSize {
  width: number;
  height: number;
  /** True when the size came from the live screen/canvas rather than a constant. */
  dynamic: boolean;
}

/** CSS-pixel box the canvas must occupy to sit exactly on top of the video. */
export interface CanvasCssBox {
  width: number;
  height: number;
  /** Offset from the container's top-left, in CSS pixels. */
  left: number;
  top: number;
}

/**
 * Geometry of the letterboxed video area inside a container.
 *
 * This mirrors what `object-fit: contain` does to the <video>, and it is the
 * whole point of the overlay: a canvas stretched to `inset-0` would be scaled
 * again by the browser whenever the container's aspect ratio differs from the
 * video's (any fullscreen transition on a non-matching monitor, any padded
 * layout). That second scaling is exactly the "GPU work thrown away" bug — the
 * pipeline renders 2560x1440 and the compositor immediately squashes it back to
 * a smaller box, so the picture looks like the source resolution again.
 *
 * Returns null when the container has no usable size yet (first paint).
 */
export function computeContainedBox(
  sourceWidth: number,
  sourceHeight: number,
  containerWidth: number,
  containerHeight: number
): CanvasCssBox | null {
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;
  if (containerWidth <= 0 || containerHeight <= 0) return null;

  const scale = Math.min(containerWidth / sourceWidth, containerHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    width,
    height,
    left: (containerWidth - width) / 2,
    top: (containerHeight - height) / 2,
  };
}

/**
 * Work out the canvas size for a given mode.
 *
 * `source` and `display` depend on runtime values (video metadata and the
 * element's rendered box), so they are resolved on every call; the fixed modes
 * are constants.
 *
 * Aspect ratio is always preserved from the source: forcing a 16:9 target onto
 * a 4:3 source would either letterbox inside the canvas (wasting GPU work) or
 * distort the image, so the height is derived from the source ratio instead.
 */
export function resolveOutputSize(
  mode: OutputResolutionId,
  sourceWidth: number,
  sourceHeight: number,
  displayWidth: number,
  displayHeight: number
): ResolvedOutputSize | null {
  if (sourceWidth <= 0 || sourceHeight <= 0) return null;

  if (mode === "source") {
    return { width: sourceWidth, height: sourceHeight, dynamic: false };
  }

  if (mode === "display") {
    if (displayWidth <= 0 || displayHeight <= 0) {
      return { width: sourceWidth, height: sourceHeight, dynamic: false };
    }
    // Fit the source aspect inside the display box so nothing is cropped; the
    // element already applies object-fit, and we only need the pixel budget.
    const scale = Math.min(displayWidth / sourceWidth, displayHeight / sourceHeight);
    const width = Math.round(sourceWidth * scale);
    const height = Math.round(sourceHeight * scale);
    return { width, height, dynamic: true };
  }

  const fixed = FIXED_SIZES[mode];
  if (!fixed) return null;

  // Keep the source aspect ratio: derive height from the requested width.
  const height = Math.round((fixed.width * sourceHeight) / sourceWidth);
  return { width: fixed.width, height, dynamic: false };
}

/**
 * Pixel budget guard.
 *
 * The Anime4K x4 chains allocate several rgba16float render targets; 4K output
 * from a 1080p source means intermediate textures at 7680x4320 (about 265 MB
 * each), which can exhaust VRAM on smaller cards or force a device loss. The
 * limit is deliberately conservative and only blocks the extreme combination.
 */
export function isOutputSizeSane(size: ResolvedOutputSize): boolean {
  const megapixels = (size.width * size.height) / 1_000_000;
  return megapixels <= 9.5;
}

export function isOutputResolutionId(value: unknown): value is OutputResolutionId {
  return typeof value === "string" && (OUTPUT_RESOLUTION_IDS as readonly string[]).includes(value);
}

/** Human-readable summary for the status badge. */
export function describeOutputResolution(size: ResolvedOutputSize, preset: ShaderPresetId): string {
  if (preset === "off") return `${size.width}x${size.height}`;
  return `${size.width}x${size.height}`;
}
