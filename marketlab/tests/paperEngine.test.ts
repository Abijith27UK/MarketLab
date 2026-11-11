import { describe, expect, it } from "vitest";
import {
  canTransition,
  evaluateOrder,
  fillModeFor,
  referencePrice,
  replayLedger,
  reservedCashFrom,
  reservedQuantityFrom,
  selectFillPrice,
  summarizePortfolio,
  validateOrderRequest,
  type AccountBalance,
  type EligiblePrice,
  type OpenOrderSummary,
  type OrderRequest,
  type PositionBalance,
} from "../convex/paperCore/engine";
import {
  MAX_FILL_QUOTE_AGE_MS,
  roundMoney,
  roundRatio,
  SAMPLE_FILLS_ENABLED,
} from "../convex/paperCore/config";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

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
  clientOrderId: "client-1",
  instrumentId: "NSE:TEST:EQUITY",
  instrumentType: "EQUITY",
  side: "BUY",
  orderType: "MARKET",
  quantity: 10,
  limitPrice: null,
  ...over,
});

const evaluate = (
  over: Partial<Parameters<typeof evaluateOrder>[0]> = {}
) =>
  evaluateOrder({
    request: request(),
    account: account(),
    position: null,
    eligible: eligible(),
    reservedCash: 0,
    reservedQuantity: 0,
    ...over,
  });

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

describe("order validation", () => {
  it("accepts a well-formed market order", () => {
    expect(validateOrderRequest(request())).toBeNull();
    expect(validateOrderRequest(request({ orderType: "LIMIT", limitPrice: 99.5 }))).toBeNull();
  });

  it("rejects non-positive, fractional and oversized quantities", () => {
    expect(validateOrderRequest(request({ quantity: 0 }))).toMatch(/whole number/);
    expect(validateOrderRequest(request({ quantity: -5 }))).toMatch(/whole number/);
    expect(validateOrderRequest(request({ quantity: 1.5 }))).toMatch(/whole number/);
    expect(validateOrderRequest(request({ quantity: 100_001 }))).toMatch(/cannot exceed/);
  });

  it("requires a usable limit price for limit orders", () => {
    expect(validateOrderRequest(request({ orderType: "LIMIT", limitPrice: null }))).toMatch(
      /limit price above zero/
    );
    expect(validateOrderRequest(request({ orderType: "LIMIT", limitPrice: 0 }))).toMatch(
      /limit price above zero/
    );
    expect(validateOrderRequest(request({ orderType: "LIMIT", limitPrice: Number.NaN }))).toMatch(
      /limit price above zero/
    );
  });

  it("rejects unsupported order types and instrument types instead of approximating them", () => {
    expect(validateOrderRequest(request({ orderType: "STOP_LOSS" }))).toMatch(/not supported/);
    expect(validateOrderRequest(request({ instrumentType: "INDEX" }))).toMatch(
      /equities and ETFs only/
    );
    expect(validateOrderRequest(request({ instrumentType: "OTHER" }))).toMatch(
      /equities and ETFs only/
    );
  });

  it("requires an idempotency reference", () => {
    expect(validateOrderRequest(request({ clientOrderId: "   " }))).toMatch(/reference/);
  });
});

/* ------------------------------------------------------------------ */
/* Market orders                                                       */
/* ------------------------------------------------------------------ */

describe("market orders", () => {
  it("fills a buy at the ask and moves cash into cost basis", () => {
    const result = evaluate({ request: request({ quantity: 10 }) });
    expect(result.status).toBe("FILLED");
    if (result.status !== "FILLED") return;

    expect(result.fillPrice).toBe(100.1);
    expect(result.grossValue).toBe(1001);
    expect(result.cashDelta).toBe(-1001);
    expect(result.realizedPnl).toBe(0);
    expect(result.position).toEqual({ quantity: 10, costBasis: 1001 });
    expect(result.mode).toBe("SAMPLE");
    expect(result.source).toBe("sample");
  });

  it("fills a sell at the bid and realises P&L against the cost basis", () => {
    const result = evaluate({
      request: request({ side: "SELL", quantity: 4 }),
      position: { quantity: 10, costBasis: 1000 },
    });
    expect(result.status).toBe("FILLED");
    if (result.status !== "FILLED") return;

    expect(result.fillPrice).toBe(99.9);
    expect(result.grossValue).toBe(399.6);
    expect(result.cashDelta).toBe(399.6);
    // Proceeds 399.60 against 4 × ₹100 cost = ₹400 → ₹0.40 loss.
    expect(result.realizedPnl).toBe(-0.4);
    expect(result.position).toEqual({ quantity: 6, costBasis: 600 });
  });

  it("uses the last price when the source has no bid/ask book", () => {
    expect(
      referencePrice("BUY", eligible({ bid: null, ask: null, price: 250.75 }))
    ).toBe(250.75);
    expect(
      referencePrice("SELL", eligible({ bid: null, ask: null, price: 250.75 }))
    ).toBe(250.75);
  });

  it("rejects a buy that exceeds spendable cash", () => {
    const result = evaluate({
      request: request({ quantity: 10 }),
      account: account({ availableCash: 500 }),
    });
    expect(result.status).toBe("REJECTED");
    if (result.status !== "REJECTED") return;
    expect(result.reason).toMatch(/Insufficient cash/);
    expect(result).not.toHaveProperty("position");
  });

  it("counts cash reserved by open limit buys when checking funds", () => {
    const result = evaluate({
      request: request({ quantity: 5 }),
      account: account({ availableCash: 1000 }),
      reservedCash: 800,
    });
    expect(result.status).toBe("REJECTED");
    if (result.status !== "REJECTED") return;
    expect(result.reason).toMatch(/₹200\.00 spendable/);
  });

  it("rejects a sell larger than the sellable quantity", () => {
    const none = evaluate({ request: request({ side: "SELL", quantity: 1 }) });
    expect(none.status).toBe("REJECTED");
    if (none.status === "REJECTED") expect(none.reason).toMatch(/Only 0 share/);

    const tooMany = evaluate({
      request: request({ side: "SELL", quantity: 5 }),
      position: { quantity: 3, costBasis: 300 },
    });
    expect(tooMany.status).toBe("REJECTED");
    if (tooMany.status === "REJECTED") expect(tooMany.reason).toMatch(/Only 3 share/);
  });

  it("does not let shares reserved by open sell limits be sold twice", () => {
    const result = evaluate({
      request: request({ side: "SELL", quantity: 1 }),
      position: { quantity: 10, costBasis: 1000 },
      reservedQuantity: 10,
    });
    expect(result.status).toBe("REJECTED");
  });

  it("refuses to price an order without an eligible quote", () => {
    const result = evaluate({ eligible: null });
    expect(result.status).toBe("REJECTED");
    if (result.status !== "REJECTED") return;
    expect(result.reason).toMatch(/No eligible price/);
  });
});

/* ------------------------------------------------------------------ */
/* Limit orders                                                        */
/* ------------------------------------------------------------------ */

describe("limit orders", () => {
  it("rests a buy whose limit is below the eligible price, reserving its worst case", () => {
    const result = evaluate({
      request: request({ orderType: "LIMIT", limitPrice: 100, quantity: 10 }),
    });
    expect(result.status).toBe("OPEN");
    if (result.status !== "OPEN") return;
    expect(result.reservedCash).toBe(1000);
    expect(result.reservedQuantity).toBe(0);
    expect(result.referencePrice).toBe(100.1);
  });

  it("fills a buy at the eligible price when the limit is satisfied, never above it", () => {
    const result = evaluate({
      request: request({ orderType: "LIMIT", limitPrice: 101, quantity: 10 }),
    });
    expect(result.status).toBe("FILLED");
    if (result.status !== "FILLED") return;
    expect(result.fillPrice).toBe(100.1);
    expect(result.fillPrice).toBeLessThanOrEqual(101);
  });

  it("treats a limit equal to the reference price as satisfied", () => {
    const result = evaluate({
      request: request({ orderType: "LIMIT", limitPrice: 100.1, quantity: 1 }),
    });
    expect(result.status).toBe("FILLED");
  });

  it("rests a sell whose limit is above the bid, reserving the shares", () => {
    const result = evaluate({
      request: request({ side: "SELL", orderType: "LIMIT", limitPrice: 105, quantity: 4 }),
      position: { quantity: 10, costBasis: 1000 },
    });
    expect(result.status).toBe("OPEN");
    if (result.status !== "OPEN") return;
    expect(result.reservedQuantity).toBe(4);
    expect(result.reservedCash).toBe(0);
  });

  it("fills a sell at the bid when the limit is below it, never below the limit", () => {
    const result = evaluate({
      request: request({ side: "SELL", orderType: "LIMIT", limitPrice: 99, quantity: 4 }),
      position: { quantity: 10, costBasis: 1000 },
    });
    expect(result.status).toBe("FILLED");
    if (result.status !== "FILLED") return;
    expect(result.fillPrice).toBe(99.9);
    expect(result.fillPrice).toBeGreaterThanOrEqual(99);
  });

  it("rejects a resting buy it could never fund", () => {
    const result = evaluate({
      request: request({ orderType: "LIMIT", limitPrice: 100, quantity: 10 }),
      account: account({ availableCash: 500 }),
    });
    expect(result.status).toBe("REJECTED");
    if (result.status === "REJECTED") expect(result.reason).toMatch(/reserves ₹1,000\.00/);
  });
});

/* ------------------------------------------------------------------ */
/* Cost basis, reservations and reconciliation                         */
/* ------------------------------------------------------------------ */

describe("cost basis and reservations", () => {
  it("uses a weighted average cost across buys and keeps it after a partial sell", () => {
    const first = evaluate({ request: request({ quantity: 10 }) });
    expect(first.status).toBe("FILLED");
    if (first.status !== "FILLED") return;

    const second = evaluate({
      request: request({ quantity: 10 }),
      position: first.position,
      eligible: eligible({ ask: 120, price: 120 }),
    });
    expect(second.status).toBe("FILLED");
    if (second.status !== "FILLED") return;
    expect(second.position).toEqual({ quantity: 20, costBasis: 2201 });
    expect(roundRatio(second.position.costBasis / second.position.quantity)).toBe(110.05);

    const partial: PositionBalance = second.position;
    const sell = evaluate({
      request: request({ side: "SELL", quantity: 5 }),
      position: partial,
      eligible: eligible({ bid: 130, price: 130 }),
    });
    expect(sell.status).toBe("FILLED");
    if (sell.status !== "FILLED") return;
    // 5 × ₹110.05 = ₹550.25 removed; proceeds ₹650 → ₹99.75 realised.
    expect(sell.position.costBasis).toBe(1650.75);
    expect(sell.position.quantity).toBe(15);
    expect(sell.realizedPnl).toBe(99.75);
    expect(roundRatio(sell.position.costBasis / sell.position.quantity)).toBe(110.05);
  });

  it("clears the position when the whole holding is sold", () => {
    const result = evaluate({
      request: request({ side: "SELL", quantity: 10 }),
      position: { quantity: 10, costBasis: 1000 },
      eligible: eligible({ bid: 110, price: 110 }),
    });
    expect(result.status).toBe("FILLED");
    if (result.status !== "FILLED") return;
    expect(result.position).toEqual({ quantity: 0, costBasis: 0 });
    expect(result.realizedPnl).toBe(100);
  });

  it("sums reservations per side and instrument only", () => {
    const open: OpenOrderSummary[] = [
      { orderId: "1", instrumentId: "NSE:A:EQUITY", side: "BUY", quantity: 10, limitPrice: 100 },
      { orderId: "2", instrumentId: "NSE:B:EQUITY", side: "BUY", quantity: 2, limitPrice: 50.5 },
      { orderId: "3", instrumentId: "NSE:A:EQUITY", side: "SELL", quantity: 3, limitPrice: 120 },
    ];
    expect(reservedCashFrom(open)).toBe(1101);
    expect(reservedQuantityFrom(open)).toBe(3);
    expect(reservedQuantityFrom(open, "NSE:A:EQUITY")).toBe(3);
    expect(reservedQuantityFrom(open, "NSE:B:EQUITY")).toBe(0);
  });

  it("replays the ledger to exactly the account balances", () => {
    const buy = evaluate({ request: request({ quantity: 10 }) });
    if (buy.status !== "FILLED") throw new Error("expected a fill");
    const sell = evaluate({
      request: request({ side: "SELL", quantity: 4 }),
      position: buy.position,
      eligible: eligible({ bid: 104, price: 104 }),
    });
    if (sell.status !== "FILLED") throw new Error("expected a fill");

    const replayed = replayLedger(100_000, [
      {
        kind: "BUY",
        quantity: buy.quantity,
        price: buy.fillPrice,
        cashDelta: buy.cashDelta,
        realizedPnl: buy.realizedPnl,
      },
      {
        kind: "SELL",
        quantity: sell.quantity,
        price: sell.fillPrice,
        cashDelta: sell.cashDelta,
        realizedPnl: sell.realizedPnl,
      },
    ]);

    const summary = summarizePortfolio({
      account: account({
        availableCash: roundMoney(100_000 + buy.cashDelta + sell.cashDelta),
        realizedPnl: sell.realizedPnl,
      }),
      positions: [
        {
          instrumentId: "NSE:TEST:EQUITY",
          quantity: sell.position.quantity,
          costBasis: sell.position.costBasis,
          price: 104,
          mode: "SAMPLE",
          source: "sample",
          quoteTime: NOW,
        },
      ],
      reservedCash: 0,
    });

    expect(replayed.cash).toBe(summary.totals.availableCash);
    expect(replayed.realizedPnl).toBe(summary.totals.realizedPnl);
    expect(summary.totals.investedCost).toBe(sell.position.costBasis);
  });
});

/* ------------------------------------------------------------------ */
/* State machine                                                       */
/* ------------------------------------------------------------------ */

describe("order state transitions", () => {
  it("allows only documented transitions", () => {
    expect(canTransition("PENDING", "OPEN")).toBe(true);
    expect(canTransition("PENDING", "FILLED")).toBe(true);
    expect(canTransition("PENDING", "REJECTED")).toBe(true);
    expect(canTransition("OPEN", "FILLED")).toBe(true);
    expect(canTransition("OPEN", "CANCELLED")).toBe(true);

    expect(canTransition("OPEN", "REJECTED")).toBe(false);
    expect(canTransition("FILLED", "OPEN")).toBe(false);
    expect(canTransition("FILLED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "FILLED")).toBe(false);
    expect(canTransition("REJECTED", "FILLED")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Freshness labels                                                    */
/* ------------------------------------------------------------------ */

describe("fill price labels", () => {
  it("keeps a fresh provider tick LIVE but downgrades stale ones to CACHED", () => {
    expect(
      fillModeFor({ quotedMode: "LIVE", quoteFetchedAt: NOW - 1_000, quoteTime: NOW - 1_000, nowMs: NOW })
    ).toBe("LIVE");
    expect(
      fillModeFor({
        quotedMode: "LIVE",
        quoteFetchedAt: NOW - MAX_FILL_QUOTE_AGE_MS - 1,
        quoteTime: NOW,
        nowMs: NOW,
      })
    ).toBe("CACHED");
    // Old provider tick even though the row was read recently.
    expect(
      fillModeFor({
        quotedMode: "LIVE",
        quoteFetchedAt: NOW,
        quoteTime: NOW - MAX_FILL_QUOTE_AGE_MS - 1,
        nowMs: NOW,
      })
    ).toBe("CACHED");
  });

  it("never treats a historical series as a tradable live price", () => {
    expect(
      fillModeFor({ quotedMode: "HISTORICAL", quoteFetchedAt: NOW, quoteTime: NOW, nowMs: NOW })
    ).toBe("CACHED");
    expect(
      fillModeFor({ quotedMode: "DELAYED", quoteFetchedAt: NOW, quoteTime: NOW, nowMs: NOW })
    ).toBe("DELAYED");
    expect(
      fillModeFor({ quotedMode: "SAMPLE", quoteFetchedAt: NOW, quoteTime: NOW, nowMs: NOW })
    ).toBe("SAMPLE");
  });

  it("prefers a provider quote and only falls back to a labelled sample price", () => {
    const stored = {
      price: 250,
      bid: 249.9,
      ask: 250.1,
      mode: "DELAYED" as const,
      source: "fyers",
      quoteTime: NOW,
      fetchedAt: NOW,
    };
    const sample = { price: 100, bid: 99.9, ask: 100.1, quoteTime: NOW };

    const provider = selectFillPrice({
      stored,
      sample,
      sampleFillsEnabled: true,
      nowMs: NOW,
    });
    expect(provider?.source).toBe("fyers");
    expect(provider?.price).toBe(250);
    expect(provider?.mode).toBe("DELAYED");

    const noSample = selectFillPrice({
      stored: null,
      sample,
      sampleFillsEnabled: false,
      nowMs: NOW,
    });
    expect(noSample).toBeNull();

    const fallback = selectFillPrice({
      stored: null,
      sample,
      sampleFillsEnabled: true,
      nowMs: NOW,
    });
    expect(fallback?.mode).toBe("SAMPLE");
    expect(fallback?.source).toBe("sample");

    // A stored row that claims to be sample must not masquerade as provider data.
    const storedSample = selectFillPrice({
      stored: { ...stored, source: "sample" },
      sample,
      sampleFillsEnabled: true,
      nowMs: NOW,
    });
    expect(storedSample?.mode).toBe("SAMPLE");
  });

  it("documents that sample fills are enabled only for this demo simulation", () => {
    expect(SAMPLE_FILLS_ENABLED).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Portfolio summary                                                   */
/* ------------------------------------------------------------------ */

describe("portfolio valuation", () => {
  it("computes invested cost, market value and P&L, and inherits the weakest label", () => {
    const { positions, totals } = summarizePortfolio({
      account: account({ availableCash: 90_000, realizedPnl: 250 }),
      positions: [
        {
          instrumentId: "NSE:A:EQUITY",
          quantity: 10,
          costBasis: 1000,
          price: 110,
          mode: "LIVE",
          source: "fyers",
          quoteTime: NOW,
        },
        {
          instrumentId: "NSE:B:EQUITY",
          quantity: 5,
          costBasis: 500,
          price: 90,
          mode: "SAMPLE",
          source: "sample",
          quoteTime: NOW,
        },
      ],
      reservedCash: 1000,
    });

    expect(positions).toHaveLength(2);
    expect(positions[0].marketValue).toBe(1100);
    expect(positions[0].unrealizedPnl).toBe(100);
    expect(positions[0].unrealizedPercent).toBe(10);
    expect(positions[1].unrealizedPnl).toBe(-50);

    expect(totals.investedCost).toBe(1500);
    expect(totals.marketValue).toBe(1550);
    expect(totals.unrealizedPnl).toBe(50);
    expect(totals.equity).toBe(91_550);
    expect(totals.realizedPnl).toBe(250);
    expect(totals.totalPnl).toBe(300);
    expect(totals.totalReturnPercent).toBe(0.3);
    expect(totals.spendableCash).toBe(89_000);
    // One sample-priced holding makes the whole valuation SAMPLE, not LIVE.
    expect(totals.mode).toBe("SAMPLE");
  });

  it("reports no overall label for an empty portfolio", () => {
    const { positions, totals } = summarizePortfolio({
      account: account(),
      positions: [],
      reservedCash: 0,
    });
    expect(positions).toEqual([]);
    expect(totals.mode).toBeNull();
    expect(totals.equity).toBe(100_000);
    expect(totals.totalPnl).toBe(0);
  });

  it("drops zero-quantity rows from valuations", () => {
    const { positions } = summarizePortfolio({
      account: account(),
      positions: [
        {
          instrumentId: "NSE:A:EQUITY",
          quantity: 0,
          costBasis: 0,
          price: 100,
          mode: "SAMPLE",
          source: "sample",
          quoteTime: NOW,
        },
      ],
      reservedCash: 0,
    });
    expect(positions).toHaveLength(0);
  });
});

describe("rounding", () => {
  it("rounds rupees to 2 decimals and keeps ratios at 4", () => {
    expect(roundMoney(1234.567)).toBe(1234.57);
    expect(roundMoney(-1234.567)).toBe(-1234.57);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundRatio(1 / 3)).toBe(0.3333);
    expect(roundMoney(Number.NaN)).toBe(0);
  });
});
