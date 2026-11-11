import { describe, expect, it } from "vitest";
import {
  evaluateCondition,
  evaluateRuleSet,
  runBacktest,
  validateCandles,
} from "../convex/backtestCore/engine";
import { validateStrategyConfig } from "../convex/backtestCore/validation";
import {
  MAX_BACKTEST_CANDLES,
  MAX_STORED_TRADES,
  MIN_BACKTEST_CANDLES,
  roundMoney,
} from "../convex/backtestCore/config";
import type {
  BacktestCandle,
  DatasetInfo,
  StrategyCondition,
  StrategyConfig,
} from "../convex/backtestCore/types";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

const candle = (
  index: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number | null = 1_000
): BacktestCandle => ({ ts: T0 + index * DAY, open, high, low, close, volume });

/** Flat bar: open = close = value, with a 1-unit wick each side. */
const flatCandles = (values: number[]): BacktestCandle[] =>
  values.map((value, index) => candle(index, value, value + 1, value - 1, value));

const condition = (over: Partial<StrategyCondition>): StrategyCondition => ({
  type: "PRICE_CROSS_ABOVE_MA",
  maKind: "SMA",
  period: 2,
  fast: null,
  slow: null,
  signal: null,
  threshold: null,
  ...over,
});

const sampleDataset = (over: Partial<DatasetInfo> = {}): DatasetInfo => ({
  kind: "sample",
  source: "sample",
  mode: "SAMPLE",
  datasetId: null,
  hash: "testhash",
  rowCount: 0,
  firstTs: null,
  lastTs: null,
  gaps: 0,
  label: "SAMPLE · test series",
  ...over,
});

const config = (over: Partial<StrategyConfig> = {}): StrategyConfig => ({
  instrumentId: "NSE:TEST:EQUITY",
  interval: "1d",
  fromMs: T0,
  toMs: T0 + 300 * DAY,
  initialCapital: 100_000,
  datasetMode: "SAMPLE",
  sizing: {
    kind: "FIXED_QUANTITY",
    quantity: 1,
    percentOfEquity: null,
    maxPositionValuePct: 100,
  },
  entry: {
    combinator: "AND",
    conditions: [condition({})],
  },
  exit: {
    combinator: "AND",
    conditions: [condition({ type: "PRICE_CROSS_BELOW_MA" })],
  },
  stopLossPct: null,
  takeProfitPct: null,
  costs: { brokerageFlat: 0, brokeragePct: 0, slippageBps: 0 },
  ...over,
});

/**
 * A dip then a rally then a decline: the SMA(2) cross-up happens on the close
 * of index 5 and the cross-down on the close of index 9.
 */
const CROSS_VALUES = [
  100, 100, 100, 90, 80, 95, 100, 105, 110, 100, 90, 80,
  ...Array.from({ length: 30 }, () => 80),
];

function run(over: Partial<StrategyConfig> = {}, candles = flatCandles(CROSS_VALUES)) {
  return runBacktest({ candles, config: config(over), dataset: sampleDataset() });
}

/* ------------------------------------------------------------------ */
/* Execution policy                                                    */
/* ------------------------------------------------------------------ */

describe("next-candle execution policy", () => {
  it("executes a close signal at the following candle's open", () => {
    const result = run();
    expect(result.trades).toHaveLength(1);

    const [trade] = result.trades;
    // Signal fired on the close of index 5; execution is the open of index 6.
    expect(trade.entryIndex).toBe(6);
    expect(trade.entryPrice).toBe(100);
    // Exit signal on the close of index 9; execution is the open of index 10.
    expect(trade.exitIndex).toBe(10);
    expect(trade.exitPrice).toBe(90);
    expect(trade.exitReason).toBe("exit_signal");
    expect(trade.quantity).toBe(1);
    expect(trade.netPnl).toBe(-10);
  });

  it("never fills on the signal candle itself", () => {
    const result = run();
    for (const trade of result.trades) {
      expect(trade.entryIndex).toBeGreaterThan(5);
    }
  });

  it("does not execute an order when the data ends on the signal", () => {
    // Cross-up on index 5, so a series ending at index 5 has nothing to execute.
    const candles = flatCandles(CROSS_VALUES.slice(0, 6));
    expect(() => run({}, candles)).toThrow(/at least/);

    const padded = flatCandles(CROSS_VALUES.slice(0, 6).concat(Array.from({ length: 40 }, () => 80)));
    const result = run({}, padded);
    // The entry executes at index 6 (open 80 after the padding starts).
    expect(result.trades[0].entryIndex).toBe(6);
    expect(result.trades[0].entryPrice).toBe(80);
  });
});

describe("signal evaluation", () => {
  it("requires warm-up before a moving-average condition can be true", () => {
    const closes = flatCandles([100, 101, 102, 103]).map((c) => c.close);
    const cache = { ma: new Map(), rsi: new Map(), macd: new Map() };
    const cond = condition({ type: "PRICE_ABOVE_MA", period: 3 });
    expect(evaluateCondition(cond, 0, closes, cache)).toBe(false);
    expect(evaluateCondition(cond, 1, closes, cache)).toBe(false);
    expect(evaluateCondition(cond, 2, closes, cache)).toBe(true);
  });

  it("combines conditions with AND and OR", () => {
    const closes = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 5, 5, 5, 5, 5, 5];
    const cache = { ma: new Map(), rsi: new Map(), macd: new Map() };
    // Close below SMA(2) is true in a falling market; RSI below 90 too.
    const belowMa = condition({ type: "PRICE_BELOW_MA", period: 2 });
    const rsiBelow = condition({ type: "RSI_BELOW", period: 2, threshold: 99 });
    expect(evaluateRuleSet([belowMa, rsiBelow], "AND", 5, closes, cache)).toBe(true);
    expect(evaluateRuleSet([belowMa], "OR", 0, closes, cache)).toBe(false);
    expect(evaluateRuleSet([], "AND", 5, closes, cache)).toBe(false);
    expect(evaluateRuleSet([], "OR", 5, closes, cache)).toBe(false);
  });

  it("rejects unsupported condition types instead of ignoring them", () => {
    const closes = [1, 2, 3, 4, 5];
    const cache = { ma: new Map(), rsi: new Map(), macd: new Map() };
    const bogus = condition({ type: "SUPER_SECRET_ALPHA" as never });
    expect(evaluateCondition(bogus, 4, closes, cache)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Sizing, cash and quantities                                         */
/* ------------------------------------------------------------------ */

describe("position sizing and cash", () => {
  it("never spends more cash than the account holds", () => {
    const result = run({
      initialCapital: 10_000,
      sizing: { kind: "FIXED_QUANTITY", quantity: 1_000, percentOfEquity: null, maxPositionValuePct: 100 },
    });
    expect(result.trades).toHaveLength(1);
    const [trade] = result.trades;
    expect(trade.quantity).toBe(100); // 10,000 / 100 per share
    expect(trade.entryPrice).toBe(100);
    expect(result.metrics.finalEquity).toBeGreaterThanOrEqual(0);
  });

  it("caps a fixed quantity by the maximum position value", () => {
    const result = run({
      sizing: { kind: "FIXED_QUANTITY", quantity: 1_000, percentOfEquity: null, maxPositionValuePct: 5 },
    });
    // 5% of ₹1,00,000 = ₹5,000 → 50 shares at ₹100.
    expect(result.trades[0].quantity).toBe(50);
  });

  it("uses whole shares for percent-of-equity sizing", () => {
    const result = run({
      sizing: {
        kind: "PERCENT_OF_EQUITY",
        quantity: null,
        percentOfEquity: 33,
        maxPositionValuePct: 100,
      },
    });
    expect(result.trades[0].quantity).toBe(330);
    expect(Number.isInteger(result.trades[0].quantity)).toBe(true);
  });

  it("skips entries it cannot fund and says so", () => {
    // ₹20,000 per share against ₹10,000 of capital: not one share is affordable.
    const expensive = flatCandles(CROSS_VALUES.map((value) => value * 200));
    const result = run(
      {
        initialCapital: 10_000,
        sizing: { kind: "FIXED_QUANTITY", quantity: 5, percentOfEquity: null, maxPositionValuePct: 100 },
      },
      expensive
    );
    expect(result.trades).toHaveLength(0);
    expect(result.metrics.finalEquity).toBe(10_000);
    expect(result.warnings.join(" ")).toMatch(/not executed because available cash/);
  });
});

/* ------------------------------------------------------------------ */
/* Costs                                                               */
/* ------------------------------------------------------------------ */

describe("trading costs", () => {
  it("applies brokerage per side and slippage against the trader", () => {
    const result = run({
      costs: { brokerageFlat: 20, brokeragePct: 0.5, slippageBps: 10 },
    });
    const [trade] = result.trades;

    // Buy: 100 × (1 + 10/10,000) = 100.10 → brokerage 20 + 0.50 = 20.50
    expect(trade.entryPrice).toBe(100.1);
    // Sell: 90 × (1 − 10/10,000) = 89.91 → brokerage 20 + 0.45 = 20.45
    expect(trade.exitPrice).toBe(89.91);
    expect(trade.costs).toBe(40.95);
    expect(trade.grossPnl).toBe(-10.19);
    expect(trade.netPnl).toBe(-51.14);

    expect(result.metrics.totalBrokerage).toBe(40.95);
    expect(result.metrics.totalSlippage).toBe(0.19);
    expect(result.metrics.totalCosts).toBe(41.14);
  });

  it("keeps cash consistent with the ledger of trades", () => {
    const result = run({ costs: { brokerageFlat: 5, brokeragePct: 0.1, slippageBps: 5 } });
    const trade = result.trades[0];
    const expectedCash = roundMoney(
      100_000 - trade.entryPrice * trade.quantity - 5 - trade.entryPrice * trade.quantity * 0.001
      + (trade.exitPrice * trade.quantity - 5 - trade.exitPrice * trade.quantity * 0.001)
    );
    expect(result.metrics.finalEquity).toBeCloseTo(expectedCash, 2);
  });
});

/* ------------------------------------------------------------------ */
/* Stops                                                               */
/* ------------------------------------------------------------------ */

/** Candles where the cross-up happens at index 5 and entry at index 6 (open 100). */
function candlesForStop(overrides: Record<number, BacktestCandle> = {}): BacktestCandle[] {
  const base = flatCandles(CROSS_VALUES).map((bar) => ({ ...bar }));
  for (const [index, bar] of Object.entries(overrides)) {
    base[Number(index)] = bar;
  }
  return base;
}

describe("stop-loss and take-profit", () => {
  it("exits at the stop level when the low breaches it", () => {
    const candles = candlesForStop({
      7: candle(7, 95, 96, 85, 88),
    });
    const result = run(
      { exit: { combinator: "AND", conditions: [] }, stopLossPct: 10 },
      candles
    );
    const [trade] = result.trades;
    expect(trade.exitReason).toBe("stop_loss");
    expect(trade.exitIndex).toBe(7);
    expect(trade.exitPrice).toBe(90);
    expect(trade.ambiguousExit).toBe(false);
  });

  it("fills a gap through the stop at the open, not at the stop", () => {
    const candles = candlesForStop({
      7: candle(7, 85, 86, 80, 84),
    });
    const result = run(
      { exit: { combinator: "AND", conditions: [] }, stopLossPct: 10 },
      candles
    );
    const [trade] = result.trades;
    expect(trade.exitReason).toBe("stop_loss");
    expect(trade.exitPrice).toBe(85);
  });

  it("takes profit at the target when the high reaches it", () => {
    const candles = candlesForStop({
      7: candle(7, 101, 112, 100, 110),
    });
    const result = run(
      { exit: { combinator: "AND", conditions: [] }, takeProfitPct: 10 },
      candles
    );
    const [trade] = result.trades;
    expect(trade.exitReason).toBe("take_profit");
    expect(trade.exitPrice).toBe(110);
  });

  it("assumes the stop fills first when both levels sit inside one candle", () => {
    const candles = candlesForStop({
      7: candle(7, 100, 115, 85, 100),
    });
    const result = run(
      { exit: { combinator: "AND", conditions: [] }, stopLossPct: 10, takeProfitPct: 10 },
      candles
    );
    const [trade] = result.trades;
    expect(trade.ambiguousExit).toBe(true);
    expect(trade.exitReason).toBe("stop_loss");
    expect(trade.exitPrice).toBe(90);
    expect(result.warnings.join(" ")).toMatch(/stop-loss and take-profit both inside one candle/);
  });
});

/* ------------------------------------------------------------------ */
/* Data quality                                                        */
/* ------------------------------------------------------------------ */

describe("candle validation", () => {
  it("rejects duplicate timestamps", () => {
    const candles = flatCandles(CROSS_VALUES);
    candles[8] = { ...candles[8], ts: candles[7].ts };
    expect(() => validateCandles(candles)).toThrow(/duplicates the timestamp/);
  });

  it("rejects out-of-order candles", () => {
    const candles = flatCandles(CROSS_VALUES);
    const swapped = [...candles];
    swapped[12] = candles[11];
    swapped[11] = candles[12];
    expect(() => validateCandles(swapped)).toThrow(/sorted oldest to newest/);
  });

  it("rejects impossible OHLC values", () => {
    const candles = flatCandles(CROSS_VALUES);
    candles[10] = { ...candles[10], high: 1 };
    expect(() => validateCandles(candles)).toThrow(/high below/);

    const negative = flatCandles(CROSS_VALUES);
    negative[10] = { ...negative[10], close: -5 };
    expect(() => validateCandles(negative)).toThrow(/invalid close/);
  });

  it("reports missing candles instead of fabricating them", () => {
    const candles = flatCandles(CROSS_VALUES);
    // Skip two days: the timestamps jump by 3 days.
    for (let i = 20; i < candles.length; i += 1) {
      candles[i] = { ...candles[i], ts: candles[i].ts + 2 * DAY };
    }
    const result = run({}, candles);
    expect(result.candlesUsed).toBe(candles.length);
    expect(result.warnings.join(" ")).toMatch(/missing 1d bucket/);
  });

  it("enforces the configured data and history limits", () => {
    const tooMany = Array.from({ length: MAX_BACKTEST_CANDLES + 1 }, (_, i) => candle(i, 100, 101, 99, 100));
    expect(() => validateCandles(tooMany)).toThrow(/limited to 5000|limited to/);

    const tooFew = Array.from({ length: MIN_BACKTEST_CANDLES - 1 }, (_, i) => candle(i, 100, 101, 99, 100));
    expect(() => validateCandles(tooFew)).toThrow(/at least/);
  });
});

/* ------------------------------------------------------------------ */
/* Look-ahead                                                          */
/* ------------------------------------------------------------------ */

/** Deterministic pseudo-random walk — no Math.random, so results are stable. */
function walk(length: number, seed = 42): BacktestCandle[] {
  let value = 100;
  let state = seed;
  const candles: BacktestCandle[] = [];
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const change = (state / 2147483648 - 0.5) * 4;
    const open = value;
    value = Math.max(5, value + change);
    const close = value;
    candles.push(candle(i, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close));
  }
  return candles;
}

describe("look-ahead prevention", () => {
  const trendConfig = config({
    entry: {
      combinator: "AND",
      conditions: [condition({ type: "FAST_MA_ABOVE_SLOW_MA", fast: 3, slow: 8 })],
    },
    exit: {
      combinator: "AND",
      conditions: [condition({ type: "FAST_MA_BELOW_SLOW_MA", fast: 3, slow: 8 })],
    },
  });

  it("produces identical earlier results when future candles are appended", () => {
    const full = walk(140);
    const prefix = full.slice(0, 70);

    const fullResult = runBacktest({ candles: full, config: trendConfig, dataset: sampleDataset() });
    const prefixResult = runBacktest({ candles: prefix, config: trendConfig, dataset: sampleDataset() });

    const earlierFull = fullResult.trades.filter((trade) => trade.exitIndex < 70);
    expect(prefixResult.trades.length).toBeGreaterThan(0);
    expect(earlierFull).toEqual(prefixResult.trades);

    // Equity up to the prefix's last candle must match exactly.
    const prefixCurve = new Map(prefixResult.equityCurve.map((point) => [point.ts, point.equity]));
    for (const point of fullResult.equityCurve) {
      if (prefixCurve.has(point.ts)) {
        expect(point.equity).toBe(prefixCurve.get(point.ts));
      }
    }
  });

  it("gives every indicator value from information available at that candle", () => {
    // A spiking final candle must not change any earlier condition outcome.
    const base = walk(80);
    const spiked = [...base];
    spiked[spiked.length - 1] = candle(79, 100, 400, 90, 300);
    const closesA = base.map((bar) => bar.close);
    const closesB = spiked.map((bar) => bar.close);
    const cond = condition({ type: "PRICE_CROSS_ABOVE_MA", period: 5 });

    const cacheA = { ma: new Map(), rsi: new Map(), macd: new Map() };
    const cacheB = { ma: new Map(), rsi: new Map(), macd: new Map() };
    for (let i = 0; i < base.length - 1; i += 1) {
      expect(evaluateCondition(cond, i, closesB, cacheB)).toBe(
        evaluateCondition(cond, i, closesA, cacheA)
      );
    }
  });
});

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

describe("metrics", () => {
  it("reports no undefined numbers for a strategy that never trades", () => {
    const candles = flatCandles(Array.from({ length: 60 }, () => 100));
    const result = run(
      {
        entry: {
          combinator: "AND",
          conditions: [condition({ type: "PRICE_ABOVE_MA", period: 200 })],
        },
        exit: { combinator: "AND", conditions: [] },
        stopLossPct: 5,
      },
      candles
    );

    expect(result.trades).toHaveLength(0);
    expect(result.metrics.tradeCount).toBe(0);
    expect(result.metrics.winRatePct).toBeNull();
    expect(result.metrics.averageWin).toBeNull();
    expect(result.metrics.averageLoss).toBeNull();
    expect(result.metrics.profitFactor).toBeNull();
    expect(result.metrics.finalEquity).toBe(100_000);
    expect(result.metrics.returnPct).toBe(0);
    expect(JSON.stringify(result.metrics)).not.toMatch(/null,null,null|NaN|Infinity/);
  });

  it("computes win rate, averages and profit factor from closed trades", () => {
    const result = run({ costs: { brokerageFlat: 0, brokeragePct: 0, slippageBps: 0 } });
    expect(result.metrics.tradeCount).toBe(1);
    expect(result.metrics.winningTrades).toBe(0);
    expect(result.metrics.losingTrades).toBe(1);
    expect(result.metrics.winRatePct).toBe(0);
    expect(result.metrics.averageLoss).toBe(-10);
    expect(result.metrics.profitFactor).toBe(0);
  });

  it("reports a drawdown from a peak-to-trough equity decline", () => {
    const candles = candlesForStop({ 7: candle(7, 90, 91, 79, 80) });
    const result = run({}, candles);
    expect(result.metrics.maxDrawdownPct).toBeLessThan(0);
    expect(result.metrics.maxDrawdownPct).toBeGreaterThanOrEqual(-100);
    const trough = Math.min(...result.equityCurve.map((point) => point.drawdownPct));
    expect(trough).toBe(result.metrics.maxDrawdownPct);
  });

  it("marks the position open when the data ends mid-trade", () => {
    const candles = flatCandles(CROSS_VALUES.slice(0, 8).concat(Array.from({ length: 40 }, () => 105)));
    const result = run(
      { exit: { combinator: "AND", conditions: [] }, stopLossPct: null, takeProfitPct: 400 },
      candles
    );
    expect(result.trades).toHaveLength(0);
    expect(result.openPositionAtEnd).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/still open/);
    expect(result.metrics.exposurePct).toBeGreaterThan(0);
  });

  it("labels a sample dataset and never presents it as real history", () => {
    const result = run();
    expect(sampleDataset().mode).toBe("SAMPLE");
    expect(result.warnings.join(" ")).toMatch(/not Indian market history/);
  });
});

/* ------------------------------------------------------------------ */
/* Determinism and bounds                                              */
/* ------------------------------------------------------------------ */

describe("determinism and limits", () => {
  it("returns byte-identical output for identical inputs", () => {
    const candles = walk(120);
    const cfg = config({
      entry: {
        combinator: "AND",
        conditions: [condition({ type: "FAST_MA_ABOVE_SLOW_MA", fast: 5, slow: 20 })],
      },
      exit: {
        combinator: "OR",
        conditions: [
          condition({ type: "FAST_MA_BELOW_SLOW_MA", fast: 5, slow: 20 }),
          condition({ type: "RSI_ABOVE", period: 14, threshold: 70 }),
        ],
      },
      stopLossPct: 8,
    });
    const first = runBacktest({ candles, config: cfg, dataset: sampleDataset() });
    const second = runBacktest({ candles, config: cfg, dataset: sampleDataset() });
    expect(second).toEqual(first);
    expect(second.inputHash).toBe(first.inputHash);
    expect(first.inputHash).toHaveLength(64);
  });

  it("keeps a maximum-size run bounded in time and stored size", () => {
    const candles = walk(MAX_BACKTEST_CANDLES);
    const startedAt = Date.now();
    const result = runBacktest({
      candles,
      config: config({
        entry: {
          combinator: "AND",
          conditions: [condition({ type: "FAST_MA_ABOVE_SLOW_MA", fast: 5, slow: 20 })],
        },
        exit: {
          combinator: "AND",
          conditions: [condition({ type: "FAST_MA_BELOW_SLOW_MA", fast: 5, slow: 20 })],
        },
      }),
      dataset: sampleDataset(),
    });
    const elapsed = Date.now() - startedAt;

    expect(result.candlesUsed).toBe(MAX_BACKTEST_CANDLES);
    expect(result.equityCurve.length).toBeLessThanOrEqual(401);
    expect(result.priceCurve.length).toBeLessThanOrEqual(401);
    expect(result.trades.length).toBeLessThanOrEqual(MAX_STORED_TRADES);
    expect(elapsed).toBeLessThan(3_000);
  });
});

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe("strategy validation", () => {
  it("accepts the default configuration", () => {
    expect(validateStrategyConfig(config())).toEqual([]);
  });

  it("rejects unsupported instruments, sizing and rule combinations", () => {
    expect(validateStrategyConfig(config({ instrumentId: "NSE:NIFTY 50:INDEX" }))).not.toEqual([]);
    expect(validateStrategyConfig(config({ instrumentId: "not-an-id" }))).not.toEqual([]);
    expect(validateStrategyConfig(config({ initialCapital: 5_000 }))).not.toEqual([]);
    expect(validateStrategyConfig(config({ interval: "2h" as never }))).not.toEqual([]);

    const emptyEntry = config({ entry: { combinator: "AND", conditions: [] } });
    expect(validateStrategyConfig(emptyEntry).join(" ")).toMatch(/Entry rules: add at least one/);

    const noExit = config({
      exit: { combinator: "AND", conditions: [] },
      stopLossPct: null,
      takeProfitPct: null,
    });
    expect(validateStrategyConfig(noExit).join(" ")).toMatch(/could never be closed/);

    const badPeriod = config({
      entry: { combinator: "AND", conditions: [condition({ type: "PRICE_ABOVE_MA", period: 1 })] },
    });
    expect(validateStrategyConfig(badPeriod).join(" ")).toMatch(/period must be a whole number/);

    const badMacd = config({
      entry: {
        combinator: "AND",
        conditions: [condition({ type: "MACD_CROSS_ABOVE", fast: 26, slow: 12, signal: 9 })],
      },
    });
    expect(validateStrategyConfig(badMacd).join(" ")).toMatch(/fast period must be shorter/);

    const badRsi = config({
      entry: {
        combinator: "AND",
        conditions: [condition({ type: "RSI_ABOVE", period: 14, threshold: 100 })],
      },
    });
    expect(validateStrategyConfig(badRsi).join(" ")).toMatch(/between 1 and 99/);

    const badCosts = config({ costs: { brokerageFlat: 5_000, brokeragePct: 50, slippageBps: 5_000 } });
    expect(validateStrategyConfig(badCosts).join(" ")).toMatch(/Costs must be within/);
  });

  it("refuses to run an invalid configuration", () => {
    expect(() => run({ initialCapital: 1 })).toThrow(/Invalid strategy/);
  });
});
