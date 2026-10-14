import { useCallback, useEffect, useState } from "react";

import type { AutoAddResult, UpcomingSeasonsResult } from "@/shared/upcoming-seasons-types";

interface UseUpcomingSeasonsResult {
  result: UpcomingSeasonsResult | null;
  loading: boolean;
  refresh: () => void;
  /** Outcome of the auto-add pass, when the feature is enabled. */
  autoAdd: AutoAddResult | null;
}

/**
 * Loads upcoming seasons for the connected AniList user.
 *
 * The main process owns caching (30 min) and rate-limit handling, so this hook
 * only tracks loading state and exposes an explicit refresh that bypasses the
 * cache. `cancelled` guards against a late response overwriting a newer one.
 *
 * When automatic sequel tracking is enabled, an auto-add pass runs first so the
 * list — and therefore this page — includes sequels that were just announced.
 * That pass is best-effort: a failure there must not blank the page, so its
 * result is reported separately and the fetch proceeds regardless.
 */
export function useUpcomingSeasons(): UseUpcomingSeasonsResult {
  const [result, setResult] = useState<UpcomingSeasonsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoAdd, setAutoAdd] = useState<AutoAddResult | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const run = async () => {
      // Best-effort: never let a failure here break the page.
      let addedSomething = false;
      try {
        const auto = await window.anilist.runAutoAddSequels();
        if (!cancelled && auto.enabled) setAutoAdd(auto);
        // If the pass changed the list, the cached seasons are stale: they were
        // computed before the new entries existed, so the page would otherwise
        // report "added N seasons" while still rendering the old, shorter list.
        addedSomething = auto.enabled && auto.added.length > 0;
      } catch {
        /* auto-add is optional; ignore and continue */
      }

      try {
        // Bypass the cache on an explicit refresh, and whenever the auto-add
        // pass just modified the list.
        const force = reloadToken > 0 || addedSomething;
        const value = await window.anilist.getUpcomingSeasons(force);
        if (!cancelled) setResult(value);
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load upcoming seasons",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { result, loading, refresh, autoAdd };
}
