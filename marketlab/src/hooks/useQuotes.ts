import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { marketApi, type QuotesResult } from "@/lib/marketClient";

interface UseQuotesOptions {
  /** Poll interval in ms. Set to 0 to disable automatic refresh. */
  pollMs?: number;
  enabled?: boolean;
}

interface UseQuotesState {
  data: QuotesResult | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Batches every visible instrument into ONE server action call, so a page of 20
 * rows does not become 20 provider requests. The server applies its own cache
 * and rate limits; polling here is only a nudge.
 */
export function useQuotes(
  instrumentIds: string[],
  { pollMs = 60_000, enabled = true }: UseQuotesOptions = {}
): UseQuotesState {
  const getQuotes = useAction(marketApi.getQuotes);
  const [data, setData] = useState<QuotesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const key = [...instrumentIds].sort().join(",");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (force: boolean) => {
      const ids = key ? key.split(",") : [];
      if (!enabled || ids.length === 0) return;
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const result = await getQuotes({ instrumentIds: ids, forceRefresh: force });
        if (!mounted.current) return;
        setData(result);
        setError(null);
      } catch (err) {
        if (!mounted.current) return;
        setError(err instanceof Error ? err.message : "Could not load quotes");
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [enabled, getQuotes, key]
  );

  useEffect(() => {
    void load(false);
    if (!pollMs) return;
    const timer = setInterval(() => void load(false), pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  return { data, loading, refreshing, error, refresh: () => load(true) };
}
