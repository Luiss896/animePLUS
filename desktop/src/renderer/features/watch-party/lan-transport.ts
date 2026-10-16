import type { PartyMessage } from "@/shared/watch-party/protocol";

import type {
  PartyHostInfo,
  PartyTransport,
  PartyTransportHandlers,
} from "./transport";

/**
 * LAN transport, backed by the main process.
 *
 * The renderer does not open the socket itself: it is served from `file://`, so
 * its origin is `null` and any request to `http://192.168.x.x` is cross-origin and
 * would be refused by `EventSource`. Main does the networking and these functions
 * are a thin IPC shim.
 *
 * `window.watchParty` keeps a single handler slot, so installing handlers here
 * replaces any previous ones. Only one session can be active at a time, which is
 * exactly the assumption this module relies on.
 */

async function send(message: PartyMessage): Promise<{ ok: boolean; error?: string }> {
  return window.watchParty.send(message);
}

export async function createLanHost(
  handlers: PartyTransportHandlers,
  displayName: string
): Promise<{ info: PartyHostInfo; transport: PartyTransport }> {
  window.watchParty.onMessage(handlers.onMessage);
  window.watchParty.onStatus(handlers.onStatus);

  const info = await window.watchParty.startHost(displayName);
  return { info, transport: { kind: "lan", send, close: closeLan } };
}

export async function createLanGuest(
  handlers: PartyTransportHandlers,
  address: string,
  pin: string
): Promise<PartyTransport> {
  window.watchParty.onMessage(handlers.onMessage);
  window.watchParty.onStatus(handlers.onStatus);

  const result = await window.watchParty.join(address, pin);
  // Discriminate on the success case rather than `!result.ok`: narrowing on the
  // union works from either side, and this reads as "keep going only when joined".
  if (result.ok === true) {
    return { kind: "lan", send, close: closeLan };
  }
  window.watchParty.clearHandlers();
  throw new Error(result.error);
}

async function closeLan(): Promise<void> {
  await window.watchParty.stop();
  window.watchParty.clearHandlers();
}
