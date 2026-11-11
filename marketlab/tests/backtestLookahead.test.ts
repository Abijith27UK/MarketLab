import { describe, expect, it } from "vitest";
import { runBacktest } from "../convex/backtestCore/engine";
import type { Candle } from "../convex/backtestCore/types";

function makeCandle(ts: number, o: number, h: number, l: number, c: number): Candle {
  return { ts, open: o, high: h, low: l, close: c, volume: 1000 };
}

describe("backtest look-ahead prevention", () => {
  it("does not use future candles to form decisions at earlier bars", () => {
    const base: Candle[] = [
      makeCandle(1, 100, 101, 99, 100),
      makeCandle(2, 100, 101, 99, 100),
      makeCandle(3, 100, 101, 99, 100),
      makeCandle(4, 100, 101, 99, 100),
      makeCandle(5, 100, 105, 99, 104),
    ];
    const prefixA = base.slice();
    const suffixA: Candle[] = [makeCandle(6, 104, 110, 103, 109)];
    const suffixB: Candle[] = [makeCandle(6, 104, 110, 50, 60)];
    const padding: Candle[] = [];
    for (let i = 0; i < 50; i++) padding.push(makeCandle(100 + i, 90, 91, 89, 90));

    const config = {
      instrumentId: "NSE:TEST:EQUITY",
      interval: "1d" as const,
      fromMs: 1,
      toMs: 1000,
      initialCapital: 100000,
      datasetMode: "SAMPLE" as const,
      sizing: { kind: "PERCENT_OF_EQUITY" as const, quantity: null, percentOfEquity: 100, maxPositionValuePct: 100 },
      entry: {
        combinator: "AND" as const,
        conditions: [{ type: "PRICE_CROSS_ABOVE_MA" as const, maKind: "SMA" as const, period: 3, fast: null, slow: null, signal: null, threshold: null }],
      },
      exit: {
        combinator: "AND" as const,
        conditions: [{ type: "PRICE_CROSS_BELOW_MA" as const, maKind: "SMA" as const, period: 3, fast: null, slow: null, signal: null, threshold: null }],
      },
      stopLossPct: null,
      takeProfitPct: null,
      costs: { brokerageFlat: 0, brokeragePct: 0, slippageBps: 0 },
    };

    const candlesA = prefixA.concat(suffixA).concat(padding);
    const candlesB = prefixA.concat(suffixB).concat(padding);
    const dataset = { kind: "sample" as const, source: "sample", mode: "SAMPLE" as const, datasetId: null, hash: "a", rowCount: candlesA.length, firstTs: 1, lastTs: candlesA[candlesA.length-1].ts, gaps: 0, label: "SAMPLE" };
    const datasetB = { ...dataset, hash: "b", rowCount: candlesB.length };

    const resA = runBacktest({ candles: candlesA, config, dataset });
    const resB = runBacktest({ candles: candlesB, config, dataset: datasetB });

    expect(resA.trades.length).toBe(resB.trades.length);
    if (resA.trades.length > 0) {
      expect(resA.trades[0].entryTs).toBe(resB.trades[0].entryTs);
      expect(resA.trades[0].entryPrice).toBe(resB.trades[0].entryPrice);
      expect(resA.trades[0].quantity).toBe(resB.trades[0].quantity);
    }
  });
});
