import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { marketApi, type MarketMoversResult } from "@/lib/marketClient";

interface UseMarketMoversState {
  data: MarketMoversResult | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Loads the official NSE market-mover ranking once and on explicit retry.
 *
 * There is no polling loop: NSE crawls the ranking every few minutes and the
 * server caches it, so a manual refresh is enough and spends no extra quota.
 */
export function useMarketMovers(): UseMarketMoversState {
  const getMovers = useAction(marketApi.getMarketMovers);
  const [data, setData] = useState<MarketMoversResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      try {
        const result = await getMovers(refresh ? { refresh: true } : {});
        if (!mounted.current) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!mounted.current) return;
        setError(err instanceof Error ? err.message : "Could not load NSE market movers");
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [getMovers]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return { data, loading, error, refresh: () => void load(true) };
}
