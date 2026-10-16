import Store from "electron-store";

import type { StreamProviderName } from "@/shared/stream-providers";

interface AppStoreSchema {
  "anilist.accessToken"?: string;
  /**
   * Automatically add announced or currently-airing sequels to the user's
   * AniList list as PLANNING. Off unless the user turns it on, because it
   * writes to their account.
   */
  "anilist.autoAddSequels"?: boolean;
  "privacy.incognito"?: boolean;
  /**
   * Name shown to the other side of a watch party. Persisted so it is not retyped
   * every session; defaults to a generic label rather than the OS account name,
   * which would leak the machine user name to the peer.
   */
  "party.displayName"?: string;
  /**
   * Derived from the provider registry rather than a hand-written union: this
   * list had already drifted (it was missing `animeunity`), and a stale member
   * list silently accepts or rejects the wrong names.
   */
  "stream.provider"?: StreamProviderName;
}

type StoreApi = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
};

export const appStore: StoreApi = new Store<AppStoreSchema>({
  name: "animeplus",
}) as unknown as StoreApi;
