import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  WATCH_PARTY_HEARTBEAT_MS,
  WATCH_PARTY_PROTOCOL_VERSION,
  type PartyMessage,
  type PartyShow,
} from "@/shared/watch-party/protocol";

import { createLanGuest, createLanHost } from "./lan-transport";
import type {
  PartyHostInfo,
  PartyTransport,
  PartyTransportStatus,
} from "./transport";

export type PartyRole = "host" | "guest";

export type PartyConnectionState = PartyTransportStatus["state"];

/**
 * Playback facts the host publishes on every heartbeat.
 *
 * Supplied by the caller so this hook stays free of player concerns: in Phase 2 the
 * watch page provides real values, and until then the default (paused at zero) is
 * reported, which is accurate for a party that has not started playing anything.
 */
export type PartyPlaybackSnapshot = {
  at: number;
  playing: boolean;
  buffering: boolean;
};

export type WatchPartySession = {
  role: PartyRole | null;
  status: PartyConnectionState;
  error: string | null;
  /** Host only: what to share with the guest. */
  hostInfo: PartyHostInfo | null;
  peerName: string | null;
  /** Host only: measured round trip, in ms. */
  latencyMs: number | null;
  /** Guest only: when the last heartbeat arrived, for a liveness indicator. */
  lastHeartbeatAt: number | null;
  /** What the party is watching, as agreed between the two sides. */
  show: PartyShow | null;
  /** Host only: whether a guest is currently attached. */
  guestConnected: boolean;
  /** Guest only: whether its own player is ready to be driven. */
  selfReady: boolean;
};

export type WatchPartyActions = {
  startHost: () => Promise<void>;
  join: (address: string, pin: string) => Promise<void>;
  leave: () => Promise<void>;
  /** Host: announce what the party is watching. */
  publishShow: (show: PartyShow) => Promise<void>;
  sendPlay: (at: number) => Promise<void>;
  sendPause: (at: number) => Promise<void>;
  sendSeek: (at: number) => Promise<void>;
  /** Guest: tell the host this side is ready (or no longer able). */
  reportReady: (ready: boolean, position: number) => void;
  reportBuffering: (buffering: boolean, position: number) => void;
  /** Host: playback facts to publish in the next heartbeat. */
  setPlaybackSource: (source: () => PartyPlaybackSnapshot) => void;
};

const IDLE_SESSION: WatchPartySession = {
  role: null,
  status: "idle",
  error: null,
  hostInfo: null,
  peerName: null,
  latencyMs: null,
  lastHeartbeatAt: null,
  show: null,
  guestConnected: false,
  selfReady: false,
};

/**
 * Session state machine for a watch party.
 *
 * Owns role, presence and the heartbeat; delivers inbound playback commands to
 * `onRemoteCommand`, which the watch page uses to drive the player. Kept separate
 * from any page so the party survives navigation — a user setting up a party on
 * `/party` and then opening a show must not drop the connection.
 */
export function useWatchPartySession(options: {
  displayName: string;
  /** Guest side: a host command arrived and should be applied to the player. */
  onRemoteCommand?: (msg: PartyMessage) => void;
  /** Guest side: the host announced what to play. */
  onRemoteShow?: (show: PartyShow) => void;
}) {
  const [session, setSession] = useState<WatchPartySession>(IDLE_SESSION);
  const transportRef = useRef<PartyTransport | null>(null);
  const roleRef = useRef<PartyRole | null>(null);
  /** Latest session, readable from effects that must not re-subscribe on change. */
  const sessionRef = useRef(session);
  sessionRef.current = session;
  /**
   * Whether the current guest has already been greeted.
   *
   * A guest connecting is reported by a status change that can fire more than once
   * for the same peer; without this latch the host would re-send `hello` on every
   * render and the guest's presence would flicker.
   */
  const greetedRef = useRef(false);
  const playbackSourceRef = useRef<() => PartyPlaybackSnapshot>(() => ({
    at: 0,
    playing: false,
    buffering: false,
  }));

  // Latest callbacks without re-subscribing the transport on every render.
  const onRemoteCommandRef = useRef(options.onRemoteCommand);
  onRemoteCommandRef.current = options.onRemoteCommand;
  const onRemoteShowRef = useRef(options.onRemoteShow);
  onRemoteShowRef.current = options.onRemoteShow;
  const displayNameRef = useRef(options.displayName);
  displayNameRef.current = options.displayName;

  const patch = useCallback((next: Partial<WatchPartySession>) => {
    setSession((prev) => ({ ...prev, ...next }));
  }, []);

  /**
   * Handle one inbound frame.
   *
   * Direction is enforced by the transports (and by main for LAN), so this only
   * needs to switch on the type; anything unknown is ignored rather than fatal, so
   * a newer peer cannot break an older one.
   */
  const handleMessage = useCallback(
    (msg: PartyMessage) => {
      const role = roleRef.current;
      switch (msg.t) {
        case "hello":
          // Guest side: the host introduces itself and states what is playing.
          patch({ peerName: msg.hostName || null, show: msg.show ?? null });
          break;
        case "ready":
          // Host side: the guest attached.
          patch({ peerName: msg.name || null, guestConnected: true });
          break;
        case "show":
          patch({ show: msg.show });
          onRemoteShowRef.current?.(msg.show);
          break;
        case "play":
        case "pause":
        case "seek":
          if (role === "guest") onRemoteCommandRef.current?.(msg);
          break;
        case "heartbeat":
          if (role === "guest") {
            patch({ lastHeartbeatAt: Date.now() });
            // Echo the host's own timestamp so it can measure a real round trip.
            void transportRef.current?.send({ t: "pong", sentAt: msg.sentAt });
            onRemoteCommandRef.current?.(msg);
          }
          break;
        case "pong":
          if (role === "host") patch({ latencyMs: Date.now() - msg.sentAt });
          break;
        case "state":
          // Host side telemetry; the caller reads it through `onRemoteCommand`.
          if (role === "host") onRemoteCommandRef.current?.(msg);
          break;
        case "requestSync":
          if (role === "host") onRemoteCommandRef.current?.(msg);
          break;
        case "bye":
          patch({ guestConnected: false, peerName: null });
          break;
      }
    },
    [patch]
  );

  const handleStatus = useCallback(
    (status: PartyTransportStatus) => {
      patch({
        status: status.state,
        ...(status.error ? { error: status.error } : {}),
        // A dropped guest is no longer present; keeping the name would show a
        // phantom participant.
        ...(status.state === "listening" || status.state === "closed"
          ? { guestConnected: false, peerName: null }
          : {}),
      });
    },
    [patch]
  );

  const startHost = useCallback(async () => {
    setSession({ ...IDLE_SESSION, status: "connecting" });
    try {
      const { info, transport } = await createLanHost(
        { onMessage: handleMessage, onStatus: handleStatus },
        displayNameRef.current
      );
      transportRef.current = transport;
      roleRef.current = "host";
      patch({ role: "host", hostInfo: info, status: "listening", error: null });
    } catch (error: unknown) {
      roleRef.current = null;
      transportRef.current = null;
      patch({
        role: null,
        status: "error",
        error: error instanceof Error ? error.message : "Impossibile creare la stanza",
      });
    }
  }, [handleMessage, handleStatus, patch]);

  const join = useCallback(
    async (address: string, pin: string) => {
      setSession({ ...IDLE_SESSION, status: "connecting" });
      try {
        const transport = await createLanGuest(
          { onMessage: handleMessage, onStatus: handleStatus },
          address,
          pin
        );
        transportRef.current = transport;
        roleRef.current = "guest";
        patch({ role: "guest", status: "connected", error: null });
        // Announce presence only after the stream is up, otherwise the host would
        // learn a name for a guest that never arrived.
        await transport.send({
          t: "ready",
          v: WATCH_PARTY_PROTOCOL_VERSION,
          name: displayNameRef.current,
        });
      } catch (error: unknown) {
        roleRef.current = null;
        transportRef.current = null;
        patch({
          role: null,
          status: "error",
          error: error instanceof Error ? error.message : "Connessione fallita",
        });
      }
    },
    [handleMessage, handleStatus, patch]
  );

  const leave = useCallback(async () => {
    const transport = transportRef.current;
    roleRef.current = null;
    transportRef.current = null;
    setSession(IDLE_SESSION);
    if (transport) {
      try {
        await transport.send({ t: "bye", reason: "left" });
      } catch {
        /* best effort: the peer may already be gone */
      }
      await transport.close();
    }
  }, []);

  /**
   * Host: greet a guest as soon as it attaches.
   *
   * Without this the guest has no name to show and no idea what is playing — the
   * handshake was one-sided: the guest announced itself with `ready`, but the host
   * never answered.
   */
  useEffect(() => {
    if (session.role !== "host" || session.status !== "connected") {
      greetedRef.current = false;
      return;
    }
    if (greetedRef.current) return;
    greetedRef.current = true;
    void transportRef.current?.send({
      t: "hello",
      v: WATCH_PARTY_PROTOCOL_VERSION,
      hostName: displayNameRef.current,
      show: sessionRef.current.show,
    });
  }, [session.role, session.status]);

  /** Host: periodic heartbeat. Doubles as liveness and RTT probe. */
  useEffect(() => {
    if (session.role !== "host" || session.status !== "connected") return;
    const timer = setInterval(() => {
      const snapshot = playbackSourceRef.current();
      const rtt = sessionRef.current.latencyMs;
      void transportRef.current?.send({
        t: "heartbeat",
        at: snapshot.at,
        playing: snapshot.playing,
        buffering: snapshot.buffering,
        sentAt: Date.now(),
        // Echoed so the guest can compensate for latency with the same figure.
        ...(rtt == null ? {} : { rttMs: rtt }),
      });
    }, WATCH_PARTY_HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [session.role, session.status]);

  const sendCommand = useCallback(
    async (msg: { t: "play" | "pause" | "seek"; at: number }) => {
      if (roleRef.current !== "host") return;
      await transportRef.current?.send({ ...msg, sentAt: Date.now() });
    },
    []
  );

  const publishShow = useCallback(async (show: PartyShow) => {
    setSession((prev) => ({ ...prev, show }));
    if (roleRef.current !== "host") return;
    await transportRef.current?.send({ t: "show", show });
  }, []);

  const reportState = useCallback((ready: boolean, buffering: boolean, position: number) => {
    if (roleRef.current !== "guest") return;
    void transportRef.current?.send({ t: "state", ready, buffering, position });
  }, []);

  const actions = useMemo<WatchPartyActions>(
    () => ({
      startHost,
      join,
      leave,
      publishShow,
      sendPlay: (at: number) => sendCommand({ t: "play", at }),
      sendPause: (at: number) => sendCommand({ t: "pause", at }),
      sendSeek: (at: number) => sendCommand({ t: "seek", at }),
      reportReady: (ready: boolean, position: number) => reportState(ready, false, position),
      reportBuffering: (buffering: boolean, position: number) =>
        reportState(false, buffering, position),
      setPlaybackSource: (source: () => PartyPlaybackSnapshot) => {
        playbackSourceRef.current = source;
      },
    }),
    [startHost, join, leave, publishShow, sendCommand, reportState]
  );

  return { session, actions };
}
