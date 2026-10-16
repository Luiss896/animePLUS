import { projectPartyPosition, type PartyMessage } from "@/shared/watch-party/protocol";

/**
 * Timeline synchronisation for a watch party.
 *
 * The app owns its `<video>` element — no cross-origin iframe is involved — so a
 * guest can be driven directly: `play()`, `pause()` and `currentTime` all work.
 * That makes exact sync possible rather than the "ask the user to press play"
 * fallback an iframe-based setup would need.
 *
 * Correction is graduated rather than binary. Seeking is what a viewer notices, so
 * a small offset is absorbed by briefly changing `playbackRate` (imperceptible)
 * and only a large offset — or a lost connection — justifies a visible jump.
 */

/** Below this, drift is not worth correcting: it is smaller than one frame batch. */
export const SOFT_DRIFT_MS = 250;

/** Above this, a smooth correction would take too long to converge. */
export const HARD_DRIFT_MS = 1500;

/** Playback rate offset used for smooth correction. Five percent is not noticeable. */
export const NUDGE_RATE = 0.05;

export type DriftDecision =
  /** Within tolerance, or nothing can be done yet. */
  | { action: "none"; driftMs: number }
  /** Absorb smoothly by running slightly fast or slow. */
  | { action: "nudge"; driftMs: number; rate: number }
  /** Jump to the target time. */
  | { action: "seek"; driftMs: number; to: number };

/**
 * What to do about a difference between the local position and the host's.
 *
 * `driftMs` is *local minus expected*: positive means this side is ahead.
 *
 * Pure and total, so the thresholds can be tested without a video element.
 */
export function decideDriftCorrection(driftMs: number, expected: number): DriftDecision {
  if (!Number.isFinite(driftMs) || !Number.isFinite(expected)) {
    return { action: "none", driftMs: 0 };
  }
  const magnitude = Math.abs(driftMs);
  if (magnitude < SOFT_DRIFT_MS) return { action: "none", driftMs };
  if (magnitude > HARD_DRIFT_MS) return { action: "seek", driftMs, to: expected };
  // Ahead -> slow down; behind -> speed up.
  const rate = driftMs > 0 ? 1 - NUDGE_RATE : 1 + NUDGE_RATE;
  return { action: "nudge", driftMs, rate };
}

/** A `<video>` that cannot seek yet: `readyState` below HAVE_CURRENT_DATA. */
function canSeek(video: HTMLVideoElement): boolean {
  return video.readyState >= 2 && Number.isFinite(video.duration);
}

/**
 * Applies host commands to the local player and remembers the last correction.
 *
 * Stateful only for the nudge: a rate change has to be undone once the offset is
 * gone, and an engine that forgot it would leave the guest playing at 1.05x
 * forever.
 */
export class PartySyncEngine {
  private nudged = false;
  private lastDriftMs = 0;

  constructor(private readonly getVideo: () => HTMLVideoElement | null) {}

  /** Most recent measured drift, for diagnostics and the status bar. */
  get driftMs(): number {
    return this.lastDriftMs;
  }

  get isNudging(): boolean {
    return this.nudged;
  }

  private clearNudge(): void {
    if (!this.nudged) return;
    const video = this.getVideo();
    if (video) video.playbackRate = 1;
    this.nudged = false;
  }

  /** Forget all correction state. Used when playback restarts or the party ends. */
  reset(): void {
    this.clearNudge();
    this.lastDriftMs = 0;
  }

  /**
   * Host pressed play.
   *
   * Align first, then play: starting playback and *then* seeking makes the audio
   * jump, which is more noticeable than a seek while paused.
   */
  async handlePlay(at: number): Promise<void> {
    const video = this.getVideo();
    if (!video) return;
    this.clearNudge();
    if (canSeek(video) && Math.abs(video.currentTime - at) > SOFT_DRIFT_MS / 1000) {
      video.currentTime = at;
    }
    try {
      await video.play();
    } catch {
      // Autoplay can still be refused in edge cases; the guest can press play
      // manually, and the next heartbeat re-aligns.
    }
  }

  /** Host pressed pause. */
  handlePause(at: number): void {
    const video = this.getVideo();
    if (!video) return;
    this.clearNudge();
    if (!video.paused) video.pause();
    if (canSeek(video) && Math.abs(video.currentTime - at) > SOFT_DRIFT_MS / 1000) {
      video.currentTime = at;
    }
  }

  /** Host seeked. */
  handleSeek(at: number): void {
    const video = this.getVideo();
    if (!video) return;
    this.clearNudge();
    if (canSeek(video)) video.currentTime = at;
  }

  /**
   * Periodic realignment against a heartbeat.
   *
   * `rttMs` compensates for the time the frame spent in flight; without it the
   * guest is permanently behind by the one-way latency.
   */
  handleHeartbeat(
    msg: Extract<PartyMessage, { t: "heartbeat" }>,
    rttMs: number,
    now: number
  ): DriftDecision {
    const video = this.getVideo();
    if (!video) return { action: "none", driftMs: 0 };

    /*
     * The host stalled, so there is nothing to follow. Pausing here is what keeps
     * the guest from running ahead and having to be yanked back afterwards.
     */
    if (msg.buffering) {
      this.clearNudge();
      if (!video.paused) video.pause();
      return { action: "none", driftMs: 0 };
    }

    const expected = projectPartyPosition(msg.at, msg.playing, msg.sentAt, now, rttMs);

    // Match the host's transport state before worrying about position.
    if (msg.playing && video.paused) {
      // A refused play is not fatal: the next heartbeat retries, and the guest can
      // always press play itself.
      void video.play().catch(() => undefined);
    } else if (!msg.playing && !video.paused) {
      this.clearNudge();
      video.pause();
    }

    if (!msg.playing) {
      /*
       * Paused: the host's position is static, so aligning is deterministic and
       * cannot oscillate — there is no moving target to chase.
       *
       * This used to skip correction entirely, on the reasoning that drift cannot
       * accumulate while nothing is playing. True, but it also meant a lost `pause`
       * command left the guest parked at the wrong frame permanently: a real run
       * ended 1.96 s apart with the guest's own drift readout reporting it.
       */
      this.clearNudge();
      const pausedDriftMs = (video.currentTime - expected) * 1000;
      this.lastDriftMs = pausedDriftMs;
      if (canSeek(video) && Math.abs(pausedDriftMs) > SOFT_DRIFT_MS) {
        video.currentTime = expected;
        return { action: "seek", driftMs: pausedDriftMs, to: expected };
      }
      return { action: "none", driftMs: pausedDriftMs };
    }

    const driftMs = (video.currentTime - expected) * 1000;
    this.lastDriftMs = driftMs;

    // A nudge already in flight is left alone: re-deciding every heartbeat would
    // flip the rate between fast and slow and never converge.
    if (this.nudged) {
      if (Math.abs(driftMs) < SOFT_DRIFT_MS) this.clearNudge();
      return { action: "none", driftMs };
    }

    const decision = decideDriftCorrection(driftMs, expected);
    if (decision.action === "nudge") {
      video.playbackRate = decision.rate;
      this.nudged = true;
    } else if (decision.action === "seek" && canSeek(video)) {
      video.currentTime = decision.to;
    }
    return decision;
  }
}

/**
 * Guest's own readiness, as sent upstream.
 *
 * `readyState >= 2` is the point at which the player has decoded a frame, which is
 * the earliest moment a seek or a play will actually take effect.
 */
export function readPlayerSnapshot(video: HTMLVideoElement | null): {
  at: number;
  playing: boolean;
  buffering: boolean;
} {
  if (!video) return { at: 0, playing: false, buffering: false };
  return {
    at: Number.isFinite(video.currentTime) ? video.currentTime : 0,
    playing: !video.paused && !video.ended,
    // Ready-but-starved shows up as a stalled readyState with playback intended.
    buffering: video.readyState < 3 && !video.paused,
  };
}
