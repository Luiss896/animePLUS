import { useEffect, useMemo, useState } from "react";

import type { HistoryEntry } from "@/shared/types";

/**
 * Fraction of an episode that must be watched before it counts as seen.
 * Mirrors `COMPLETED_FRACTION` in `history-page.tsx` so the checkmark on an
 * episode and the "completed" badge in the history agree on what finished means.
 */
const COMPLETED_FRACTION = 0.9;

/**
 * Two ids can name the same show.
 *
 * Watch history stores the provider-native id (`episode.id`), while the show
 * details page is reached with whatever id the route carries — which may be the
 * AniList media id when the entry came from a list, and the provider slug when it
 * came from search. Comparing only one of them would silently mark nothing as
 * watched, so every known alias is stored for a show.
 */
function showAliasesOf(entry: HistoryEntry): string[] {
  const aliases = new Set<string>();
  const add = (value?: string | null) => {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) aliases.add(trimmed);
  };
  add(entry.episode.id);
  add(entry.episode.providerId);
  return [...aliases];
}

export type WatchedEpisodes = {
  /**
   * Watched episode numbers for one show, or `null` when this hook has nothing
   * to say about that show (history not loaded yet, or the show was never
   * watched). Callers must treat `null` as "unknown", not as "nothing watched",
   * so a failed read never paints a wrong "unwatched" grid.
   */
  watchedFor: (showIds: Array<string | null | undefined>) => Set<number> | null;
  /** Episode numbers watched for the *current* show, keyed by any of its ids. */
  loading: boolean;
};

/**
 * Which episodes of which shows have already been watched.
 *
 * Read once per mount from `watch-history.json` through the existing
 * `recentlyWatched` bridge — no new persisted state and no extra IPC round trip
 * per page. The file is small (one entry per episode ever opened) and the parse
 * is shared by every consumer of this hook instance.
 */
export function useWatchedEpisodes(): WatchedEpisodes {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.recentlyWatched
      .read()
      .then((all) => {
        if (!cancelled) setEntries(all);
      })
      .catch(() => {
        // Leave `entries` null: consumers then report "unknown" instead of
        // claiming every episode is unwatched.
        if (!cancelled) setEntries(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Alias id -> watched episode numbers.
   *
   * One entry can register several aliases, and an episode is watched if *any*
   * history record for that alias reached the completion fraction. Episodes
   * merely started (below the fraction) are deliberately not marked: the point of
   * the indicator is "which ones are still missing", and an episode abandoned at
   * 5% is still missing.
   */
  const byAlias = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!entries) return map;
    for (const entry of entries) {
      if (!isCompleted(entry)) continue;
      const index = entry.episode.index;
      if (!Number.isFinite(index)) continue;
      for (const alias of showAliasesOf(entry)) {
        let set = map.get(alias);
        if (!set) {
          set = new Set<number>();
          map.set(alias, set);
        }
        set.add(index);
      }
    }
    return map;
  }, [entries]);

  const watchedFor = useMemo(() => {
    return (showIds: Array<string | null | undefined>): Set<number> | null => {
      // `entries === null` means the read has not settled; reporting a set here
      // would render an authoritative-looking "nothing watched" before load.
      if (entries === null) return null;
      const merged = new Set<number>();
      let matched = false;
      for (const raw of showIds) {
        const key = typeof raw === "string" ? raw.trim() : "";
        if (!key) continue;
        const found = byAlias.get(key);
        if (!found) continue;
        matched = true;
        for (const index of found) merged.add(index);
      }
      // Not knowing a show is different from knowing it has nothing watched.
      return matched ? merged : null;
    };
  }, [entries, byAlias]);

  return { watchedFor, loading: entries === null };
}

/**
 * Has this history record been watched to the end?
 *
 * `totalDurationMs` is 0 until playback reports a duration, and a record with no
 * known duration cannot be judged finished — treating 0/0 as complete would mark
 * every freshly-opened episode as watched.
 */
export function isCompleted(entry: HistoryEntry): boolean {
  const total = entry.totalDurationMs;
  const current = entry.currentDurationMs;
  if (!Number.isFinite(total) || !Number.isFinite(current)) return false;
  if (total <= 0) return false;
  return current >= total * COMPLETED_FRACTION;
}

/**
 * Show ids as the details/watch pages refer to them, for `watchedFor`.
 *
 * Route ids, provider ids and AniList ids are different namespaces (see
 * `resolveAniListMediaId`), so every id known to the caller is offered and any
 * one of them may match the alias recorded in history.
 */
export function showIdCandidates(...ids: Array<string | number | null | undefined>): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (id == null) continue;
    const text = String(id).trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}
