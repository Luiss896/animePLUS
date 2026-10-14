import { useCallback, useEffect, useState } from "react";

import type { UpcomingSeasonsResult } from "@/shared/upcoming-seasons-types";

interface UseUpcomingSeasonsResult {
  result: UpcomingSeasonsResult | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Loads upcoming seasons for the connected AniList user.
 *
 * The main process owns caching (30 min) and rate-limit handling, so this hook
 * only tracks loading state and exposes an explicit refresh that bypasses the
 * cache. `cancelled` guards against a late response overwriting a newer one.
 */
export function useUpcomingSeasons(): UseUpcomingSeasonsResult {
  const [result, setResult] = useState<UpcomingSeasonsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void window.anilist
      // A refresh (token > 0) bypasses the main-process cache.
      .getUpcomingSeasons(reloadToken > 0)
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load upcoming seasons",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return { result, loading, refresh };
}
