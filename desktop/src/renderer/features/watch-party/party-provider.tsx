import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { PartyMessage, PartyShow } from "@/shared/watch-party/protocol";
import type { Episode } from "@/shared/types";

import {
  useWatchPartySession,
  type PartyPlaybackSnapshot,
  type WatchPartyActions,
  type WatchPartySession,
} from "./use-watch-party";

/**
 * Adapter the watch page installs so the party can drive its player.
 *
 * The session lives above the routes (a party must survive navigating from `/party`
 * to a show), but only the watch page owns a `<video>`. This indirection is what
 * lets the two meet without the provider importing player internals.
 */
export type PartyPlayerAdapter = {
  /** Guest: apply a host command. */
  applyCommand: (msg: PartyMessage) => void;
  /** Host: current playback facts for the heartbeat. */
  getSnapshot: () => PartyPlaybackSnapshot;
};

type WatchPartyContextValue = {
  session: WatchPartySession;
  actions: WatchPartyActions;
  displayName: string;
  setDisplayName: (name: string) => void;
  /** Watch page calls this on mount and clears it on unmount. */
  attachPlayer: (adapter: PartyPlayerAdapter | null) => void;
};

const WatchPartyContext = createContext<WatchPartyContextValue | null>(null);

export function WatchPartyProvider({ children }: { children: React.ReactNode }) {
  const [displayName, setDisplayNameState] = useState("Ospite");
  const playerRef = useRef<PartyPlayerAdapter | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    void window.watchParty
      .getDisplayName()
      .then((name) => {
        if (!cancelled) setDisplayNameState(name);
      })
      .catch(() => {
        /* keep the default label */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setDisplayName = useCallback((name: string) => {
    // Optimistic: the name is cosmetic, and waiting on the store would make the
    // field feel laggy.
    setDisplayNameState(name);
    void window.watchParty.setDisplayName(name).then(setDisplayNameState);
  }, []);

  const onRemoteCommand = useCallback((msg: PartyMessage) => {
    playerRef.current?.applyCommand(msg);
  }, []);

  /**
   * Guest: follow the host to whatever it is watching.
   *
   * Handled here rather than in the player adapter because it is a routing concern
   * and must work from *any* page: a guest sitting on `/party` when the host starts
   * an episode has no watch page mounted, so no adapter is attached, and routing
   * the message through the player silently dropped it — the guest simply never
   * followed.
   *
   * Each side resolves its own stream for the announced identity: provider URLs are
   * short-lived and host-bound, and the two need not have the same provider enabled.
   */
  const locationRef = useRef<unknown>(location.state);
  locationRef.current = location.state;
  const onRemoteShow = useCallback(
    (show: PartyShow) => {
      const current = (locationRef.current as { episode?: Episode } | null)?.episode;
      // Already watching this episode? Re-navigating would restart the stream.
      if (
        current?.providerId === show.providerId &&
        current.index === show.episodeIndex &&
        current.mode === show.mode
      ) {
        return;
      }
      navigate("/watch", {
        state: {
          episode: {
            // Both ids carry the provider id: that is what the details lookup
            // takes, and an AniList id would be meaningless to the provider.
            id: show.providerId,
            providerId: show.providerId,
            title: { english: show.title },
            thumbnail: null,
            index: show.episodeIndex,
            mode: show.mode,
            showName: show.title,
          },
          providerOverride: show.provider,
        },
      });
    },
    [navigate]
  );

  const { session, actions } = useWatchPartySession({
    displayName,
    onRemoteCommand,
    onRemoteShow,
  });

  /*
   * The host's heartbeat reads playback facts through this indirection rather than
   * a value, so the interval never has to be torn down when the video seeks.
   */
  const { setPlaybackSource } = actions;
  useEffect(() => {
    setPlaybackSource(() =>
      playerRef.current?.getSnapshot() ?? { at: 0, playing: false, buffering: false }
    );
  }, [setPlaybackSource]);

  const attachPlayer = useCallback((adapter: PartyPlayerAdapter | null) => {
    playerRef.current = adapter;
  }, []);

  const value = useMemo<WatchPartyContextValue>(
    () => ({ session, actions, displayName, setDisplayName, attachPlayer }),
    [session, actions, displayName, setDisplayName, attachPlayer]
  );

  return <WatchPartyContext.Provider value={value}>{children}</WatchPartyContext.Provider>;
}

export function useWatchParty(): WatchPartyContextValue {
  const value = useContext(WatchPartyContext);
  if (!value) {
    throw new Error("useWatchParty must be used inside WatchPartyProvider");
  }
  return value;
}
