import { describe, expect, it } from "vitest";
import {
  classifyCandleMode,
  classifyQuoteMode,
  findGaps,
  normalizeCandles,
  normalizeQuote,
  redactError,
} from "../convex/market/normalize";
import { parseFyersInstrumentCsv, provider as fyers } from "../convex/market/providers/fyers";
import { provider as breeze } from "../convex/market/providers/breeze";
import { provider as tapetide } from "../convex/market/providers/tapetide";
import { availableIntervals, providerFor, providerStatuses, supports } from "../convex/market/registry";
import { sampleCandles, sampleQuote } from "../convex/market/sample";
import { istDateToUtcMs } from "../convex/market/time";
import type { NormalizedCandle } from "../convex/market/types";

const candle = (overrides: Partial<NormalizedCandle> = {}): NormalizedCandle => ({
  instrumentId: "NSE:SBIN:EQUITY",
  interval: "1d",
  ts: istDateToUtcMs("2024-01-29"),
  open: 100,
  high: 110,
  low: 95,
  close: 105,
  volume: 1000,
  source: "fyers",
  mode: "HISTORICAL",
  adjusted: "unknown",
  ...overrides,
});

describe("candle normalization", () => {
  it("drops invalid candles and reports why", () => {
    const result = normalizeCandles([
      candle(),
      candle({ ts: istDateToUtcMs("2024-01-30"), high: 90 }),
      candle({ ts: 0 }),
    ]);
    expect(result.candles).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0].reason).toMatch(/high below/);
  });

  it("de-duplicates timestamps and sorts ascending", () => {
    const day2 = istDateToUtcMs("2024-01-30");
    const result = normalizeCandles([
      candle({ ts: day2, close: 106 }),
      candle({ ts: istDateToUtcMs("2024-01-29") }),
      candle({ ts: day2, close: 108 }),
    ]);
    expect(result.candles.map((row) => row.close)).toEqual([105, 108]);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("detects a long hole in a daily series", () => {
    const day1 = istDateToUtcMs("2024-01-29");
    // Ten calendar days later: nine absent sessions, far more than any weekend.
    const day11 = istDateToUtcMs("2024-02-08");
    const gaps = findGaps([candle({ ts: day1 }), candle({ ts: day11 })], "1d");
    expect(gaps.count).toBe(9);
    expect(gaps.firstFew[0]).toBe(day1 + 24 * 60 * 60 * 1000);
  });

  it("does not report weekends or festival breaks as missing daily data", () => {
    const friday = istDateToUtcMs("2024-01-26");
    const tuesday = istDateToUtcMs("2024-01-30");
    const gaps = findGaps([candle({ ts: friday }), candle({ ts: tuesday })], "1d");
    expect(gaps.count).toBe(0);
  });

  it("still reports every mid-session hole for intraday intervals", () => {
    const start = istDateToUtcMs("2024-01-29") + 9 * 60 * 60 * 1000;
    const gaps = findGaps(
      [candle({ ts: start }), candle({ ts: start + 3 * 60 * 60 * 1000 })],
      "1h"
    );
    expect(gaps.count).toBe(2);
  });

  it("does not invent gaps for weekly or monthly buckets", () => {
    const gaps = findGaps(
      [candle({ ts: 0 + 1 }), candle({ ts: 40 * 24 * 60 * 60 * 1000 })],
      "1w"
    );
    expect(gaps.count).toBe(0);
  });
});

describe("quote normalization", () => {
  it("derives change values from the previous close when absent", () => {
    const quote = normalizeQuote(
      {
        instrumentId: "NSE:SBIN:EQUITY",
        symbol: "SBIN",
        exchange: "NSE",
        lastPrice: 110,
        change: null,
        changePercent: null,
        open: null,
        high: null,
        low: null,
        previousClose: 100,
        volume: null,
        bid: null,
        ask: null,
        quoteTime: null,
        source: "fyers",
      },
      "LIVE"
    );
    expect(quote.change).toBe(10);
    expect(quote.changePercent).toBeCloseTo(10, 5);
  });

  it("rejects quotes without a last price", () => {
    expect(() =>
      normalizeQuote(
        {
          instrumentId: "x",
          symbol: "x",
          exchange: "NSE",
          lastPrice: null as unknown as number,
          change: null,
          changePercent: null,
          open: null,
          high: null,
          low: null,
          previousClose: null,
          volume: null,
          bid: null,
          ask: null,
          quoteTime: null,
          source: "fyers",
        },
        "LIVE"
      )
    ).toThrow(/last traded price/);
  });
});

describe("freshness labelling", () => {
  const base = {
    source: "fyers" as const,
    quoteTime: 1_000_000,
    fetchedAt: 1_000_000,
    nowMs: 1_000_000,
    ttlMs: 180_000,
    marketOpen: true,
    maxLiveAgeMs: 120_000,
  };

  it("labels a fresh in-session tick LIVE", () => {
    expect(classifyQuoteMode(base)).toBe("LIVE");
  });

  it("never labels sample data as LIVE", () => {
    expect(classifyQuoteMode({ ...base, source: "sample" })).toBe("SAMPLE");
  });

  it("never labels stale cache as LIVE", () => {
    expect(
      classifyQuoteMode({ ...base, nowMs: base.fetchedAt + 10 * 60_000 })
    ).toBe("CACHED");
  });

  it("downgrades an old tick to DELAYED even when the cache is fresh", () => {
    const now = base.quoteTime + 5 * 60_000;
    expect(classifyQuoteMode({ ...base, nowMs: now, fetchedAt: now })).toBe("DELAYED");
  });

  it("does not call a quote LIVE when the market is closed", () => {
    expect(classifyQuoteMode({ ...base, marketOpen: false })).toBe("CACHED");
  });

  it("respects providers that declare delayed data", () => {
    expect(classifyQuoteMode({ ...base, providerMode: "DELAYED" })).toBe("DELAYED");
  });

  it("labels provider candles HISTORICAL and sample candles SAMPLE", () => {
    expect(classifyCandleMode("fyers")).toBe("HISTORICAL");
    expect(classifyCandleMode("sample")).toBe("SAMPLE");
  });
});

describe("error redaction", () => {
  it("removes tokens, query strings and truncates", () => {
    const message = redactError(
      'Request failed: access_token=eyJhbGciOiJIUzI1NiJ9.payload.signature&symbol=SBIN https://api.example.com/data?token=abc123'
    );
    expect(message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(message).not.toContain("abc123");
    expect(message).toContain("<redacted");
  });
});

describe("provider configuration", () => {
  it("reports every missing env var without leaking values", () => {
    const statuses = providerStatuses({});
    // Four credentialed/EOD providers plus the flag-gated NSE MCP experiment.
    expect(statuses).toHaveLength(5);
    // TejHQ is keyless, so it is the one provider that is usable with no
    // environment at all; every credentialed provider must still list what it
    // is missing.
    const keyless = statuses.find((status) => status.providerId === "tejhq");
    expect(keyless?.configured).toBe(true);
    expect(keyless?.missingEnv).toEqual([]);
    for (const status of statuses.filter((entry) => entry.providerId !== "tejhq")) {
      expect(status.configured).toBe(false);
      expect(status.missingEnv.length).toBeGreaterThan(0);
    }
    const fyersStatus = statuses.find((status) => status.providerId === "fyers");
    expect(fyersStatus?.missingEnv).toEqual(
      expect.arrayContaining(["FYERS_APP_ID", "FYERS_SECRET_ID", "FYERS_ACCESS_TOKEN"])
    );
    // NSE MCP is opt-in: absent flag means not configured, never "ready".
    const nseStatus = statuses.find((status) => status.providerId === "nsemcp");
    expect(nseStatus?.configured).toBe(false);
    expect(nseStatus?.missingEnv).toEqual(["NSE_MCP_POC_ENABLED"]);
  });

  it("falls back to the keyless provider when no credentials are configured", () => {
    expect(providerFor({}, "quotes")?.id).toBe("tejhq");
    expect(providerFor({}, "candles", "1d")?.id).toBe("tejhq");
    expect(availableIntervals({})).toEqual(["1d"]);
    // Capabilities the keyless tier does not offer must stay unselected.
    expect(providerFor({}, "fundamentals")).toBeNull();
    expect(providerFor({}, "candles", "15m")).toBeNull();
  });

  it("routes to the explicitly preferred quote provider only when it is available", () => {
    expect(providerFor({}, "quotes", undefined, "tejhq")?.id).toBe("tejhq");
    // Flag disabled: the preference cannot win; the caller falls back to TejHQ
    // and reports it rather than showing NSE prices under a TejHQ label.
    expect(providerFor({}, "quotes", undefined, "nsemcp")?.id).toBe("tejhq");
    expect(
      providerFor({ NSE_MCP_POC_ENABLED: "true" }, "quotes", undefined, "nsemcp")?.id
    ).toBe("nsemcp");
    // NSE history is available only when explicitly selected; an unqualified
    // candle request keeps TejHQ so existing charts and backtests are unchanged.
    expect(providerFor({ NSE_MCP_POC_ENABLED: "true" }, "candles", "1d")?.id).toBe("tejhq");
    expect(
      providerFor({ NSE_MCP_POC_ENABLED: "true" }, "candles", "1d", "nsemcp")?.id
    ).toBe("nsemcp");
    // Still no intraday history and no bulk master sync from NSE MCP.
    expect(
      providerFor({ NSE_MCP_POC_ENABLED: "true" }, "candles", "15m", "nsemcp")?.id
    ).not.toBe("nsemcp");
    expect(providerFor({ NSE_MCP_POC_ENABLED: "true" }, "instrumentSync")?.id).toBe("tejhq");
  });

  it("selects only providers that declare the capability and interval", () => {
    expect(supports(fyers, "candles", "15m")).toBe(true);
    expect(supports(breeze, "candles", "15m")).toBe(false);
    expect(supports(breeze, "candles", "1d")).toBe(true);
    expect(supports(tapetide, "fundamentals")).toBe(true);
    expect(supports(tapetide, "candles", "1d")).toBe(false);
  });

  it("refuses an unsupported Breeze interval instead of resampling", async () => {
    await expect(
      breeze.fetchCandles?.(
        { BREEZE_APP_KEY: "k", BREEZE_SECRET_KEY: "s", BREEZE_SESSION_TOKEN: "t" },
        {
          instrument: {
            instrumentId: "NSE:SBIN:EQUITY",
            symbol: "SBIN",
            tradingSymbol: "NSE:SBIN-EQ",
            name: "State Bank of India",
            exchange: "NSE",
            instrumentType: "EQUITY",
            segment: "CM",
            providerIds: {},
            isin: null,
            tickSize: null,
            lotSize: null,
            isActive: true,
            source: "breeze",
            isSampleData: false,
          },
          interval: "15m",
          fromMs: 0,
          toMs: 1,
        }
      )
    ).rejects.toThrow(/does not serve 15m/);
  });

  it("reports a clear message when a provider is not configured", async () => {
    const result = await fyers.testConnection({});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Not configured/);
  });
});

/**
 * Synthetic fixture following the documented FYERS sym_details shape
 * (headerless CSV). The parser detects columns by value shape, not by index.
 */
function buildFyersCsv(rows = 20): string {
  const lines: string[] = [];
  for (let index = 0; index < rows; index += 1) {
    const symbol = `SYM${String(index).padStart(2, "0")}`;
    lines.push(
      [
        `1010000000${String(index).padStart(4, "0")}`,
        `NSE:${symbol}-EQ`,
        1,
        0.05,
        `INE${String(index).padStart(3, "0")}A01010`,
        `Sample Company Number ${index}`,
      ].join(",")
    );
  }
  return lines.join("\n");
}

describe("FYERS instrument master parsing", () => {
  it("detects the trading symbol, ISIN, lot, tick and name columns", () => {
    const instruments = parseFyersInstrumentCsv(buildFyersCsv(), "NSE", 100);
    expect(instruments).toHaveLength(20);
    const first = instruments[0];
    expect(first.symbol).toBe("SYM00");
    expect(first.tradingSymbol).toBe("NSE:SYM00-EQ");
    expect(first.lotSize).toBe(1);
    expect(first.tickSize).toBe(0.05);
    expect(first.isin).toBe("INE000A01010");
    expect(first.name).toBe("Sample Company Number 0");
    expect(first.providerIds.fyers).toBe("NSE:SYM00-EQ");
    expect(first.exchange).toBe("NSE");
  });

  it("aborts instead of returning partial data when the layout is unknown", () => {
    expect(() => parseFyersInstrumentCsv("a,b,c\n1,2,3", "NSE")).toThrow(/truncated/);
    const unrecognisable = Array.from({ length: 20 }, (_, index) => `row,${index},x`).join("\n");
    expect(() => parseFyersInstrumentCsv(unrecognisable, "NSE")).toThrow(
      /trading-symbol column/
    );
  });
});

describe("sample fallback", () => {
  const from = istDateToUtcMs("2024-01-01");
  const to = istDateToUtcMs("2024-03-01");

  it("is deterministic and always labelled SAMPLE", () => {
    const first = sampleCandles({ symbol: "SBIN", interval: "1d", fromMs: from, toMs: to });
    const second = sampleCandles({ symbol: "SBIN", interval: "1d", fromMs: from, toMs: to });
    expect(first.length).toBeGreaterThan(20);
    expect(first[0]).toEqual(second[0]);
    expect(first.every((row) => row.mode === "SAMPLE" && row.source === "sample")).toBe(true);
  });

  it("never emits weekend bars", () => {
    const candles = sampleCandles({ symbol: "SBIN", interval: "1d", fromMs: from, toMs: to });
    for (const row of candles) {
      const day = new Date(row.ts + 5.5 * 3600 * 1000).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("keeps intraday bars inside the 09:15–15:30 IST session", () => {
    const candles = sampleCandles({ symbol: "SBIN", interval: "15m", fromMs: from, toMs: to });
    expect(candles.length).toBeGreaterThan(0);
    for (const row of candles.slice(0, 50)) {
      const ist = new Date(row.ts + 5.5 * 3600 * 1000);
      const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
      expect(minutes).toBeGreaterThanOrEqual(9 * 60 + 15);
      expect(minutes).toBeLessThan(15 * 60 + 30);
    }
  });

  it("produces a SAMPLE quote that is never LIVE", () => {
    const quote = sampleQuote(
      { instrumentId: "NSE:SBIN:EQUITY", symbol: "SBIN", exchange: "NSE", name: "SBI" },
      Date.now()
    );
    expect(quote.mode).toBe("SAMPLE");
    expect(quote.source).toBe("sample");
    expect(quote.lastPrice).toBeGreaterThan(0);
  });
});
