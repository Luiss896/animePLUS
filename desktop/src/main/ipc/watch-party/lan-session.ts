import crypto from "node:crypto";
import http from "node:http";
import type { ServerResponse } from "node:http";

import {
  parsePartyMessage,
  WATCH_PARTY_MAX_MESSAGE_BYTES,
  type PartyMessage,
} from "@/shared/watch-party/protocol";

import { listLanAddresses } from "./lan-address";

/**
 * LAN transport for a watch party.
 *
 * The host listens on the local network and the guest dials it. Both run here in
 * the main process rather than in the renderer for one concrete reason: the
 * renderer is served from `file://`, so its origin is `null` and any request to
 * `http://192.168.x.x` is a cross-origin request that `EventSource` would refuse.
 * Node's http client in the main process is not subject to CORS at all.
 *
 * Downstream (host -> guest) is Server-Sent Events; upstream (guest -> host) is a
 * POST. That split is deliberate: the control direction is host -> guest and the
 * only thing flowing back is telemetry, so a one-way stream plus small POSTs is a
 * better fit than a bidirectional socket, and it needs no dependency (Node has no
 * built-in WebSocket *server*).
 *
 * There is no discovery and no central service: the host shows an address and a
 * PIN, and the guest types them in. Nothing leaves the local network.
 */

export type PartyConnectionState =
  | "idle"
  | "listening"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export interface PartyStatusEvent {
  state: PartyConnectionState;
  /** Populated only for `error`. */
  error?: string;
}

export interface PartyHostInfo {
  port: number;
  pin: string;
  /** Every dialable `address:port`, best first. */
  addresses: string[];
}

interface Sink {
  onMessage: (msg: PartyMessage) => void;
  onStatus: (status: PartyStatusEvent) => void;
}

export type PartyRole = "host" | "guest";

let sink: Sink | null = null;
let role: PartyRole | null = null;

/** Host state. */
let server: http.Server | null = null;
let sseClients = new Set<ServerResponse>();
let hostPin = "";

/** Guest state. */
let guestAbort: AbortController | null = null;
/**
 * Where to POST upstream frames.
 *
 * Owned by `joinParty` and cleared by `stopParty`. It must be set *after*
 * `stopParty` runs inside `joinParty` — setting it from the caller beforehand meant
 * the teardown wiped it, and every upstream frame (including the first `ready`)
 * silently failed with "session not ready".
 */
let guestBase = "";
let guestPin = "";

/**
 * Brute-force guard for the PIN.
 *
 * A 6-digit PIN is only 10^6 possibilities, which is trivially enumerable over a
 * LAN at HTTP speed. Five wrong guesses buys a 30 second silence, so the expected
 * time to find the PIN exceeds the length of any viewing session.
 */
const MAX_PIN_FAILURES = 5;
const PIN_LOCKOUT_MS = 30_000;
let pinFailures = 0;
let pinLockedUntil = 0;

export function setPartySink(next: Sink | null): void {
  sink = next;
}

function emitStatus(state: PartyConnectionState, error?: string): void {
  sink?.onStatus(error === undefined ? { state } : { state, error });
}

function emitMessage(msg: PartyMessage): void {
  sink?.onMessage(msg);
}

/** Constant-time compare so a wrong PIN cannot be found one digit at a time. */
function pinMatches(candidate: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(hostPin);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isLockedOut(): boolean {
  return Date.now() < pinLockedUntil;
}

function registerPinFailure(): void {
  pinFailures += 1;
  if (pinFailures >= MAX_PIN_FAILURES) {
    pinFailures = 0;
    pinLockedUntil = Date.now() + PIN_LOCKOUT_MS;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // Refuse oversized frames instead of buffering without bound.
      if (body.length > WATCH_PARTY_MAX_MESSAGE_BYTES * 4) {
        reject(new Error("party message too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export function getPartyRole(): PartyRole | null {
  return role;
}

/**
 * Start listening for a guest.
 *
 * Binds `0.0.0.0` on an ephemeral port: a fixed port would collide with whatever
 * else is running, and the PIN — not the port — is what keeps strangers out.
 */
export async function startPartyHost(hostName: string): Promise<PartyHostInfo> {
  await stopParty();

  const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

  const srv = http.createServer((req, res) => {
    void handleHostRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "0.0.0.0", () => {
      srv.removeListener("error", reject);
      resolve();
    });
  });

  const addr = srv.address();
  if (typeof addr !== "object" || addr === null) {
    srv.close();
    throw new Error("watch party: could not determine the listening port");
  }

  server = srv;
  role = "host";
  hostPin = pin;
  sseClients = new Set();
  pinFailures = 0;
  pinLockedUntil = 0;

  const addresses = listLanAddresses().map((entry) => `${entry.address}:${addr.port}`);
  emitStatus("listening");

  void hostName;
  return { port: addr.port, pin, addresses };
}

function handleHostRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const providedPin = url.searchParams.get("pin") ?? "";

  if (url.pathname !== "/events" && url.pathname !== "/send") {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    return;
  }

  if (isLockedOut() || !pinMatches(providedPin)) {
    registerPinFailure();
    res.writeHead(403, { "Content-Type": "text/plain" }).end("forbidden");
    return;
  }

  if (url.pathname === "/events") {
    // One guest only: this is a 1:1 room, and a second listener would receive
    // commands meant for the first without being able to affect anything.
    if (sseClients.size > 0) {
      res.writeHead(409, { "Content-Type": "text/plain" }).end("room is full");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": animePLUS watch party\n\n");
    sseClients.add(res);
    emitStatus("connected");

    // Keepalive comments stop intermediaries and the OS from reaping an idle
    // stream during a long pause in playback.
    const keepalive = setInterval(() => {
      if (!sseClients.has(res)) return;
      res.write(": ping\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(keepalive);
      sseClients.delete(res);
      if (role === "host") emitStatus("listening");
    });
    return;
  }

  // POST /send — telemetry from the guest.
  void readBody(req)
    .then((body) => {
      const parsed = parsePartyMessage(body, "guest");
      if (!parsed) {
        res.writeHead(400, { "Content-Type": "text/plain" }).end("bad message");
        return;
      }
      emitMessage(parsed);
      res.writeHead(204).end();
    })
    .catch(() => {
      res.writeHead(413, { "Content-Type": "text/plain" }).end("too large");
    });
}

/**
 * Dial a host and hold the event stream open.
 *
 * Resolves once the stream is established, so the UI can report a real success or
 * a real failure instead of assuming the address was good.
 */
export async function joinParty(address: string, pin: string): Promise<void> {
  await stopParty();

  const trimmed = address.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!trimmed) throw new Error("Indirizzo mancante");
  const base = `http://${trimmed}`;

  const controller = new AbortController();
  guestAbort = controller;
  role = "guest";
  // After stopParty, never before: that call clears these.
  guestBase = base;
  guestPin = pin;
  emitStatus("connecting");

  // Fail fast on a wrong address or an unreachable host rather than hanging.
  const timeout = setTimeout(() => controller.abort(), 8000);

  let response: Response;
  try {
    response = await fetch(`${base}/events?pin=${encodeURIComponent(pin)}`, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    });
  } catch (error: unknown) {
    clearTimeout(timeout);
    guestAbort = null;
    role = null;
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Nessuna risposta: controlla indirizzo, PIN e che siate sulla stessa rete"
        : "Impossibile raggiungere l'host";
    emitStatus("error", message);
    throw new Error(message);
  }
  clearTimeout(timeout);

  if (!response.ok) {
    guestAbort = null;
    role = null;
    const message =
      response.status === 403
        ? "PIN errato"
        : response.status === 409
          ? "La stanza è già occupata"
          : `L'host ha rifiutato la connessione (${response.status})`;
    emitStatus("error", message);
    throw new Error(message);
  }
  if (!response.body) {
    guestAbort = null;
    role = null;
    emitStatus("error", "Risposta senza flusso di eventi");
    throw new Error("Risposta senza flusso di eventi");
  }

  emitStatus("connected");

  /*
   * Bind the stream to a local so the async consumer below keeps the narrowing:
   * inside the closure TypeScript can no longer see the `!response.body` guard.
   */
  const stream = response.body;
  void (async () => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue; // keepalive comment
          const parsed = parsePartyMessage(line.slice(6), "host");
          if (parsed) emitMessage(parsed);
        }
      }
      if (role === "guest") emitStatus("closed");
    } catch {
      if (role === "guest") emitStatus("closed");
    }
  })();
}

/** Send a message in the outbound direction for the current role. */
export function sendPartyMessage(message: unknown): { ok: boolean; error?: string } {
  if (!role) return { ok: false, error: "Nessuna sessione attiva" };

  // Validate outbound too: a guest must not be able to emit host commands even if
  // the renderer were compromised.
  const expectFrom = role === "host" ? "host" : "guest";
  const parsed = parsePartyMessage(message, expectFrom);
  if (!parsed) return { ok: false, error: "Messaggio non valido" };

  const payload = JSON.stringify(parsed);

  if (role === "host") {
    if (sseClients.size === 0) return { ok: false, error: "Nessun ospite connesso" };
    for (const client of sseClients) client.write(`data: ${payload}\n\n`);
    return { ok: true };
  }

  // Guest: POST upstream. Fire and forget — a dropped telemetry frame is not worth
  // blocking the playback loop for.
  if (!guestBase || !guestPin) return { ok: false, error: "Sessione ospite non pronta" };
  void fetch(`${guestBase}/send?pin=${encodeURIComponent(guestPin)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  }).catch(() => {
    /* telemetry is best-effort */
  });
  return { ok: true };
}

/** Tear down whichever side is active. Safe to call when nothing is running. */
export async function stopParty(): Promise<void> {
  const wasActive = role !== null;
  role = null;

  for (const client of sseClients) {
    try {
      client.end();
    } catch {
      /* already gone */
    }
  }
  sseClients.clear();

  guestAbort?.abort();
  guestAbort = null;
  guestBase = "";
  guestPin = "";

  const active = server;
  server = null;
  hostPin = "";
  if (active) {
    await new Promise<void>((resolve) => {
      active.close(() => resolve());
      // Node 18.2+: drop keep-alive connections so close() actually completes.
      active.closeAllConnections?.();
    });
  }

  if (wasActive) emitStatus("idle");
}
