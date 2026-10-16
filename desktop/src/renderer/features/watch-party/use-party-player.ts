import { useEffect, useMemo, useRef, useState } from "react";

import type { PartyMessage } from "@/shared/watch-party/protocol";

import { useWatchParty } from "./party-provider";
import { PartySyncEngine, readPlayerSnapshot } from "./sync-engine";

/**
 * Connects the party session to the watch page's `<video>`.
 *
 * Two directions, and they are not symmetric:
 *
 *  - **Host**: reports its own transport actions. Native media events are the
 *    source of truth because the user can drive the player through the app's own
 *    controls *or* the browser's, and only the element sees both. The host never
 *    receives commands, so every play/pause/seek it observes really is a user
 *    action.
 *  - **Guest**: applies the host's commands and reports readiness back. It never
 *    sends commands, so applying one cannot echo back and start a loop.
 *
 * Mounted by the watch page, which is the only place a `<video>` exists.
 */
export function usePartyPlayerBridge(options: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}): { driftMs: number } {
  const { session, actions, attachPlayer } = useWatchParty();
  const { videoRef } = options;

  /**
   * The live `<video>`, mirrored into state.
   *
   * A ref cannot trigger an effect, and the element does not exist when the party
   * starts: a host sets the party up on `/party`, then navigates to the watch page
   * where the player mounts. An effect keyed only on `session.role` therefore ran
   * once against a null ref and never again — the host's media listeners were never
   * attached, so play and seek never reached the guest (only the heartbeat did,
   * which is why pausing appeared to work).
   */
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (session.role === null) {
      setVideoEl(null);
      return;
    }
    // Cheap poll rather than a render-triggered read: the element appears and
    // disappears with the player's own lifecycle (HLS and progressive sources use
    // different components), and nothing in this component re-renders when it does.
    const sync = () => setVideoEl((prev) => (prev === videoRef.current ? prev : videoRef.current));
    sync();
    const id = setInterval(sync, 300);
    return () => clearInterval(id);
  }, [session.role, videoRef]);

  const engineRef = useRef<PartySyncEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new PartySyncEngine(() => videoRef.current);
  }
  const engine = engineRef.current;

  /** Latest RTT reported by the host; the guest cannot measure it itself. */
  const rttRef = useRef(0);

  /*
   * Read through refs inside the adapter so its identity stays stable. Rebuilding
   * it on every session change would detach and reattach the player on each
   * heartbeat, and the guest would drop commands in between.
   */
  const roleRef = useRef(session.role);
  roleRef.current = session.role;
  const { sendPlay, sendPause, sendSeek, reportState } = actions;
  const actionsRef = useRef({ sendPlay, sendPause, sendSeek, reportState });
  actionsRef.current = { sendPlay, sendPause, sendSeek, reportState };

  const adapter = useMemo(
    () => ({
      applyCommand: (msg: PartyMessage) => {
        if (roleRef.current !== "guest") return;
        switch (msg.t) {
          case "play":
            void engine.handlePlay(msg.at);
            break;
          case "pause":
            engine.handlePause(msg.at);
            break;
          case "seek":
            engine.handleSeek(msg.at);
            break;
          case "heartbeat":
            engine.handleHeartbeat(msg, msg.rttMs ?? rttRef.current, Date.now());
            break;
          case "show":
            // A new episode means a new stream. Stop the old one so the guest does
            // not keep playing the previous episode behind the new page; navigation
            // itself is the provider's job.
            engine.reset();
            videoRef.current?.pause();
            break;
          default:
            break;
        }
      },
      getSnapshot: () => readPlayerSnapshot(videoRef.current),
    }),
    [engine, videoRef]
  );

  useEffect(() => {
    attachPlayer(adapter);
    return () => attachPlayer(null);
  }, [adapter, attachPlayer]);

  /** Host: turn local media events into commands for the guest. */
  useEffect(() => {
    if (session.role !== "host" || !videoEl) return;

    const onPlay = () => {
      engine.reset();
      void actionsRef.current.sendPlay(videoEl.currentTime);
    };
    const onPause = () => {
      if (videoEl.ended) return; // an ended episode is not a pause the guest should mirror
      void actionsRef.current.sendPause(videoEl.currentTime);
    };
    const onSeeked = () => {
      void actionsRef.current.sendSeek(videoEl.currentTime);
    };

    videoEl.addEventListener("play", onPlay);
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("seeked", onSeeked);
    return () => {
      videoEl.removeEventListener("play", onPlay);
      videoEl.removeEventListener("pause", onPause);
      videoEl.removeEventListener("seeked", onSeeked);
    };
  }, [session.role, videoEl, engine]);

  /**
   * Guest: report readiness and stalls.
   *
   * Both flags are computed together so the host always receives a coherent
   * picture; reporting them independently meant one call cleared the other field.
   */
  useEffect(() => {
    if (session.role !== "guest" || !videoEl) return;

    /*
     * `ready` means "this player can start on command": it has data for the current
     * position. Deriving it from `readyState` rather than latching it once on
     * `canplay` keeps it correct across an episode change, when the element is
     * briefly empty again and the host must not resume into a black frame.
     */
    const report = () => {
      const canPlay = videoEl.readyState >= 3 && Number.isFinite(videoEl.duration);
      const buffering = videoEl.readyState < 3 && !videoEl.paused && !videoEl.ended;
      actionsRef.current.reportState(canPlay, buffering, videoEl.currentTime);
    };

    videoEl.addEventListener("loadeddata", report);
    videoEl.addEventListener("canplay", report);
    videoEl.addEventListener("waiting", report);
    videoEl.addEventListener("playing", report);
    videoEl.addEventListener("seeked", report);
    videoEl.addEventListener("emptied", report);
    report();

    return () => {
      videoEl.removeEventListener("loadeddata", report);
      videoEl.removeEventListener("canplay", report);
      videoEl.removeEventListener("waiting", report);
      videoEl.removeEventListener("playing", report);
      videoEl.removeEventListener("seeked", report);
      videoEl.removeEventListener("emptied", report);
    };
  }, [session.role, videoEl]);

  /** Keep the RTT hint fresh from the newest heartbeat. */
  useEffect(() => {
    if (session.role !== "guest" || session.latencyMs == null) return;
    rttRef.current = session.latencyMs;
  }, [session.role, session.latencyMs]);

  return { driftMs: engine.driftMs };
}

