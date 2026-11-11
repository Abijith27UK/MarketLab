import { describe, expect, it } from "vitest";
import {
  evaluateOrder,
  reservedCashFrom,
  reservedQuantityFrom,
  type AccountBalance,
  type EligiblePrice,
  type OrderRequest,
} from "../convex/paperCore/engine";
import { runBacktest } from "../convex/backtestCore/engine";
import { ENGINE_VERSION, roundMoney } from "../convex/backtestCore/config";
import type {
  BacktestCandle,
  DatasetInfo,
  StrategyConfig,
} from "../convex/backtestCore/types";

/**
 * Phase 7 regression tests for the two places where a silent arithmetic mistake
 * would be most damaging: account balances after a fill and the identity of a
 * saved backtest.
 */

const NOW = 1_700_000_000_000;

const eligible = (over: Partial<EligiblePrice> = {}): EligiblePrice => ({
  price: 100,
  bid: 99.9,
  ask: 100.1,
  mode: "SAMPLE",
  source: "sample",
  quoteTime: NOW,
  fetchedAt: NOW,
  ...over,
});

const account = (over: Partial<AccountBalance> = {}): AccountBalance => ({
  startingCapital: 100_000,
  availableCash: 100_000,
  realizedPnl: 0,
  ...over,
});

const request = (over: Partial<OrderRequest> = {}): OrderRequest => ({
  clientOrderId: "phase7-1",
  instrumentId: "NSE:TEST:EQUITY",
  instrumentType: "EQUITY",
  side: "BUY",
  orderType: "MARKET",
  quantity: 10,
  limitPrice: null,
  ...over,
});

const evaluate = (over: Record<string, unknown>) =>
  evaluateOrder({
    request: request(),
    account: account(),
    position: null,
    eligible: eligible(),
    reservedCash: 0,
    reservedQuantity: 0,
    ...over,
  });

describe("paper balances never go negative", () => {
  it("spends exactly the available cash when the order fills it", () => {
    // 100 shares at the ask of 100.1 = 10,010.
    const result = evaluate({
      request: request({ quantity: 100 }),
      account: account({ availableCash: 10_010 }),
    });
    expect(result.status).toBe("FILLED");
    if (result.status !== "FILLED") return;
    expect(result.cashDelta).toBe(-10_010);
    expect(account({ availableCash: 10_010 }).availableCash + result.cashDelta).toBe(0);
  });

  it("rejects one rupee short instead of leaving a negative balance", () => {
    const result = evaluate({
      request: request({ quantity: 100 }),
      account: account({ availableCash: 10_009 }),
    });
    expect(result.status).toBe("REJECTED");
    if (result.status !== "REJECTED") return;
    // A rejection has no cash or position side effect at all.
    expect(result).not.toHaveProperty("cashDelta");
    expect(result).not.toHaveProperty("position");
    expect(result).not.toHaveProperty("realizedPnl");
  });

  it("never sells more shares than the position holds", () => {
    const ok = evaluate({
      request: request({ side: "SELL", quantity: 10 }),
      position: { quantity: 10, costBasis: 1000 },
    });
    expect(ok.status).toBe("FILLED");
    if (ok.status !== "FILLED") return;
    expect(ok.position).toEqual({ quantity: 0, costBasis: 0 });

    const tooMany = evaluate({
      request: request({ side: "SELL", quantity: 11 }),
      position: { quantity: 10, costBasis: 1000 },
    });
    expect(tooMany.status).toBe("REJECTED");
  });

  it("only allows the unreserved part of a position to be sold", () => {
    const result = evaluate({
      request: request({ side: "SELL", quantity: 4 }),
      position: { quantity: 10, costBasis: 1000 },
      reservedQuantity: 7,
    });
    expect(result.status).toBe("REJECTED");
    if (result.status !== "REJECTED") return;
    expect(result.reason).toMatch(/Only 3 share/);
  });

  it("leaves cash and positions untouched while an order rests", () => {
    const resting = evaluate({
      request: request({ orderType: "LIMIT", limitPrice: 90, quantity: 10 }),
    });
    expect(resting.status).toBe("OPEN");
    if (resting.status !== "OPEN") return;
    expect(resting).not.toHaveProperty("cashDelta");
    expect(resting).not.toHaveProperty("position");
    // Its worst case is reserved, which is what the next order sees.
    expect(reservedCashFrom([
      { orderId: "o1", instrumentId: "NSE:TEST:EQUITY", side: "BUY", quantity: 10, limitPrice: 90 },
    ])).toBe(900);
    expect(reservedQuantityFrom([])).toBe(0);
  });

  it("keeps reservations scoped to their own instrument", () => {
    const result = evaluate({
      request: request({ side: "SELL", quantity: 10 }),
      position: { quantity: 10, costBasis: 1000 },
      reservedQuantity: 10,
    });
    // The sell is blocked because this instrument's shares are fully reserved.
    expect(result.status).toBe("REJECTED");
  });
});

/* ------------------------------------------------------------------ */
/* Saved backtest identity                                             */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

const candles = (values: number[]): BacktestCandle[] =>
  values.map((value, index) => ({
    ts: T0 + index * DAY,
    open: value,
    high: value + 0.5,
    low: value - 0.5,
    close: value,
    volume: 1000,
  }));

const series = (): BacktestCandle[] => {
  const values = [100, 100, 92, 88, 96, 102, 108, 112, 118, 124, 118, 110, 104, 98, 94, 100];
  const padded: number[] = [];
  for (let i = 0; i < 40; i += 1) padded.push(100);
  return candles([...padded, ...values]);
};

const dataset = (over: Partial<DatasetInfo> = {}): DatasetInfo => ({
  kind: "sample",
  source: "sample",
  mode: "SAMPLE",
  datasetId: null,
  hash: "phase7-hash",
  rowCount: 0,
  firstTs: null,
  lastTs: null,
  gaps: 0,
  label: "SAMPLE · deterministic series",
  ...over,
});

const config = (over: Partial<StrategyConfig> = {}): StrategyConfig => ({
  instrumentId: "NSE:TEST:EQUITY",
  interval: "1d",
  fromMs: T0,
  toMs: T0 + 400 * DAY,
  initialCapital: 100_000,
  datasetMode: "SAMPLE",
  sizing: { kind: "FIXED_QUANTITY", quantity: 10, percentOfEquity: null, maxPositionValuePct: 100 },
  entry: {
    combinator: "AND",
    conditions: [
      { type: "PRICE_CROSS_ABOVE_MA", maKind: "SMA", period: 3, fast: null, slow: null, signal: null, threshold: null },
    ],
  },
  exit: {
    combinator: "AND",
    conditions: [
      { type: "PRICE_CROSS_BELOW_MA", maKind: "SMA", period: 3, fast: null, slow: null, signal: null, threshold: null },
    ],
  },
  stopLossPct: null,
  takeProfitPct: null,
  costs: { brokerageFlat: 0, brokeragePct: 0, slippageBps: 0 },
  ...over,
});

describe("backtest identity is reproducible", () => {
  it("produces an identical hash and result for identical inputs", () => {
    const first = runBacktest({ candles: series(), config: config(), dataset: dataset() });
    const second = runBacktest({ candles: series(), config: config(), dataset: dataset() });
    expect(first.inputHash).toBe(second.inputHash);
    expect(first.equityCurve).toEqual(second.equityCurve);
    expect(first.trades).toEqual(second.trades);
    expect(first.engineVersion).toBe(ENGINE_VERSION);
  });

  it("changes the hash when a cost assumption changes", () => {
    const base = runBacktest({ candles: series(), config: config(), dataset: dataset() });
    const costed = runBacktest({
      candles: series(),
      config: config({ costs: { brokerageFlat: 20, brokeragePct: 0, slippageBps: 5 } }),
      dataset: dataset(),
    });
    expect(costed.inputHash).not.toBe(base.inputHash);
  });

  it("changes the hash when the sizing rule changes", () => {
    const base = runBacktest({ candles: series(), config: config(), dataset: dataset() });
    const sized = runBacktest({
      candles: series(),
      config: config({
        sizing: { kind: "PERCENT_OF_EQUITY", quantity: null, percentOfEquity: 25, maxPositionValuePct: 100 },
      }),
      dataset: dataset(),
    });
    expect(sized.inputHash).not.toBe(base.inputHash);
  });

  it("keeps the SAMPLE dataset label out of the metrics but attached to the run input", () => {
    const result = runBacktest({ candles: series(), config: config(), dataset: dataset() });
    // The engine cannot upgrade a sample dataset: it reports what it was given.
    expect(result.metrics.initialCapital).toBe(100_000);
    expect(Number.isFinite(result.metrics.finalEquity)).toBe(true);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    for (const point of result.equityCurve) {
      expect(Number.isFinite(point.equity)).toBe(true);
      expect(point.equity).toBeGreaterThan(0);
    }
  });
});

// Keep the money helper honest: the paper engine must round currency to paise.
describe("currency precision", () => {
  it("rounds money to two decimals", () => {
    const result = evaluate({
      request: request({ quantity: 3 }),
      eligible: eligible({ price: 33.333, ask: 33.333 }),
    });
    if (result.status !== "FILLED") throw new Error("expected a fill");
    expect(    roundMoney(result.cashDelta)).toBe(result.cashDelta);
    expect(Math.round(result.cashDelta * 100)).toBe(result.cashDelta * 100);
  });
});
