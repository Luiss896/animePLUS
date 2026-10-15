import { useCallback, useEffect, useMemo, useState } from "react";
import type { HistoryEntry } from "@/shared/types";

const DISPLAY_UNIQUE_SHOW_LIMIT = 12;

export function useWelcomeRecentlyWatched() {
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [recentlyWatchedLoading, setRecentlyWatchedLoading] = useState(true);

  const recentlyWatched = useMemo(() => {
    const out: HistoryEntry[] = [];
    const seen = new Set<string>();
    for (let i = historyEntries.length - 1; i >= 0 && out.length < DISPLAY_UNIQUE_SHOW_LIMIT; i--) {
      const e = historyEntries[i];
      const showKey = e.episode.id || e.episode.providerId;
      if (seen.has(showKey)) continue;
      seen.add(showKey);
      out.push(e);
    }
    return out;
  }, [historyEntries]);

  useEffect(() => {
    let cancelled = false;
    setRecentlyWatchedLoading(true);
    window.recentlyWatched
      .read()
      .then((entries) => {
        if (!cancelled) setHistoryEntries(entries);
      })
      .finally(() => {
        if (!cancelled) setRecentlyWatchedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearRecentlyWatched = useCallback(async () => {
    await window.recentlyWatched.clear();
    setHistoryEntries([]);
  }, []);

  /**
   * Drop one show from Continue watching.
   *
   * The main-process handler returns nothing and does not report whether the id
   * matched, so the list is filtered optimistically — the same approach
   * `history-page.tsx` uses. Because `recentlyWatched` is derived with `useMemo`
   * over `historyEntries`, removing the newest entry for a show lets its
   * next-most-recent episode surface in the same slot, which is the desired
   * behaviour for a "remove from this row" action.
   */
  const removeRecentlyWatched = useCallback(async (id: string) => {
    await window.recentlyWatched.remove(id);
    setHistoryEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    recentlyWatched,
    recentlyWatchedLoading,
    clearRecentlyWatched,
    removeRecentlyWatched,
  };
}
