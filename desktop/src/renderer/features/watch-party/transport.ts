import type { PartyMessage } from "@/shared/watch-party/protocol";

/**
 * Transport abstraction for a watch party.
 *
 * The sync engine talks only to this interface, so LAN and WebRTC differ in how
 * bytes travel and in nothing else. That is what keeps the session logic testable
 * against one transport and reusable for the other.
 */
export type PartyTransportKind = "lan" | "webrtc";

/** Connection state as reported by the transport. Mirrors the main-process shape. */
export type PartyTransportStatus = {
  state: "idle" | "listening" | "connecting" | "connected" | "closed" | "error";
  /** Fatal: the session will not recover on its own. Cleared when one arrives without it. */
  error?: string;
  /**
   * Non-fatal information about a session that is still trying.
   *
   * Exists because "ICE failed" and "the other person has not pasted the code yet"
   * look identical from the guest's side. Reporting the first as a hard error told
   * the user their connection had failed while it was simply waiting — and the
   * message then stayed on screen even after the connection came up.
   */
  notice?: string;
};

export type PartyTransportHandlers = {
  onMessage: (msg: PartyMessage) => void;
  onStatus: (status: PartyTransportStatus) => void;
  /**
   * WebRTC only: what the connection attempt actually did.
   *
   * Without this a failed party is an opaque "could not connect", and the two
   * causes that matter — the two machines cannot reach each other at all, versus
   * the codes arrived too late — are indistinguishable from the outside.
   */
  onDiagnostics?: (info: PartyDiagnostics) => void;
};

export type PartyDiagnostics = {
  /** Candidates gathered locally, by kind. `relay` is always 0: no TURN. */
  hostCandidates: number;
  srflxCandidates: number;
  relayCandidates: number;
  /** `RTCPeerConnection.iceConnectionState` as of the last change. */
  iceState: string;
  /** `RTCPeerConnection.connectionState` as of the last change. */
  connectionState: string;
  /** Whether a public address was discovered — without one, only same-network works. */
  publicAddressFound: boolean;
};

export interface PartyTransport {
  readonly kind: PartyTransportKind;
  /** Send in the outbound direction for this peer's role. */
  send(message: PartyMessage): Promise<{ ok: boolean; error?: string }>;
  close(): Promise<void>;
}

/** What the host needs to display so a guest can reach it. */
export type PartyHostInfo = {
  port: number;
  pin: string;
  addresses: string[];
};
