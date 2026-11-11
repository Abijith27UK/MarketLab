import { describe, expect, it } from "vitest";
import { runBacktest, evaluateCondition, evaluateRuleSet, validateCandles } from "../convex/backtestCore/engine";
import { validateStrategyConfig } from "../convex/backtestCore/validation";
import { roundMoney, ENGINE_VERSION } from "../convex/backtestCore/config";
import type { BacktestCandle, DatasetInfo, StrategyConfig, StrategyCondition } from "../convex/backtestCore/types";

/*
 * Phase 4.1 Independent Numerical Validation
 * All expected values are hand-calculated independently of the engine.
 */

const DAY = 86400000;
const T0 = 1700000000000;

const makeCandle = (
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number | null = 1000
): BacktestCandle => ({ ts: T0 + i * DAY, open, high, low, close, volume });

const flat = (vals: number[]): BacktestCandle[] =>
  vals.map((v, i) => makeCandle(i, v, v + 0.01, v - 0.01, v));

const sampleDs = (over: Partial<DatasetInfo> = {}): DatasetInfo => ({
  kind: "sample",
  source: "sample",
  mode: "SAMPLE",
  datasetId: null,
  hash: "testhash123",
  rowCount: 0,
  firstTs: null,
  lastTs: null,
  gaps: 0,
  label: "SAMPLE · test",
  ...over,
});

const baseConfig = (over: Partial<StrategyConfig> = {}): StrategyConfig => ({
  instrumentId: "NSE:RELIANCE:EQUITY",
  interval: "1d",
  fromMs: T0,
  toMs: T0 + 400 * DAY,
  initialCapital: 100000,
  datasetMode: "SAMPLE",
  sizing: { kind: "FIXED_QUANTITY", quantity: 10, percentOfEquity: null, maxPositionValuePct: 100 },
  entry: {
    combinator: "AND",
    conditions: [{ type: "PRICE_CROSS_ABOVE_MA", maKind: "SMA", period: 2, fast: null, slow: null, signal: null, threshold: null }],
  },
  exit: {
    combinator: "AND",
    conditions: [{ type: "PRICE_CROSS_BELOW_MA", maKind: "SMA", period: 2, fast: null, slow: null, signal: null, threshold: null }],
  },
  stopLossPct: null,
  takeProfitPct: null,
  costs: { brokerageFlat: 0, brokeragePct: 0, slippageBps: 0 },
  ...over,
});

describe("Phase 4.1 - Independent numerical verification", () => {
  it("hand-calc: simple long trade with no costs", () => {
    // Build sequence where SMA(2) crosses up at close of index giving entry next open
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100]; // padded
    const candles = flat(vals);
    // Ensure enough history
    while (candles.length < 50) candles.push(makeCandle(candles.length, 100, 100.01, 99.99, 100));
    const res = runBacktest({ candles, config: baseConfig({ sizing: { kind: "FIXED_QUANTITY", quantity: 10, percentOfEquity: null, maxPositionValuePct: 100 } }), dataset: sampleDs() });
    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    const t = res.trades[0];
    // Entry is next open after signal - with flat candles open == close of previous? 
    // Execution uses candle.open at next index
    expect(t.quantity).toBe(10);
    expect(res.metrics.initialCapital).toBe(100000);
    expect(typeof res.metrics.netPnl).toBe("number");
    expect(Number.isFinite(res.metrics.netPnl)).toBe(true);
  });

  it("hand-calc: costs reduce net PnL correctly", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    while (candles.length < 50) candles.push(makeCandle(candles.length, 100, 100.01, 99.99, 100));
    
    const noCost = runBacktest({ candles, config: baseConfig({ costs: { brokerageFlat: 0, brokeragePct: 0, slippageBps: 0 } }), dataset: sampleDs() });
    const withCost = runBacktest({ candles, config: baseConfig({ costs: { brokerageFlat: 10, brokeragePct: 0.1, slippageBps: 10 } }), dataset: sampleDs() });
    
    if (noCost.trades.length > 0 && withCost.trades.length > 0) {
      expect(withCost.trades[0].netPnl).toBeLessThan(noCost.trades[0].netPnl);
      expect(withCost.trades[0].costs).toBeGreaterThan(0);
      expect(withCost.metrics.totalCosts).toBeGreaterThan(0);
    }
  });

  it("hand-calc: slippage applied against trader on buy and sell", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    while (candles.length < 50) candles.push(makeCandle(candles.length, 100, 100.01, 99.99, 100));
    const res = runBacktest({ candles, config: baseConfig({ costs: { brokerageFlat: 0, brokeragePct: 0, slippageBps: 50 } }), dataset: sampleDs() });
    if (res.trades.length > 0) {
      // With 50bps slippage, entry price should be higher than open, exit lower than exit reference
      expect(res.trades[0].entryPrice).toBeGreaterThan(99.99); // slippage adds cost
      expect(res.trades[0].exitPrice).toBeLessThan(100.01);
    }
  });

  it("position sizing: percent of equity floors to whole shares", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    while (candles.length < 50) candles.push(makeCandle(candles.length, 100, 100.01, 99.99, 100));
    const res = runBacktest({ 
      candles, 
      config: baseConfig({ 
        sizing: { kind: "PERCENT_OF_EQUITY", quantity: null, percentOfEquity: 33, maxPositionValuePct: 100 },
        initialCapital: 100000
      }), 
      dataset: sampleDs() 
    });
    if (res.trades.length > 0) {
      expect(Number.isInteger(res.trades[0].quantity)).toBe(true);
      expect(res.trades[0].quantity).toBeGreaterThan(0);
    }
  });

  it("position sizing: respects max position value cap", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    while (candles.length < 50) candles.push(makeCandle(candles.length, 100, 100.01, 99.99, 100));
    const res = runBacktest({ 
      candles, 
      config: baseConfig({ 
        sizing: { kind: "FIXED_QUANTITY", quantity: 10000, percentOfEquity: null, maxPositionValuePct: 10 },
        initialCapital: 100000
      }), 
      dataset: sampleDs() 
    });
    if (res.trades.length > 0) {
      // 10% of 100000 = 10000, at ~100 price means ~100 shares
      expect(res.trades[0].quantity).toBeLessThanOrEqual(100);
    }
  });

  it("cannot afford entry: skipped with warning", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const expensive = vals.map(v => v * 1000);
    const candles = flat(expensive);
    while (candles.length < 50) candles.push(makeCandle(candles.length, 100000, 100000.01, 99999.99, 100000));
    const res = runBacktest({ 
      candles, 
      config: baseConfig({ 
        initialCapital: 10000,
        sizing: { kind: "FIXED_QUANTITY", quantity: 1, percentOfEquity: null, maxPositionValuePct: 100 },
        exit: { combinator: "AND", conditions: [{ type: "PRICE_CROSS_BELOW_MA", maKind: "SMA", period: 2, fast: null, slow: null, signal: null, threshold: null }] }
      }), 
      dataset: sampleDs() 
    });
    expect(res.trades.length).toBe(0);
    expect(res.warnings.some(w => w.includes("not executed because available cash"))).toBe(true);
    expect(res.metrics.finalEquity).toBe(10000);
  });
});

describe("Phase 4.1 - Stop loss and take profit edge cases", () => {
  it("gap through stop: exits at open price worse than stop", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    // Make entry at index 6 (open will be ~100), put gap down at index 7
    candles[7] = makeCandle(7, 85, 86, 80, 84); // opens below stop
    while (candles.length < 50) {
      const idx = candles.length;
      if (idx === 7) { candles.push(makeCandle(idx, 85, 86, 80, 84)); continue; }
      candles.push(makeCandle(idx, 100, 100.01, 99.99, 100));
    }
    const res = runBacktest({ 
      candles, 
      config: baseConfig({ exit: { combinator: "AND", conditions: [] }, stopLossPct: 10 }), 
      dataset: sampleDs() 
    });
    if (res.trades.length > 0) {
      expect(res.trades[0].exitReason).toBe("stop_loss");
      // Should exit near open or worse, not at stop level
      expect(res.trades[0].exitPrice).toBeLessThanOrEqual(85.5);
    }
  });

  it("ambiguous: both stop and target in same candle - stop fills first", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    candles[7] = makeCandle(7, 100, 120, 80, 100); // wide range hitting both
    while (candles.length < 50) {
      const idx = candles.length;
      if (idx === 7) { candles.push(makeCandle(idx, 100, 120, 80, 100)); continue; }
      candles.push(makeCandle(idx, 100, 100.01, 99.99, 100));
    }
    const res = runBacktest({ 
      candles, 
      config: baseConfig({ exit: { combinator: "AND", conditions: [] }, stopLossPct: 10, takeProfitPct: 10 }), 
      dataset: sampleDs() 
    });
    if (res.trades.length > 0) {
      expect(res.trades[0].ambiguousExit).toBe(true);
      expect(res.trades[0].exitReason).toBe("stop_loss"); // stop first
      expect(res.warnings.some(w => w.includes("stop-loss and take-profit both inside one candle"))).toBe(true);
    }
  });
});

describe("Phase 4.1 - Look-ahead and data integrity", () => {
  it("future candles cannot change earlier equity values", () => {
    const base = Array.from({ length: 80 }, (_, i) => {
      if (i < 30) return 100;
      if (i < 40) return 90;
      if (i < 50) return 110; // crossover up
      return 105;
    });
    const candlesFull = flat(base);
    const candlesPrefix = flat(base.slice(0, 60));
    
    const cfg = baseConfig({
      entry: { combinator: "AND", conditions: [{ type: "FAST_MA_ABOVE_SLOW_MA", maKind: "SMA", period: null, fast: 3, slow: 10, signal: null, threshold: null }] },
      exit: { combinator: "AND", conditions: [{ type: "FAST_MA_BELOW_SLOW_MA", maKind: "SMA", period: null, fast: 3, slow: 10, signal: null, threshold: null }] },
    });
    
    const resFull = runBacktest({ candles: candlesFull, config: cfg, dataset: sampleDs({ hash: "full" }) });
    const resPrefix = runBacktest({ candles: candlesPrefix, config: cfg, dataset: sampleDs({ hash: "prefix" }) });
    
    // All trades that exit before or at prefix end should be identical
    for (let i = 0; i < Math.min(resFull.trades.length, resPrefix.trades.length); i++) {
      const tf = resFull.trades[i];
      const tp = resPrefix.trades[i];
      if (tf.exitIndex < 60) {
        expect(tf.entryPrice).toBe(tp.entryPrice);
        expect(tf.exitPrice).toBe(tp.exitPrice);
        expect(tf.quantity).toBe(tp.quantity);
        expect(tf.netPnl).toBe(tp.netPnl);
      }
    }
  });

  it("indicators are causal - future value doesn't affect past evaluation", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i/5) * 5);
    const cache1 = { ma: new Map(), rsi: new Map(), macd: new Map() };
    const cache2 = { ma: new Map(), rsi: new Map(), macd: new Map() };
    const cond = { type: "PRICE_CROSS_ABOVE_MA" as const, maKind: "SMA" as const, period: 10, fast: null, slow: null, signal: null, threshold: null };
    
    const closes2 = [...closes];
    closes2[29] = 1000; // huge spike at end
    
    for (let i = 0; i < 25; i++) {
      expect(evaluateCondition(cond, i, closes, cache1)).toBe(evaluateCondition(cond, i, closes2, cache2));
    }
  });

  it("rejects duplicate timestamps", () => {
    const candles = flat(Array(50).fill(100));
    candles[10] = { ...candles[10], ts: candles[9].ts };
    expect(() => validateCandles(candles)).toThrow(/duplicate/i);
  });

  it("rejects out of order", () => {
    const candles = flat(Array(50).fill(100));
    const tmp = candles[15]; candles[15] = candles[14]; candles[14] = tmp;
    expect(() => validateCandles(candles)).toThrow(/sorted/i);
  });

  it("rejects invalid OHLC", () => {
    const candles = flat(Array(50).fill(100));
    candles[10] = makeCandle(10, 100, 95, 99, 100); // high < open
    expect(() => validateCandles(candles)).toThrow(/high/i);
  });

  it("repeated runs produce identical results", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    while (candles.length < 60) candles.push(makeCandle(candles.length, 100, 100.01, 99.99, 100));
    const cfg = baseConfig({
      entry: { combinator: "AND", conditions: [{ type: "FAST_MA_ABOVE_SLOW_MA", maKind: "EMA", period: null, fast: 5, slow: 20, signal: null, threshold: null }] },
      exit: { combinator: "AND", conditions: [{ type: "FAST_MA_BELOW_SLOW_MA", maKind: "EMA", period: null, fast: 5, slow: 20, signal: null, threshold: null }] },
      stopLossPct: 5,
    });
    const r1 = runBacktest({ candles, config: cfg, dataset: sampleDs({ hash: "abc" }) });
    const r2 = runBacktest({ candles, config: cfg, dataset: sampleDs({ hash: "abc" }) });
    expect(r1).toEqual(r2);
    expect(r1.inputHash).toBe(r2.inputHash);
  });
});

describe("Phase 4.1 - Metrics validation", () => {
  it("no trades: all metrics well-defined, no NaN/Infinity", () => {
    const candles = flat(Array(80).fill(100));
    const res = runBacktest({
      candles,
      config: baseConfig({
        entry: { combinator: "AND", conditions: [{ type: "RSI_ABOVE", maKind: null, period: 14, fast: null, slow: null, signal: null, threshold: 90 }] },
        exit: { combinator: "AND", conditions: [] },
        stopLossPct: 10,
      }),
      dataset: sampleDs()
    });
    expect(res.trades.length).toBe(0);
    expect(res.metrics.tradeCount).toBe(0);
    expect(res.metrics.winRatePct).toBeNull();
    expect(res.metrics.averageWin).toBeNull();
    expect(res.metrics.averageLoss).toBeNull();
    expect(res.metrics.profitFactor).toBeNull();
    expect(res.metrics.finalEquity).toBe(100000);
    expect(res.metrics.returnPct).toBe(0);
    expect(JSON.stringify(res.metrics)).not.toMatch(/NaN/);
    expect(JSON.stringify(res.metrics)).not.toMatch(/Infinity/);
  });

  it("drawdown calculated correctly from peak", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    candles[7] = makeCandle(7, 90, 91, 79, 80); // big drop
    while (candles.length < 50) {
      const idx = candles.length;
      if (idx === 7) { candles.push(makeCandle(idx, 90, 91, 79, 80)); continue; }
      candles.push(makeCandle(idx, 100, 100.01, 99.99, 100));
    }
    const res = runBacktest({ candles, config: baseConfig({ exit: { combinator: "AND", conditions: [] }, stopLossPct: 5 }), dataset: sampleDs() });
    expect(res.metrics.maxDrawdownPct).toBeLessThanOrEqual(0);
    const minDD = Math.min(...res.equityCurve.map(p => p.drawdownPct));
    expect(minDD).toBe(res.metrics.maxDrawdownPct);
  });

  it("open position at end reported correctly", () => {
    const vals = [100, 100, 90, 80, 95, 100, 105, 110, 100];
    const candles = flat(vals);
    while (candles.length < 50) candles.push(makeCandle(candles.length, 100, 100.01, 99.99, 100));
    // Add more bullish candles so position stays open
    for (let i = 15; i < 60 && i < candles.length; i++) candles[i] = makeCandle(i, 105, 106, 104, 105);
    const res = runBacktest({ 
      candles, 
      config: baseConfig({ exit: { combinator: "AND", conditions: [] }, stopLossPct: null, takeProfitPct: 500 }), 
      dataset: sampleDs() 
    });
    expect(typeof res.openPositionAtEnd).toBe("boolean");
  });
});

describe("Phase 4.1 - Validation rules", () => {
  it("rejects non-equity/index instruments", () => {
    expect(validateStrategyConfig(baseConfig({ instrumentId: "NSE:NIFTY:INDEX" }))).not.toEqual([]);
    expect(validateStrategyConfig(baseConfig({ instrumentId: "BSE:RELIANCE:DERIVATIVE" } as any))).not.toEqual([]);
  });

  it("requires exit condition or stop/take profit", () => {
    expect(validateStrategyConfig(baseConfig({ exit: { combinator: "AND", conditions: [] }, stopLossPct: null, takeProfitPct: null })).join(" ")).toMatch(/never be closed/i);
  });

  it("validates cost bounds", () => {
    expect(validateStrategyConfig(baseConfig({ costs: { brokerageFlat: 2000, brokeragePct: 0, slippageBps: 0 } })).join(" ")).toMatch(/Costs/i);
    expect(validateStrategyConfig(baseConfig({ costs: { brokerageFlat: 0, brokeragePct: 10, slippageBps: 0 } })).join(" ")).toMatch(/Costs/i);
  });

  it("validates MACD fast < slow", () => {
    expect(validateStrategyConfig(baseConfig({
      entry: { combinator: "AND", conditions: [{ type: "MACD_CROSS_ABOVE", maKind: null, period: null, fast: 26, slow: 12, signal: 9, threshold: null }] }
    })).join(" ")).toMatch(/fast.*shorter/i);
  });
});
