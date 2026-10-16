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
  error?: string;
};

export type PartyTransportHandlers = {
  onMessage: (msg: PartyMessage) => void;
  onStatus: (status: PartyTransportStatus) => void;
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
