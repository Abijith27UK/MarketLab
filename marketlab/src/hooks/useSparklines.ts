import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { marketApi, type DataMode } from "@/lib/marketClient";

export interface SparklineSeries {
  closes: number[];
  mode: DataMode;
}

/**
 * Loads daily closes for card sparklines — at most `max` instruments per page,
 * one server action each (the action caches), never a per-render retry storm.
 *
 * Each series keeps the server's freshness label so the UI can refuse to draw a
 * SAMPLE sparkline next to a genuine LIVE quote (and vice versa).
 */
export function useSparklines(
  instrumentIds: string[],
  { enabled = true, max = 12 }: { enabled?: boolean; max?: number } = {}
): Record<string, SparklineSeries> {
  const getCandles = useAction(marketApi.getCandles);
  const [series, setSeries] = useState<Record<string, SparklineSeries>>({});
  const requested = useRef<Set<string>>(new Set());
  const key = instrumentIds.join(",");

  useEffect(() => {
    if (!enabled) return;
    const ids = instrumentIds.filter(Boolean);
    const missing = ids.filter((id) => !requested.current.has(id)).slice(0, Math.max(0, max));
    if (missing.length === 0) return;

    let cancelled = false;
    for (const id of missing) requested.current.add(id);

    void (async () => {
      const loaded: Record<string, SparklineSeries> = {};
      for (const id of missing) {
        try {
          const result = await getCandles({
            instrumentId: id,
            interval: "1d",
            fromMs: Date.now() - 120 * 24 * 60 * 60 * 1000,
          });
          loaded[id] = {
            closes: result.candles.slice(-30).map((candle) => candle.close),
            mode: result.mode,
          };
        } catch {
          // A missing sparkline is fine — the card simply omits it.
          loaded[id] = { closes: [], mode: "SAMPLE" };
        }
      }
      if (!cancelled) setSeries((previous) => ({ ...previous, ...loaded }));
    })();

    return () => {
      cancelled = true;
    };
    // `key` covers instrumentIds identity without re-running on array re-creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, getCandles, key, max]);

  return series;
}
