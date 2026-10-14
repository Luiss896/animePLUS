/**
 * Anime4K via WebGPU, applied on top of the plain <video> element.
 *
 * Design constraints (all learned from this codebase, not guessed):
 *
 * 1. The player is `@videojs/react@10-beta` with an HlsVideo surface driven by
 *    MSE. We must NOT replace or wrap that element — the skin, the injected
 *    `<track>` subtitles and the parent's stable-ref tricks all depend on it.
 *    So the shader renders *over* the video: a canvas layered above it, fed by
 *    the same media element. Controls and subtitles stay on top of both.
 *
 * 2. WebGPU is optional at runtime. `navigator.gpu` is undefined unless the main
 *    process passed `enable-unsafe-webgpu`, and the adapter request can fail on
 *    blacklisted drivers or software rendering. Every failure path must fall
 *    back to plain video rather than a black screen.
 *
 * 3. There is deliberately NO automatic quality reduction. An earlier version
 *    tried to time the pipeline by measuring the gap between
 *    `requestVideoFrameCallback` invocations and comparing it to a frame budget.
 *    That was wrong: the gap between video frames is the *source frame interval*
 *    (41.7 ms at 24 fps), not GPU cost, so any source below 30 fps tripped the
 *    threshold and got downgraded to "off" even on a fast GPU. Measuring real
 *    compute cost requires GPU timestamps, which `anime4k-webgpu` does not
 *    expose. Silently disabling a feature the user explicitly enabled is worse
 *    than showing a number, so the preset is never changed behind the user's
 *    back.
 */
import type { ShaderPresetId } from "@/shared/shader-presets";

export interface ShaderPipelineHandle {
  /** Stop the render loop and release GPU resources. Safe to call twice. */
  dispose: () => void;
  /** Preset actually in use. Equals the requested preset — never auto-changed. */
  activePreset: () => ShaderPresetId;
  /** Adapter description, when the browser exposes it (useful for diagnosis). */
  adapterInfo: () => string | null;
}

export interface ShaderStartOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  preset: ShaderPresetId;
  /**
   * Canvas size to render at. The canvas is what `anime4k-webgpu` draws into via
   * `getCurrentTexture()`, so this *is* the output resolution. Sizing it larger
   * than the source moves the screen-enlargement inside the pipeline, where the
   * package handles non-integer factors (1.2 < ratio < 2.0 runs CNN x2 then a
   * `Downscale` onto exactly these dimensions — the 1080p -> 1440p case).
   */
  outputWidth: number;
  outputHeight: number;
  /** Called when the pipeline could not start, with the reason. */
  onUnsupported?: (reason: string) => void;
  /** Called on any unrecoverable GPU error so the caller can drop to plain video. */
  onError?: (error: Error) => void;
}

/** Renditions lighter than this are not worth the GPU cost. */
const MIN_HEIGHT_FOR_SHADER = 700;

type RenderFn = (options: {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  pipelineBuilder: (device: GPUDevice, inputTexture: GPUTexture) => unknown[];
}) => Promise<unknown>;

type ModuleExports = Record<string, unknown> & { render?: RenderFn };

let modulePromise: Promise<ModuleExports | null> | null = null;

/**
 * Load `anime4k-webgpu` lazily. It is a sizeable dependency and is useless when
 * the user never enables a shader, so it must not sit on the startup path.
 */
function loadAnime4k(): Promise<ModuleExports | null> {
  modulePromise ??= import("anime4k-webgpu")
    .then((mod) => mod as unknown as ModuleExports)
    .catch(() => null);
  return modulePromise;
}

export interface WebGpuSupport {
  ok: boolean;
  reason?: string;
  adapterDescription?: string;
}

/**
 * Check for a usable WebGPU adapter and describe it.
 *
 * `requestAdapter` returning null is the common failure on machines where WebGPU
 * was not enabled or the GPU is blocklisted, so the reason is surfaced to the UI
 * instead of a bare boolean.
 */
export async function checkWebGpuSupport(): Promise<WebGpuSupport> {
  const nav = navigator as Navigator & { gpu?: GPU };
  if (!nav.gpu) {
    return {
      ok: false,
      reason: "WebGPU not available (navigator.gpu missing)",
    };
  }
  try {
    // Prefer the discrete GPU on hybrid laptops; fall back to whatever exists.
    const adapter =
      (await nav.gpu.requestAdapter({ powerPreference: "high-performance" })) ??
      (await nav.gpu.requestAdapter());
    if (!adapter) {
      return { ok: false, reason: "No WebGPU adapter (GPU may be blocklisted)" };
    }
    const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
    const description = [info?.vendor, info?.architecture, info?.description]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" ");
    return { ok: true, adapterDescription: description || undefined };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "WebGPU adapter request failed",
    };
  }
}

export async function isWebGpuAvailable(): Promise<boolean> {
  return (await checkWebGpuSupport()).ok;
}

/**
 * Build the Anime4K pipeline for a preset.
 *
 * The preset classes already include their own chains (Mode B = restore-soft →
 * upscale → upscale, per Anime4K's advanced guide), so no manual chain assembly
 * is needed here.
 */
function buildPipeline(
  mod: ModuleExports,
  preset: ShaderPresetId,
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
) {
  const PresetCtor = resolvePresetConstructor(mod, preset);
  if (!PresetCtor) return null;

  return (device: GPUDevice, inputTexture: GPUTexture) => {
    const presetInstance = new PresetCtor({
      device,
      inputTexture,
      nativeDimensions: { width: video.videoWidth, height: video.videoHeight },
      targetDimensions: { width: canvas.width, height: canvas.height },
    });
    return [presetInstance];
  };
}

function resolvePresetConstructor(
  mod: ModuleExports,
  preset: ShaderPresetId
): (new (options: Record<string, unknown>) => unknown) | null {
  // Names verified against anime4k-webgpu@1.0.0 (lib/pipelines/presets):
  // ModeA, ModeB, ModeC, ModeAA, ModeBB, ModeCA.
  const names: Record<Exclude<ShaderPresetId, "off">, string[]> = {
    "mode-a": ["ModeA"],
    "mode-b": ["ModeB"],
    "mode-c": ["ModeC"],
    "mode-aa": ["ModeAA"],
    gan: ["ModeBB"],
  };
  const candidates = preset === "off" ? [] : names[preset];
  for (const name of candidates) {
    const value = mod[name];
    if (typeof value === "function") {
      return value as new (options: Record<string, unknown>) => unknown;
    }
  }
  return null;
}

/**
 * True when applying a shader to this source is worth the GPU cost.
 *
 * Anime4K's own guidance is that it is built for native 1080p material and is
 * not a detail-recovery tool for heavily downscaled video. Running an aggressive
 * restore chain on a 480p stream produces ringing and oversharpening, not
 * fidelity, so we refuse rather than make the picture worse.
 */
export function isSourceWorthShader(video: HTMLVideoElement): boolean {
  const height = video.videoHeight;
  if (!Number.isFinite(height) || height <= 0) return false;
  return height >= MIN_HEIGHT_FOR_SHADER;
}

/**
 * Start the shader pipeline. Resolves to null when WebGPU, the package or the
 * preset is unavailable — callers then simply keep the plain video visible.
 */
export async function startShaderPipeline(
  options: ShaderStartOptions
): Promise<ShaderPipelineHandle | null> {
  const { video, canvas, onUnsupported, onError } = options;
  const preset = options.preset;
  const outputWidth = Math.max(1, Math.round(options.outputWidth));
  const outputHeight = Math.max(1, Math.round(options.outputHeight));

  if (preset === "off") return null;

  let disposed = false;

  const support = await checkWebGpuSupport();
  if (!support.ok) {
    onUnsupported?.(support.reason ?? "WebGPU unavailable");
    return null;
  }

  const mod = await loadAnime4k();
  if (!mod || typeof mod.render !== "function") {
    onUnsupported?.("anime4k-webgpu module could not be loaded");
    return null;
  }

  // The canvas is the render target: this is what drives the output resolution.
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const pipelineBuilder = buildPipeline(mod, preset, video, canvas);
  if (!pipelineBuilder) {
    onUnsupported?.(`Preset "${preset}" is not exported by anime4k-webgpu`);
    return null;
  }

  try {
    await mod.render({ video, canvas, pipelineBuilder });
    // The canvas is only revealed once the pipeline is bound; otherwise a GPU
    // stall would show as a black screen instead of video.
    canvas.style.display = "block";
  } catch (error) {
    canvas.style.display = "none";
    const err = error instanceof Error ? error : new Error(String(error));
    onError?.(err);
    return null;
  }

  return {
    dispose: () => {
      disposed = true;
      canvas.style.display = "none";
      const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
      if (context && typeof context.unconfigure === "function") {
        try {
          context.unconfigure();
        } catch {
          // context already gone
        }
      }
    },
    activePreset: () => preset,
    adapterInfo: () => support.adapterDescription ?? null,
  };
}
