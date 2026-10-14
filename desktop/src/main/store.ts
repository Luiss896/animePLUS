import Store from "electron-store";

interface AppStoreSchema {
  "anilist.accessToken"?: string;
  /**
   * Automatically add announced or currently-airing sequels to the user's
   * AniList list as PLANNING. Off unless the user turns it on, because it
   * writes to their account.
   */
  "anilist.autoAddSequels"?: boolean;
  "privacy.incognito"?: boolean;
  "stream.provider"?:
    | "hianime"
    | "allanime"
    | "anidb"
    | "animepahe"
    | "animeparadise"
    | "reanime"
    | "senshi";
}

type StoreApi = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
};

export const appStore: StoreApi = new Store<AppStoreSchema>({
  name: "animeplus",
}) as unknown as StoreApi;
