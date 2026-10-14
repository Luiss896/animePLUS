import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom";

import {
  checkWebGpuSupport,
  isSourceWorthShader,
  startShaderPipeline,
  type ShaderPipelineHandle,
} from "@/renderer/lib/anime4k-webgpu-renderer";
import {
  computeContainedBox,
  isOutputSizeSane,
  resolveOutputSize,
  type CanvasCssBox,
  type OutputResolutionId,
} from "@/shared/output-resolution";
import type { ShaderPresetId } from "@/shared/shader-presets";

interface Anime4kShaderOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  /** Bumped whenever a new stream is attached, so the pipeline is rebuilt. */
  streamRevision: number;
  preset: ShaderPresetId;
  /** Requested output resolution; see shared/output-resolution.ts. */
  outputResolution: OutputResolutionId;
  /** Fired when the pipeline starts or fails, so the shell can show the state. */
  onStatusChange?: (status: Anime4kShaderStatus) => void;
}

export type Anime4kShaderStatus =
  | { kind: "idle" }
  | { kind: "active"; preset: ShaderPresetId; adapter: string | null; output: string }
  | { kind: "unsupported"; reason: string };

/**
 * Positions the canvas exactly over the letterboxed video area.
 *
 * The canvas must not be stretched to the container: `inset-0` would make the
 * browser rescale the rendered frame whenever the container aspect ratio differs
 * from the video's — the very rescale this overlay exists to avoid. Offsetting
 * it to the contained box keeps a 1:1 mapping between pipeline pixels and the
 * video's on-screen geometry, in windowed mode and in fullscreen alike.
 */
function applyCanvasBox(canvas: HTMLCanvasElement, box: CanvasCssBox) {
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
  canvas.style.left = `${box.left}px`;
  canvas.style.top = `${box.top}px`;
  canvas.style.right = "auto";
  canvas.style.bottom = "auto";
}

/**
 * Compute the on-screen box the canvas must occupy, in container-relative CSS
 * pixels. Prefers the real <video> rect (the skin applies object-fit: contain,
 * so that rect IS the letterboxed picture) and falls back to a computed
 * contained box when the video rect is not usable yet.
 */
function resolveCanvasBox(
  video: HTMLVideoElement,
  container: HTMLElement | null
): CanvasCssBox | null {
  const containerRect = container?.getBoundingClientRect();
  if (!containerRect || containerRect.width < 1 || containerRect.height < 1) return null;

  const videoRect = video.getBoundingClientRect();
  const videoUsable =
    videoRect.width >= 1 &&
    videoRect.height >= 1 &&
    videoRect.width <= containerRect.width + 2 &&
    videoRect.height <= containerRect.height + 2;

  if (videoUsable) {
    return {
      width: videoRect.width,
      height: videoRect.height,
      left: videoRect.left - containerRect.left,
      top: videoRect.top - containerRect.top,
    };
  }

  return computeContainedBox(
    video.videoWidth,
    video.videoHeight,
    containerRect.width,
    containerRect.height
  );
}

/**
 * Find the element videojs binds its container listeners to.
 *
 * This is the portal target for the canvas: it must be an ancestor of the media
 * element so that pointer events over the picture reach the player, and it stays
 * inside the fullscreen element when fullscreen is entered.
 */
function findPlayerContainer(from: HTMLElement | null): HTMLElement | null {
  if (!from) return null;

  const skin =
    from.closest(".oa-videojs-player") ??
    from.closest(".media-default-skin") ??
    from.closest("[data-media-player]");
  if (skin instanceof HTMLElement) return skin;

  // Fall back to the nearest ancestor that actually holds the media element.
  let node: HTMLElement | null = from;
  while (node) {
    if (node.querySelector("video")) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Renders an Anime4K WebGPU pass over the existing <video>.
 *
 * The video element itself is never replaced: this canvas is absolutely
 * positioned on top of it and below the player controls, so the @videojs skin,
 * its controls and the injected subtitle <track>s keep working untouched.
 * When WebGPU is unavailable, the canvas stays hidden and the plain video — which
 * is already decoding underneath — remains visible.
 */
export function Anime4kShaderOverlay({
  videoRef,
  streamRevision,
  preset,
  outputResolution,
  onStatusChange,
}: Anime4kShaderOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<ShaderPipelineHandle | null>(null);
  const statusRef = useRef(onStatusChange);
  statusRef.current = onStatusChange;

  // Bumped when the player box changes shape (fullscreen toggle, window resize,
  // layout change). The pipeline is rebuilt at the new output size, because the
  // canvas backing store has to match the geometry the frame is displayed at.
  const [layoutRevision, setLayoutRevision] = React.useState(0);

  useEffect(() => {
    const bump = () => setLayoutRevision((value) => value + 1);

    const onFullscreenChange = () => {
      // The fullscreen element's final size is only known after layout settles.
      requestAnimationFrame(() => requestAnimationFrame(bump));
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    window.addEventListener("resize", bump);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
      window.removeEventListener("resize", bump);
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (preset === "off") {
      canvas.style.display = "none";
      statusRef.current?.({ kind: "idle" });
      return;
    }

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    // Fullscreen and window resizes change the container box, so the canvas
    // geometry has to be recomputed. The observer watches whichever element the
    // canvas is currently parented to, and is re-targeted whenever the parent
    // changes (the fullscreen transition), because observing a stale container
    // would keep re-measuring the wrong box.
    let observed: Element | null = null;
    const retargetObserver = () => {
      if (typeof ResizeObserver === "undefined") return;
      const parent = canvas.parentElement;
      if (!parent || parent === observed) return;
      resizeObserver ??= new ResizeObserver(() => {
        if (cancelled) return;
        if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
        const box = resolveCanvasBox(video, canvas.parentElement);
        if (!box || box.width < 1 || box.height < 1) return;
        // Cheap re-alignment; the pipeline itself is rebuilt by the layout
        // effect, which runs on the same revision bump.
        applyCanvasBox(canvas, box);
      });
      if (observed) resizeObserver.unobserve(observed);
      resizeObserver.observe(parent);
      observed = parent;
    };

    const boot = async () => {
      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!isSourceWorthShader(video)) {
        canvas.style.display = "none";
        statusRef.current?.({
          kind: "unsupported",
          reason: `source is ${sourceHeight || "?"}p — below the ~700p floor where Anime4K helps`,
        });
        return;
      }

      // Report a precise reason instead of a generic failure: the usual causes
      // are that WebGPU was not enabled or the GPU is blocklisted.
      const support = await checkWebGpuSupport();
      if (!support.ok) {
        canvas.style.display = "none";
        statusRef.current?.({
          kind: "unsupported",
          reason: support.reason ?? "WebGPU unavailable",
        });
        return;
      }

      // Move the canvas inside the player container before measuring anything:
      // its position determines the containing block for the geometry below, and
      // it is what makes pointer events over the picture reach the player.
      retargetObserver();

      // Measure the *container the canvas currently lives in*, not the canvas
      // itself: the canvas is about to be resized to the contained box, so
      // reading its own rect would feed the previous geometry back in. While
      // fullscreen is active the canvas lives in the fullscreen element, so this
      // measures the fullscreen box.
      const container = canvas.parentElement;
      const box = resolveCanvasBox(video, container);

      if (!box || box.width < 1 || box.height < 1) {
        canvas.style.display = "none";
        statusRef.current?.({ kind: "unsupported", reason: "could not resolve output size" });
        return;
      }

      // Align the canvas to the video's letterboxed box BEFORE the pipeline
      // renders, so pipeline pixels map 1:1 onto the on-screen video geometry.
      applyCanvasBox(canvas, box);

      const dpr = window.devicePixelRatio || 1;
      const size = resolveOutputSize(
        outputResolution,
        sourceWidth,
        sourceHeight,
        Math.round(box.width * dpr),
        Math.round(box.height * dpr)
      );

      if (!size) {
        canvas.style.display = "none";
        statusRef.current?.({ kind: "unsupported", reason: "could not resolve output size" });
        return;
      }

      if (!isOutputSizeSane(size)) {
        canvas.style.display = "none";
        statusRef.current?.({
          kind: "unsupported",
          reason: `${size.width}x${size.height} exceeds the safe GPU budget for Anime4K`,
        });
        return;
      }

      // Hide the canvas while the pipeline is rebuilt: between the new backing
      // store being sized and the first frame being submitted the canvas would
      // otherwise flash black over the still-decoding video underneath.
      canvas.style.display = "none";

      const handle = await startShaderPipeline({
        video,
        canvas,
        preset,
        outputWidth: size.width,
        outputHeight: size.height,
        onUnsupported: (reason) => {
          statusRef.current?.({ kind: "unsupported", reason });
        },
        onError: (error) => {
          statusRef.current?.({ kind: "unsupported", reason: error.message });
        },
      });

      if (cancelled) {
        handle?.dispose();
        return;
      }

      if (handle) {
        handleRef.current = handle;
        statusRef.current?.({
          kind: "active",
          preset: handle.activePreset(),
          adapter: handle.adapterInfo(),
          output: `${size.width}x${size.height}`,
        });
      } else {
        canvas.style.display = "none";
      }
    };

    retargetObserver();

    // Wait for dimensions: videoHeight is 0 until metadata arrives, and the
    // source-resolution guard above depends on it.
    if (video.readyState >= 1) {
      void boot();
      return () => {
        cancelled = true;
        resizeObserver?.disconnect();
        handleRef.current?.dispose();
        handleRef.current = null;
      };
    }

    const onMeta = () => {
      video.removeEventListener("loadedmetadata", onMeta);
      void boot();
    };
    video.addEventListener("loadedmetadata", onMeta);

    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", onMeta);
      resizeObserver?.disconnect();
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [preset, outputResolution, streamRevision, videoRef, layoutRevision]);

  // The canvas is portalled into the player's own container rather than mounted
  // where this component sits in the tree.
  //
  // Two reasons, both real:
  //  1. @videojs shows its controls from `listen(container, "pointermove")` on
  //     the player root. A canvas outside that root is a dead zone: moving the
  //     mouse over the picture produced no event on the container, so with a
  //     shader active the controls never reappeared.
  //  2. Entering fullscreen promotes the player root; anything outside it stops
  //     being rendered, which made the shader vanish in fullscreen.
  //
  // A portal keeps React's bookkeeping honest while letting the DOM node live
  // inside the player, which moving the node around by hand would not.
  const [portalTarget, setPortalTarget] = React.useState<HTMLElement | null>(null);

  useEffect(() => {
    // Resolve from the <video> element, never from the canvas: once portalled,
    // the canvas's parent IS the player container, so deriving the target from it
    // would be circular.
    const resolve = () => {
      const video = videoRef.current;
      if (!video) return null;
      const owner = video.closest(".oa-videojs-player, .media-default-skin") as HTMLElement | null;
      return owner ?? findPlayerContainer(video.parentElement);
    };

    const sync = () => {
      const target = resolve();
      setPortalTarget((current) => (current === target ? current : target));
    };

    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);

    // The media surface mounts asynchronously, so the root may not exist on the
    // first attempt. A short-lived watcher covers that without polling forever.
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      sync();
      if (resolve() || attempts > 25) window.clearInterval(timer);
    }, 200);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [videoRef, streamRevision, preset]);

  const canvasElement = (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="oa-shader-canvas pointer-events-none absolute"
      style={{ display: "none", left: 0, top: 0 }}
    />
  );

  return portalTarget ? ReactDOM.createPortal(canvasElement, portalTarget) : canvasElement;
}
