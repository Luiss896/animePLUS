import { contextBridge, ipcRenderer } from "electron";

import type { PartyMessage } from "@/shared/watch-party/protocol";

import type { PartyStatusEvent } from "./lan-session";
import {
  WATCH_PARTY_GET_DISPLAY_NAME_CHANNEL,
  WATCH_PARTY_JOIN_CHANNEL,
  WATCH_PARTY_LIST_ADDRESSES_CHANNEL,
  WATCH_PARTY_MESSAGE_EVENT,
  WATCH_PARTY_SEND_CHANNEL,
  WATCH_PARTY_SET_DISPLAY_NAME_CHANNEL,
  WATCH_PARTY_START_HOST_CHANNEL,
  WATCH_PARTY_STATUS_EVENT,
  WATCH_PARTY_STOP_CHANNEL,
  WATCH_PARTY_STOP_WARM_CHANNEL,
  WATCH_PARTY_WARM_INBOUND_CHANNEL,
} from "./watch-party-channels";

/**
 * Single-slot handler, set from the renderer.
 *
 * The obvious alternative — returning an unsubscribe function from `onMessage` —
 * would rely on `contextBridge` proxying a function back across the bridge and on
 * the renderer's closure identity surviving it. A plain slot avoids both
 * questions: the preload owns the listener and forwards to whatever the renderer
 * most recently registered.
 */
let messageHandler: ((msg: PartyMessage) => void) | null = null;
let statusHandler: ((status: PartyStatusEvent) => void) | null = null;

export function exposeWatchPartyContext() {
  ipcRenderer.on(WATCH_PARTY_MESSAGE_EVENT, (_event, msg: PartyMessage) => {
    messageHandler?.(msg);
  });
  ipcRenderer.on(WATCH_PARTY_STATUS_EVENT, (_event, status: PartyStatusEvent) => {
    statusHandler?.(status);
  });

  contextBridge.exposeInMainWorld("watchParty", {
    /** Host side: start listening. Returns the PIN and the addresses to share. */
    startHost: (hostName?: string) =>
      ipcRenderer.invoke(WATCH_PARTY_START_HOST_CHANNEL, hostName) as Promise<{
        port: number;
        pin: string;
        addresses: string[];
      }>,

    /** Guest side: dial a host. Resolves once the event stream is established. */
    join: (address: string, pin: string) =>
      ipcRenderer.invoke(WATCH_PARTY_JOIN_CHANNEL, address, pin) as Promise<
        { ok: true } | { ok: false; error: string }
      >,

    send: (message: unknown) =>
      ipcRenderer.invoke(WATCH_PARTY_SEND_CHANNEL, message) as Promise<{
        ok: boolean;
        error?: string;
      }>,

    stop: () => ipcRenderer.invoke(WATCH_PARTY_STOP_CHANNEL) as Promise<void>,

    listAddresses: () =>
      ipcRenderer.invoke(WATCH_PARTY_LIST_ADDRESSES_CHANNEL) as Promise<
        Array<{ address: string; iface: string; isPrivate: boolean }>
      >,

    getDisplayName: () =>
      ipcRenderer.invoke(WATCH_PARTY_GET_DISPLAY_NAME_CHANNEL) as Promise<string>,
    setDisplayName: (name: string) =>
      ipcRenderer.invoke(WATCH_PARTY_SET_DISPLAY_NAME_CHANNEL, name) as Promise<string>,

    /**
     * Open a listening socket while an internet party is active.
     *
     * Peer-to-peer needs inbound UDP, and Windows Firewall only offers the prompt
     * that allows it for a process that is listening. Returns the port, or null if
     * the socket could not be opened — never fatal, the party still tries.
     */
    warmInbound: () =>
      ipcRenderer.invoke(WATCH_PARTY_WARM_INBOUND_CHANNEL) as Promise<number | null>,
    stopWarmInbound: () => ipcRenderer.invoke(WATCH_PARTY_STOP_WARM_CHANNEL) as Promise<void>,

    onMessage: (cb: (msg: PartyMessage) => void) => {
      messageHandler = cb;
    },
    onStatus: (cb: (status: PartyStatusEvent) => void) => {
      statusHandler = cb;
    },
    clearHandlers: () => {
      messageHandler = null;
      statusHandler = null;
    },
  });
}
