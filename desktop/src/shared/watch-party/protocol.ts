import { isStreamProviderName, type StreamProviderName } from "@/shared/stream-providers";

/**
 * Wire protocol for a watch party.
 *
 * Shared by the main process (which relays LAN messages and validates them) and
 * the renderer (WebRTC transport and sync engine). Deliberately free of React,
 * Electron and Node imports so both sides can use it unchanged.
 *
 * ## Identity, not URLs
 *
 * A party never sends a stream URL. It sends *what* is playing (provider, id,
 * episode) and each peer resolves its own stream locally. Provider URLs are
 * short-lived, host-bound and sometimes region-locked, so a URL captured by the
 * host is not usable by the guest — and relaying video would need a media server
 * and TURN. Syncing the timeline instead costs nothing and keeps the two
 * independent, which is also why the app's existing cross-host repair still
 * applies on the guest side.
 */
export const WATCH_PARTY_PROTOCOL_VERSION = 1;

/** Upper bound on a single frame, in bytes of JSON. */
export const WATCH_PARTY_MAX_MESSAGE_BYTES = 16 * 1024;

/** How often the host reports its position, in ms. */
export const WATCH_PARTY_HEARTBEAT_MS = 2000;

/** What a party is watching. */
export interface PartyShow {
  /**
   * Provider that issued `providerId`.
   *
   * Carried because provider ids are only meaningful to the host that produced
   * them; the guest uses this as a starting point and falls back to its own
   * enabled providers when the id is not resolvable there.
   */
  provider: StreamProviderName;
  providerId: string;
  /** AniList media id when known, so the guest can match across providers. */
  anilistMediaId: number | null;
  /** Display only — never used for lookup. */
  title: string;
  episodeIndex: number;
  mode: "sub" | "dub";
}

/** Host -> guest. */
export type PartyHostMessage =
  | { t: "hello"; v: number; hostName: string; show: PartyShow | null }
  | { t: "show"; show: PartyShow }
  | { t: "play"; at: number; sentAt: number }
  | { t: "pause"; at: number; sentAt: number }
  | { t: "seek"; at: number; sentAt: number }
  | {
      t: "heartbeat";
      at: number;
      playing: boolean;
      buffering: boolean;
      sentAt: number;
    }
  | { t: "bye"; reason: string };

/** Guest -> host. */
export type PartyGuestMessage =
  | { t: "ready"; v: number; name: string }
  | { t: "state"; ready: boolean; buffering: boolean; position: number }
  /**
   * Reply to a `heartbeat`. `sentAt` **echoes** the heartbeat's own `sentAt`, not
   * the moment this frame was written: that is what lets the host measure a real
   * round trip as `Date.now() - sentAt` and correct for the time a position took
   * to arrive. A fresh timestamp here would only measure the guest's clock.
   */
  | { t: "pong"; sentAt: number }
  | { t: "requestSync" }
  | { t: "bye"; reason: string };

export type PartyMessage = PartyHostMessage | PartyGuestMessage;

export type PartyMessageType = PartyMessage["t"];

/** Message types the host is allowed to send. */
const HOST_MESSAGE_TYPES = new Set<PartyMessageType>([
  "hello",
  "show",
  "play",
  "pause",
  "seek",
  "heartbeat",
  "bye",
]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate a `PartyShow` arriving from the network.
 *
 * Every field is checked because this is untrusted input: a malformed `provider`
 * would be handed to the provider layer, and a non-numeric `episodeIndex` would
 * reach the player as `NaN`.
 */
function parsePartyShow(value: unknown): PartyShow | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isStreamProviderName(raw.provider)) return null;
  if (!isNonEmptyString(raw.providerId)) return null;
  if (raw.mode !== "sub" && raw.mode !== "dub") return null;
  if (!isFiniteNumber(raw.episodeIndex) || raw.episodeIndex <= 0) return null;

  const anilistMediaId =
    isFiniteNumber(raw.anilistMediaId) && Number.isInteger(raw.anilistMediaId) && raw.anilistMediaId > 0
      ? raw.anilistMediaId
      : null;

  return {
    provider: raw.provider,
    providerId: raw.providerId.trim(),
    anilistMediaId,
    // A missing title is not fatal; the guest can name the show from its own
    // details lookup, so it degrades to an empty string rather than failing.
    title: typeof raw.title === "string" ? raw.title : "",
    episodeIndex: Math.floor(raw.episodeIndex),
    mode: raw.mode,
  };
}

/** `at` positions must be finite and non-negative; `NaN` would poison the player. */
function parsePosition(value: unknown): number | null {
  if (!isFiniteNumber(value) || value < 0) return null;
  return value;
}

/**
 * Parse and validate one wire frame.
 *
 * Returns `null` for anything that is not a well-formed message of the expected
 * direction. Callers must treat `null` as "drop it" rather than throwing: an
 * unknown or future message type from a newer peer must not break the session.
 *
 * @param raw        JSON string or already-parsed object.
 * @param expectFrom Which side sent it — enforces that a guest cannot issue host
 *                   commands. Without this check a malicious guest could send
 *                   `play`/`seek` straight into the sync engine.
 */
export function parsePartyMessage(
  raw: unknown,
  expectFrom: "host" | "guest"
): PartyMessage | null {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > WATCH_PARTY_MAX_MESSAGE_BYTES) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;

  const msg = value as Record<string, unknown>;
  const t = msg.t;
  if (typeof t !== "string") return null;

  const fromHost = HOST_MESSAGE_TYPES.has(t as PartyMessageType);
  const fromGuest = !fromHost;
  if (expectFrom === "host" && !fromHost) return null;
  if (expectFrom === "guest" && !fromGuest) return null;

  switch (t) {
    case "hello": {
      const show = msg.show === null || msg.show === undefined ? null : parsePartyShow(msg.show);
      return {
        t: "hello",
        v: isFiniteNumber(msg.v) ? msg.v : 0,
        hostName: typeof msg.hostName === "string" ? msg.hostName : "",
        show,
      };
    }
    case "show": {
      const show = parsePartyShow(msg.show);
      return show ? { t: "show", show } : null;
    }
    case "play":
    case "pause":
    case "seek": {
      const at = parsePosition(msg.at);
      if (at === null) return null;
      return {
        t,
        at,
        sentAt: isFiniteNumber(msg.sentAt) ? msg.sentAt : Date.now(),
      };
    }
    case "heartbeat": {
      const at = parsePosition(msg.at);
      if (at === null) return null;
      return {
        t: "heartbeat",
        at,
        playing: msg.playing === true,
        buffering: msg.buffering === true,
        sentAt: isFiniteNumber(msg.sentAt) ? msg.sentAt : Date.now(),
      };
    }
    case "ready":
      return {
        t: "ready",
        v: isFiniteNumber(msg.v) ? msg.v : 0,
        name: typeof msg.name === "string" ? msg.name : "",
      };
    case "state": {
      const position = parsePosition(msg.position);
      if (position === null) return null;
      return {
        t: "state",
        ready: msg.ready === true,
        buffering: msg.buffering === true,
        position,
      };
    }
    case "pong":
      return { t: "pong", sentAt: isFiniteNumber(msg.sentAt) ? msg.sentAt : Date.now() };
    case "requestSync":
      return { t: "requestSync" };
    case "bye":
      return { t: "bye", reason: typeof msg.reason === "string" ? msg.reason : "" };
    default:
      return null;
  }
}

/**
 * The position the sender is at now, adjusted for the time the frame spent in
 * flight.
 *
 * Without this the guest is systematically behind by the one-way latency: it
 * seeks to where the host *was* when the frame was written. `rttMs` is the
 * measured round trip, so half of it approximates the one-way delay.
 */
export function projectPartyPosition(
  at: number,
  playing: boolean,
  sentAt: number,
  now: number,
  rttMs: number
): number {
  if (!playing) return at;
  const elapsed = (now - sentAt + rttMs / 2) / 1000;
  return at + Math.max(0, elapsed);
}
