import { WATCH_PARTY_PROTOCOL_VERSION } from "@/shared/watch-party/protocol";

/**
 * Invite and answer codes for an internet watch party.
 *
 * WebRTC needs a signalling channel to swap session descriptions, and the decision
 * was to avoid running one: the two users pass the codes to each other by whatever
 * they are already talking on. That makes the code the whole protocol — it has to
 * survive being pasted into a chat message, so it is compressed and base64url
 * encoded rather than being a raw SDP blob.
 *
 * A description for a data-channel-only connection is around 1.4 kB of text; it
 * compresses to roughly a quarter of that because SDP is highly repetitive. The
 * prefix makes a code recognisable and lets a pasted code be validated before it is
 * parsed.
 *
 * The invite carries the PIN as well as the description, so the host can check that
 * whoever completes the handshake is the person it invited. Note honestly that this
 * is a check against *confusion* — a stale or mismatched code — and not a secret
 * boundary: anyone holding the invite already holds the PIN inside it. The real
 * capability is the invite itself, which is why it must be sent privately.
 */

export const INVITE_CODE_PREFIX = "APW1:";

/** Answer codes are tagged separately so pasting the wrong one is diagnosable. */
export const ANSWER_CODE_PREFIX = "APW1A:";

export interface InvitePayload {
  v: number;
  pin: string;
  host: string;
  /** The host's session description, with ICE candidates already gathered in. */
  sdp: string;
}

export interface AnswerPayload {
  v: number;
  /** The guest's session description, candidates included. */
  sdp: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  // Chunked: `String.fromCharCode(...bytes)` blows the argument limit on a
  // multi-kilobyte array.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

/**
 * Encode a payload as a pasteable code.
 *
 * Falls back to uncompressed base64 if the compression APIs are missing, so a code
 * is always produced: a longer code is far better than a party that cannot start.
 */
async function encode(prefix: string, payload: unknown): Promise<string> {
  const json = JSON.stringify(payload);
  try {
    return prefix + bytesToBase64Url(await deflate(json));
  } catch {
    return prefix + bytesToBase64Url(new TextEncoder().encode(json));
  }
}

/** `JSON.parse` returns `any`; this keeps the boundary at `unknown`. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Decode a code, or return null when it is malformed. Never throws. */
async function decode(prefix: string, code: string): Promise<unknown> {
  const trimmed = code.trim();
  if (!trimmed.startsWith(prefix)) return null;
  const body = trimmed.slice(prefix.length).replace(/\s+/g, "");
  if (!body) return null;

  /*
   * `atob` throws on any character outside the base64 alphabet, and a pasted code
   * is exactly the kind of input that contains one — a stray "!" or an ellipsis
   * from a chat client truncating the message. Decoding therefore happens inside a
   * guard: this function's contract is that a bad code yields null, so the caller
   * can report "invalid code" instead of an exception nobody catches.
   */
  let bytes: Uint8Array;
  try {
    bytes = base64UrlToBytes(body);
  } catch {
    return null;
  }

  /*
   * Compressed first, then the uncompressed fallback used when CompressionStream
   * was unavailable at encode time. Annotated explicitly: the stream types here
   * infer loosely, and an `any` slipping through would defeat the validation that
   * follows.
   */
  let inflated: string | null = null;
  try {
    inflated = await inflate(bytes);
  } catch {
    inflated = null;
  }
  return parseJson(inflated ?? new TextDecoder().decode(bytes));
}

export async function encodeInvite(payload: InvitePayload): Promise<string> {
  return encode(INVITE_CODE_PREFIX, payload);
}

export async function encodeAnswer(payload: AnswerPayload): Promise<string> {
  return encode(ANSWER_CODE_PREFIX, payload);
}

function isDescription(value: unknown): value is string {
  return typeof value === "string" && value.includes("v=");
}

/**
 * Parse an invite code.
 *
 * Validates every field that will be handed to `setRemoteDescription`: a
 * description without `v=` would otherwise surface as an opaque WebRTC error.
 */
export async function decodeInvite(code: string): Promise<InvitePayload | null> {
  const raw = (await decode(INVITE_CODE_PREFIX, code)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return null;
  if (!isDescription(raw.sdp)) return null;
  return {
    v: typeof raw.v === "number" ? raw.v : 0,
    pin: typeof raw.pin === "string" ? raw.pin : "",
    host: typeof raw.host === "string" ? raw.host : "",
    sdp: raw.sdp,
  };
}

export async function decodeAnswer(code: string): Promise<AnswerPayload | null> {
  const raw = (await decode(ANSWER_CODE_PREFIX, code)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return null;
  if (!isDescription(raw.sdp)) return null;
  return { v: typeof raw.v === "number" ? raw.v : 0, sdp: raw.sdp };
}

/** Whether a pasted string at least looks like one of our codes. */
export function looksLikeInvite(code: string): boolean {
  return code.trim().startsWith(INVITE_CODE_PREFIX);
}

export function looksLikeAnswer(code: string): boolean {
  return code.trim().startsWith(ANSWER_CODE_PREFIX);
}

export const CURRENT_INVITE_VERSION = WATCH_PARTY_PROTOCOL_VERSION;
