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
  const { sendPlay, sendPause, sendSeek, reportReady, reportBuffering } = actions;
  const actionsRef = useRef({ sendPlay, sendPause, sendSeek, reportReady, reportBuffering });
  actionsRef.current = { sendPlay, sendPause, sendSeek, reportReady, reportBuffering };

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
   * The host uses this to know whether the other side can actually play before it
   * resumes; without it the guest silently falls behind while its stream loads.
   */
  useEffect(() => {
    if (session.role !== "guest" || !videoEl) return;

    const ready = () => actionsRef.current.reportReady(true, videoEl.currentTime);
    const stalled = () => actionsRef.current.reportBuffering(true, videoEl.currentTime);
    const resumed = () => actionsRef.current.reportBuffering(false, videoEl.currentTime);

    videoEl.addEventListener("loadeddata", ready);
    videoEl.addEventListener("canplay", ready);
    videoEl.addEventListener("waiting", stalled);
    videoEl.addEventListener("playing", resumed);
    videoEl.addEventListener("seeked", resumed);

    return () => {
      videoEl.removeEventListener("loadeddata", ready);
      videoEl.removeEventListener("canplay", ready);
      videoEl.removeEventListener("waiting", stalled);
      videoEl.removeEventListener("playing", resumed);
      videoEl.removeEventListener("seeked", resumed);
    };
  }, [session.role, videoEl]);

  /** Keep the RTT hint fresh from the newest heartbeat. */
  useEffect(() => {
    if (session.role !== "guest" || session.latencyMs == null) return;
    rttRef.current = session.latencyMs;
  }, [session.role, session.latencyMs]);

  return { driftMs: engine.driftMs };
}

