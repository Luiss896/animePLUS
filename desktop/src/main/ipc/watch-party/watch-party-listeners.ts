import { BrowserWindow, ipcMain } from "electron";

import type { PartyMessage } from "@/shared/watch-party/protocol";

import { listLanAddresses } from "./lan-address";
import {
  joinParty,
  sendPartyMessage,
  setPartySink,
  startPartyHost,
  stopParty,
  type PartyHostInfo,
  type PartyStatusEvent,
} from "./lan-session";
import {
  WATCH_PARTY_GET_DISPLAY_NAME_CHANNEL,
  WATCH_PARTY_JOIN_CHANNEL,
  WATCH_PARTY_LIST_ADDRESSES_CHANNEL,
  WATCH_PARTY_MESSAGE_EVENT,
  WATCH_PARTY_SEND_CHANNEL,
  WATCH_PARTY_SET_DISPLAY_NAME_CHANNEL,
  WATCH_PARTY_START_HOST_CHANNEL,
  WATCH_PARTY_STATE_CHANNEL,
  WATCH_PARTY_STATUS_EVENT,
  WATCH_PARTY_STOP_CHANNEL,
} from "./watch-party-channels";
import { getPartyDisplayName, setPartyDisplayName } from "./watch-party-store";

/** Push an event to every renderer. The app previously had no main -> renderer path. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}

export function addWatchPartyListeners(): void {
  /*
   * The session module is transport-only and knows nothing about Electron, so it
   * reports through this sink. Wired once at startup.
   */
  setPartySink({
    onMessage: (msg: PartyMessage) => broadcast(WATCH_PARTY_MESSAGE_EVENT, msg),
    onStatus: (status: PartyStatusEvent) => broadcast(WATCH_PARTY_STATUS_EVENT, status),
  });

  ipcMain.handle(
    WATCH_PARTY_START_HOST_CHANNEL,
    async (_event, hostName?: string): Promise<PartyHostInfo> => {
      return startPartyHost(hostName ?? getPartyDisplayName());
    }
  );

  ipcMain.handle(
    WATCH_PARTY_JOIN_CHANNEL,
    async (_event, address: string, pin: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        await joinParty(address, pin);
        return { ok: true };
      } catch (error: unknown) {
        return { ok: false, error: error instanceof Error ? error.message : "Connessione fallita" };
      }
    }
  );

  ipcMain.handle(WATCH_PARTY_SEND_CHANNEL, (_event, message: unknown) => sendPartyMessage(message));

  ipcMain.handle(WATCH_PARTY_STOP_CHANNEL, async () => {
    await stopParty();
  });

  ipcMain.handle(WATCH_PARTY_LIST_ADDRESSES_CHANNEL, () => listLanAddresses());

  ipcMain.handle(WATCH_PARTY_GET_DISPLAY_NAME_CHANNEL, () => getPartyDisplayName());
  ipcMain.handle(WATCH_PARTY_SET_DISPLAY_NAME_CHANNEL, (_event, name: string) =>
    setPartyDisplayName(name)
  );

  // `state` is intentionally the same as `stop`: the renderer uses it to ask for a
  // clean teardown when leaving the party page.
  ipcMain.handle(WATCH_PARTY_STATE_CHANNEL, async () => {
    await stopParty();
  });
}

/** Release the listening socket when the app quits. */
export function stopWatchPartyOnQuit(): void {
  void stopParty();
}
