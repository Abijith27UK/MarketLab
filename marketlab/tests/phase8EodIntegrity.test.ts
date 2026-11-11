import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eodSafeMode,
  featureDataModes,
  isCandleCacheFresh,
  isEndOfDaySource,
  isGenuineDatasetCandidate,
  isSamplePricedRow,
} from "../convex/market/provenance";
import { normalizeCandles, findGaps } from "../convex/market/normalize";
import { sma, rsi, latestDefined } from "../convex/market/indicators";
import { sampleCandleFallback } from "../convex/market/fallback";
import { sampleQuote } from "../convex/market/sample";
import { istDateToUtcMs } from "../convex/market/time";
import { INTERVAL_MS } from "../convex/market/types";
import { evaluateOrder, selectFillPrice, type EligiblePrice } from "../convex/paperCore/engine";
import { planAlertEvaluation } from "../convex/alertsCore";
import { provider as tejhq } from "../convex/market/providers/tejhq";
import type { NormalizedInstrument } from "../convex/market/types";

/**
 * Phase 8 — end-of-day data integrity.
 *
 * Every rule here protects the same claim: TejHQ data is real, daily and
 * historical, and it is never dressed up as a live quote, an intraday bar or a
 * tradable price. All provider calls are mocked; the live endpoints were verified
 * separately against api.tejhq.dev.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as Response;

const mockFetch = (handler: (url: string) => Response | Promise<Response>) => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
  globalThis.fetch = fetchMock as never;
  return fetchMock;
};

const bseInstrument: NormalizedInstrument = {
  instrumentId: "BSE:TCS:EQUITY",
  symbol: "TCS",
  tradingSymbol: "BSE:TCS",
  name: "Tata Consultancy Services",
  exchange: "BSE",
  instrumentType: "EQUITY",
  segment: "A",
  providerIds: { tejhq: "TCS" },
  isin: null,
  tickSize: null,
  lotSize: null,
  isActive: true,
  source: "tejhq",
  isSampleData: false,
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe("EOD provenance rules", () => {
  it("treats TejHQ as an end-of-day source and never upgrades it to LIVE", () => {
    expect(isEndOfDaySource("tejhq")).toBe(true);
    expect(isEndOfDaySource("fyers")).toBe(false);
    expect(eodSafeMode("LIVE", "tejhq")).toBe("DELAYED");
    expect(eodSafeMode("DELAYED", "tejhq")).toBe("DELAYED");
    expect(eodSafeMode("LIVE", "fyers")).toBe("LIVE");
  });

  it("accepts only genuine cached or owner-imported datasets for a REAL_ONLY run", () => {
    const userA = "user_a";
    const userB = "user_b";

    expect(
      isGenuineDatasetCandidate({ kind: "cache", source: "tejhq" }, userA)
    ).toBe(true);
    // Cross-user: another account's CSV import is invisible.
    expect(
      isGenuineDatasetCandidate({ kind: "import", source: "csv_import", ownerId: userA }, userB)
    ).toBe(false);
    expect(
      isGenuineDatasetCandidate({ kind: "import", source: "csv_import", ownerId: userA }, userA)
    ).toBe(true);
    expect(isGenuineDatasetCandidate({ kind: "cache", source: "sample" }, userA)).toBe(false);
  });

  it("identifies SAMPLE-priced screener rows from a missing quote or a SAMPLE label", () => {
    expect(isSamplePricedRow({ hasStoredQuote: false, mode: null })).toBe(true);
    expect(isSamplePricedRow({ hasStoredQuote: true, mode: "SAMPLE" })).toBe(true);
    expect(isSamplePricedRow({ hasStoredQuote: true, mode: "DELAYED" })).toBe(false);
    expect(isSamplePricedRow({ hasStoredQuote: true, mode: "HISTORICAL" })).toBe(false);
  });
});

describe("Daily candle retrieval, normalisation and caching", () => {
  it("returns BSE daily bars as HISTORICAL with no fabricated intraday rows", async () => {
    mockFetch(() =>
      jsonResponse({
        data: [
          { date: "2026-10-28", open: 2490, high: 2510, low: 2480, close: 2500, volume: 1000 },
          { date: "2026-10-29", open: 2500, high: 2520, low: 2495, close: 2510, volume: 1200 },
        ],
      })
    );

    const raw = await tejhq.fetchCandles?.(
      {},
      {
        instrument: bseInstrument,
        interval: "1d",
        fromMs: istDateToUtcMs("2026-10-26"),
        toMs: istDateToUtcMs("2026-10-30"),
      }
    );
    const { candles } = normalizeCandles(raw ?? []);

    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({
      instrumentId: "BSE:TCS:EQUITY",
      interval: "1d",
      source: "tejhq",
      mode: "HISTORICAL",
      ts: istDateToUtcMs("2026-10-28"),
    });
    // No 1m/5m/1h bars appear anywhere: the daily series is not resampled.
    expect(new Set(candles.map((candle) => candle.interval))).toEqual(new Set(["1d"]));
    expect(findGaps(candles, "1d").count).toBe(0);
  });

  it("reuses a young cache and refetches once its newest bar is stale", () => {
    const nowMs = istDateToUtcMs("2026-10-30") + 12 * 60 * 60 * 1000;
    const fresh = {
      kind: "cache" as const,
      updatedAt: nowMs - 10 * 60_000,
      lastTs: istDateToUtcMs("2026-10-30"),
      rowCount: 500,
    };
    const context = {
      nowMs,
      toMs: istDateToUtcMs("2026-10-30"),
      intervalMs: INTERVAL_MS["1d"],
      ttlMs: 30 * 60_000,
    };

    expect(isCandleCacheFresh(fresh, context)).toBe(true);
    expect(isCandleCacheFresh({ ...fresh, updatedAt: nowMs - 6 * 60 * 60_000 }, context)).toBe(
      false
    );
    expect(
      isCandleCacheFresh(
        { ...fresh, lastTs: istDateToUtcMs("2026-10-20") },
        context
      )
    ).toBe(false);
    expect(isCandleCacheFresh({ ...fresh, rowCount: 0 }, context)).toBe(false);
    // A user's own import is always preferred over refetching.
    expect(
      isCandleCacheFresh(
        { ...fresh, kind: "import", updatedAt: 0, lastTs: istDateToUtcMs("2019-01-01") },
        context
      )
    ).toBe(true);
  });

  it("computes indicators from the real historical closes", () => {
    const closes = Array.from({ length: 40 }, (_, index) => 100 + index);
    const candles = closes.map((close, index) => ({
      instrumentId: "NSE:RELIANCE:EQUITY",
      interval: "1d" as const,
      ts: istDateToUtcMs("2026-08-01") + index * DAY_MS,
      open: close - 1,
      high: close + 1,
      low: close - 2,
      close,
      volume: 1000,
      source: "tejhq" as const,
      mode: "HISTORICAL" as const,
      adjusted: "unknown" as const,
    }));

    const average = latestDefined(sma(candles.map((candle) => candle.close), 5));
    expect(average).toBeCloseTo((135 + 136 + 137 + 138 + 139) / 5, 6);
    const strength = latestDefined(rsi(candles.map((candle) => candle.close), 14));
    expect(strength).not.toBeNull();
    expect(strength!).toBeGreaterThan(99);
    expect(strength!).toBeLessThanOrEqual(100);
  });
});

describe("REAL_ONLY backtests with TejHQ data", () => {
  it("reports HISTORICAL availability only when real bars are stored", () => {
    const withHistory = featureDataModes(
      {
        providerQuotes: 4,
        eodQuotes: 4,
        cachedCandleSeries: 4,
        importedCandleSeries: 0,
        latestQuoteSessionDate: "2026-10-30",
        latestCandleDate: "2026-10-30",
        candleSources: ["tejhq"],
      },
      ["1d"]
    );
    const backtests = withHistory.find((feature) => feature.key === "backtests");
    expect(backtests?.mode).toBe("HISTORICAL");
    expect(backtests?.detail).toContain("2026-10-30");

    const withoutHistory = featureDataModes(
      {
        providerQuotes: 0,
        eodQuotes: 0,
        cachedCandleSeries: 0,
        importedCandleSeries: 0,
        latestQuoteSessionDate: null,
        latestCandleDate: null,
        candleSources: [],
      },
      ["1d"]
    );
    expect(withoutHistory.find((feature) => feature.key === "backtests")?.mode).toBe("SAMPLE");
    expect(withoutHistory.find((feature) => feature.key === "charts")?.mode).toBe("SAMPLE");
    expect(withoutHistory.find((feature) => feature.key === "paper")?.mode).toBe("SAMPLE");
  });

  it("flags paper fills and alerts as unavailable when every stored price is EOD", () => {
    const features = featureDataModes(
      {
        providerQuotes: 4,
        eodQuotes: 4,
        cachedCandleSeries: 4,
        importedCandleSeries: 0,
        latestQuoteSessionDate: "2026-10-30",
        latestCandleDate: "2026-10-30",
        candleSources: ["tejhq"],
      },
      ["1d"]
    );
    expect(features.find((feature) => feature.key === "paper")?.mode).toBe("UNAVAILABLE");
    expect(features.find((feature) => feature.key === "alerts")?.mode).toBe("UNAVAILABLE");
    expect(features.find((feature) => feature.key === "intraday")?.mode).toBe("UNAVAILABLE");
    // Quotes themselves are still usable for display, labelled DELAYED.
    expect(features.find((feature) => feature.key === "quotes")?.mode).toBe("DELAYED");
  });
});

describe("Paper execution and alerts reject EOD prices", () => {
  const nowMs = Date.now();
  const eodPrice: EligiblePrice = {
    price: 1164.9,
    bid: null,
    ask: null,
    mode: "DELAYED",
    source: "tejhq",
    quoteTime: nowMs - DAY_MS,
    fetchedAt: nowMs,
    eod: true,
  };
  const delayedIntradayPrice: EligiblePrice = {
    price: 1166.2,
    bid: 1166.1,
    ask: 1166.3,
    mode: "DELAYED",
    source: "fyers",
    quoteTime: nowMs - 60_000,
    fetchedAt: nowMs,
    eod: false,
  };
  const account = { startingCapital: 100_000, availableCash: 100_000, realizedPnl: 0 };
  const request = {
    clientOrderId: "order-1",
    instrumentId: "NSE:RELIANCE:EQUITY",
    instrumentType: "EQUITY" as const,
    side: "BUY" as const,
    orderType: "MARKET" as const,
    quantity: 1,
    limitPrice: null,
  };

  it("labels a stored TejHQ price as EOD in selectFillPrice", () => {
    const selected = selectFillPrice({
      stored: {
        price: 1164.9,
        bid: null,
        ask: null,
        mode: "DELAYED",
        source: "tejhq",
        quoteTime: nowMs - DAY_MS,
        fetchedAt: nowMs,
      },
      sample: null,
      sampleFillsEnabled: true,
      nowMs,
    });
    expect(selected?.eod).toBe(true);
  });

  it("rejects every order type while only an EOD close is available", () => {
    const result = evaluateOrder({
      request,
      account,
      position: null,
      eligible: eodPrice,
      reservedCash: 0,
      reservedQuantity: 0,
    });
    expect(result.status).toBe("REJECTED");
    expect(result.status === "REJECTED" && result.reason).toMatch(/end-of-day/i);

    const resting = evaluateOrder({
      request: { ...request, orderType: "LIMIT", limitPrice: 1200 },
      account,
      position: null,
      eligible: eodPrice,
      reservedCash: 0,
      reservedQuantity: 0,
    });
    expect(resting.status).toBe("REJECTED");
  });

  it("still fills against a fresh delayed quote, so order safety is unchanged", () => {
    const result = evaluateOrder({
      request,
      account,
      position: null,
      eligible: delayedIntradayPrice,
      reservedCash: 0,
      reservedQuantity: 0,
    });
    expect(result.status).toBe("FILLED");
    expect(result.status === "FILLED" && result.fillPrice).toBe(1166.3);
  });

  it("records an EOD quote as an alert observation but never fires it", () => {
    const plan = planAlertEvaluation(
      [
        {
          _id: "alert-1",
          instrumentId: "NSE:RELIANCE:EQUITY",
          direction: "ABOVE",
          threshold: 1000,
          status: "ACTIVE",
        },
      ],
      new Map([
        ["NSE:RELIANCE:EQUITY", { lastPrice: 1164.9, mode: "DELAYED", source: "tejhq", eod: true }],
      ])
    );

    expect(plan.observations).toHaveLength(1);
    expect(plan.observations[0].crossed).toBe(false);
    expect(plan.observations[0].price).toBe(1164.9);
    expect(plan.skippedEod).toBe(1);
    expect(plan.skippedStale).toBe(0);
  });

  it("still fires a delayed intraday crossing", () => {
    const plan = planAlertEvaluation(
      [
        {
          _id: "alert-1",
          instrumentId: "NSE:RELIANCE:EQUITY",
          direction: "ABOVE",
          threshold: 1000,
          status: "ACTIVE",
        },
      ],
      new Map([
        [
          "NSE:RELIANCE:EQUITY",
          { lastPrice: 1166.2, mode: "DELAYED", source: "fyers", eod: false },
        ],
      ])
    );
    expect(plan.observations[0].crossed).toBe(true);
    expect(plan.skippedEod).toBe(0);
  });
});

describe("Provider failure never produces a REAL label", () => {
  it("rejects the request and leaves the fallback labelled SAMPLE", async () => {
    mockFetch(() => jsonResponse({ error: "upstream unavailable" }, 503));

    await expect(
      tejhq.fetchCandles?.(
        {},
        {
          instrument: bseInstrument,
          interval: "1d",
          fromMs: istDateToUtcMs("2026-10-26"),
          toMs: istDateToUtcMs("2026-10-30"),
        }
      )
    ).rejects.toBeTruthy();

    const fallback = sampleCandleFallback({
      instrument: { instrumentId: bseInstrument.instrumentId, symbol: bseInstrument.symbol },
      interval: "1d",
      fromMs: istDateToUtcMs("2026-10-26"),
      toMs: istDateToUtcMs("2026-10-30"),
      nowMs: istDateToUtcMs("2026-10-30"),
      maxCandles: 100,
    });
    expect(fallback.mode).toBe("SAMPLE");
    expect(fallback.source).toBe("sample");
    expect(fallback.candles.every((candle) => candle.mode === "SAMPLE")).toBe(true);

    const quote = sampleQuote(
      {
        instrumentId: "NSE:RELIANCE:EQUITY",
        symbol: "RELIANCE",
        exchange: "NSE",
        name: "Reliance Industries",
      },
      istDateToUtcMs("2026-10-30")
    );
    expect(quote.mode).toBe("SAMPLE");
    expect(quote.source).toBe("sample");
  });
});
