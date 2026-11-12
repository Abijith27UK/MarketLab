import { describe, expect, it } from "vitest";
import {
  normalizeLiveIndices,
  normalizeNseMarketMovers,
  parseIsoTimestamp,
  sanitizeQuoteTime,
} from "../convex/market/providers/nsemcp";
import {
  DASHBOARD_INDEX_DEFINITIONS,
  DASHBOARD_INDEX_IDS,
  indexDefinitionFor,
  nseIndexName,
} from "../convex/market/indexCatalogue";
import { indexDefinitionToInstrument } from "../convex/market/indexCatalogue";
import {
  MARKET_MOVERS_CACHE_KEY,
  MARKET_MOVERS_SOURCE,
  MARKET_MOVERS_UNIVERSE,
} from "../convex/marketMovers";

/** Shape observed live from `cm_get_live_indices` on 2026-11-12. */
const indicesPayload = {
  nseTimestamp: "12-Nov-2026 15:30:00",
  updatedAt: "2026-11-12T10:00:00.000Z",
  returned: 3,
  indices: {
    derivatives: [
      {
        indexName: "NIFTY 50",
        last: 25233.2,
        previousClose: 25255.05,
        change: -21.85,
        percChange: -0.09,
        open: 25213.5,
        high: 25384.8,
        low: 25142.95,
        timeVal: "12-Nov-2026 15:29",
      },
      {
        indexName: "NIFTY BANK",
        last: 58123.4,
        previousClose: 57900.1,
        change: 223.3,
        percChange: 0.39,
        open: 57950,
        high: 58250,
        low: 57880,
        timeVal: "12-Nov-2026 15:29",
      },
    ],
    sectoral: [
      {
        indexName: "NIFTY IT",
        last: 40123.55,
        previousClose: 40200,
        change: -76.45,
        percChange: -0.19,
        open: 40200,
        high: 40300,
        low: 40050,
        timeVal: "12-Nov-2026 15:29",
      },
      // Duplicate name across groups must not produce a second quote.
      { indexName: "NIFTY 50", last: 1, previousClose: 1, change: 0, percChange: 0 },
    ],
  },
};

/** Shape observed live from `nse_get_market_movers` on 2026-11-12. */
const moversPayload = {
  segment: "allSec",
  gainersUpdatedAt: "2026-11-12T10:22:18.190244815Z",
  losersUpdatedAt: "2026-11-12T10:22:18.748000197Z",
  gainers: [
    { symbol: "ORCHASP", series: "EQ", ltp: 1.38, prev_price: 1.15, net_price: 20, perChange: 20 },
    { symbol: "PROZONER", series: "EQ", ltp: 63.76, prev_price: 53.14, net_price: 19.98, perChange: 19.98 },
    // Provider order broken here on purpose: sorting must fix it.
    { symbol: "FLEXITUFF", series: "EQ", ltp: 3.85, prev_price: 3.21, net_price: 19.94, perChange: 19.94 },
    { symbol: "ZEROMOVE", series: "EQ", ltp: 10, prev_price: 10, net_price: 0, perChange: 0 },
    { symbol: "BADPCT", series: "EQ", ltp: 10, prev_price: 9, net_price: 1, perChange: Number.NaN },
    { symbol: "ORCHASP", series: "EQ", ltp: 1.38, prev_price: 1.15, net_price: 20, perChange: 20 },
    // SME / trade-to-trade series is a different universe.
    { symbol: "SMESAMPLE", series: "SM", ltp: 50, prev_price: 40, net_price: 10, perChange: 25 },
  ],
  losers: [
    { symbol: "PAGEIND", series: "EQ", ltp: 31850, prev_price: 36570, net_price: -12.91, perChange: -12.91 },
    // A positive return must never survive in Losers.
    { symbol: "POSINLOSERS", series: "EQ", ltp: 11, prev_price: 10, net_price: 1, perChange: 10 },
    { symbol: "LOKESHMACH", series: "EQ", ltp: 369.3, prev_price: 404, net_price: -8.59, perChange: -8.59 },
    { symbol: "SHIVAM-RE1", series: "BE", ltp: 0.63, prev_price: 0.7, net_price: -10, perChange: -10 },
  ],
};

describe("NSE index catalogue", () => {
  it("defines the six verified dashboard indices with stable ids", () => {
    expect(DASHBOARD_INDEX_IDS).toHaveLength(6);
    expect(new Set(DASHBOARD_INDEX_IDS).size).toBe(6);
    expect(DASHBOARD_INDEX_IDS).toEqual(
      expect.arrayContaining([
        "NSE:NIFTY50:INDEX",
        "NSE:BANKNIFTY:INDEX",
        "NSE:NIFTYNEXT50:INDEX",
        "NSE:NIFTYIT:INDEX",
        "NSE:NIFTYMIDCAP50:INDEX",
        "NSE:NIFTYFINSERVICE:INDEX",
      ])
    );
    for (const definition of DASHBOARD_INDEX_DEFINITIONS) {
      expect(definition.nseName.length).toBeGreaterThan(0);
      expect(indexDefinitionFor(indexDefinitionToInstrument(definition).instrumentId)).toEqual(
        definition
      );
    }
  });

  it("uses NSE's own index spelling, not the catalogue symbol", () => {
    const instrument = indexDefinitionToInstrument(DASHBOARD_INDEX_DEFINITIONS[0]);
    expect(instrument.symbol).toBe("NIFTY50");
    expect(nseIndexName(instrument)).toBe("NIFTY 50");
    expect(indexDefinitionToInstrument(DASHBOARD_INDEX_DEFINITIONS[5]).name).toBe(
      "NIFTY FIN SERVICE"
    );
  });

  it("has no duplicate index identities", () => {
    const names = DASHBOARD_INDEX_DEFINITIONS.map((entry) => entry.nseName.toUpperCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("NSE live index normalization", () => {
  it("normalizes levels, movement and provider quote time", () => {
    const quotes = normalizeLiveIndices(indicesPayload);
    expect(quotes).toHaveLength(3);
    const nifty = quotes.find((quote) => quote.indexName === "NIFTY 50")!;
    expect(nifty.lastPrice).toBeCloseTo(25233.2);
    expect(nifty.previousClose).toBeCloseTo(25255.05);
    expect(nifty.change).toBeCloseTo(-21.85);
    expect(nifty.changePercent).toBeCloseTo(-0.09);
    expect(nifty.quoteTime).not.toBeNull();
    // timeVal is IST (15:29) and must parse as such, not as a host-local time.
    expect(new Date(nifty.quoteTime!).toISOString()).toBe("2026-11-12T09:59:00.000Z");
  });

  it("derives the percentage only when the provider omitted it", () => {
    const quotes = normalizeLiveIndices({
      indices: {
        derivatives: [
          { indexName: "NIFTY 50", last: 110, previousClose: 100, change: 10 },
        ],
      },
    });
    expect(quotes[0].changePercent).toBeCloseTo(10);
  });

  it("drops rows without a usable level instead of inventing one", () => {
    const quotes = normalizeLiveIndices({
      indices: {
        derivatives: [
          { indexName: "NIFTY 50", last: null },
          { indexName: "NIFTY BANK", last: 0 },
          { indexName: "", last: 100 },
          { indexName: "NIFTY IT", last: 40123.55 },
        ],
      },
    });
    expect(quotes.map((quote) => quote.indexName)).toEqual(["NIFTY IT"]);
  });

  it("returns an empty list for a malformed payload", () => {
    expect(normalizeLiveIndices(null)).toEqual([]);
    expect(normalizeLiveIndices({ indices: {} })).toEqual([]);
    expect(normalizeLiveIndices({ data: [] })).toEqual([]);
  });
});

describe("official NSE market movers", () => {
  it("keeps only strictly positive gainers, sorted descending", () => {
    const result = normalizeNseMarketMovers(moversPayload, { limit: 10 })!;
    expect(result.gainers.length).toBeGreaterThan(0);
    for (const row of result.gainers) expect(row.changePercent).toBeGreaterThan(0);
    expect(result.gainers.map((row) => row.symbol)).toEqual([
      "ORCHASP",
      "PROZONER",
      "FLEXITUFF",
    ]);
    expect(result.gainers[0].changePercent).toBeGreaterThan(
      result.gainers[result.gainers.length - 1].changePercent
    );
  });

  it("keeps only strictly negative losers, sorted ascending", () => {
    const result = normalizeNseMarketMovers(moversPayload, { limit: 10 })!;
    for (const row of result.losers) expect(row.changePercent).toBeLessThan(0);
    expect(result.losers.map((row) => row.symbol)).toEqual(["PAGEIND", "LOKESHMACH"]);
    expect(result.losers[0].changePercent).toBeLessThan(result.losers[1].changePercent);
    // The +10% row that arrived in the losers array is gone.
    expect(result.losers.some((row) => row.symbol === "POSINLOSERS")).toBe(false);
  });

  it("excludes zero, invalid and non-EQ-series rows and deduplicates", () => {
    const result = normalizeNseMarketMovers(moversPayload, { limit: 10 })!;
    const symbols = [...result.gainers, ...result.losers].map((row) => row.symbol);
    expect(symbols).not.toContain("ZEROMOVE");
    expect(symbols).not.toContain("BADPCT");
    expect(symbols).not.toContain("SMESAMPLE");
    expect(symbols).not.toContain("SHIVAM-RE1");
    expect(symbols.filter((symbol) => symbol === "ORCHASP")).toHaveLength(1);
    expect(result.droppedRows).toBeGreaterThan(0);
  });

  it("does not pad a short list", () => {
    const result = normalizeNseMarketMovers(
      {
        segment: "allSec",
        gainersUpdatedAt: "2026-11-12T10:22:18.190244815Z",
        losersUpdatedAt: "2026-11-12T10:22:18.748000197Z",
        gainers: [
          { symbol: "AAA", series: "EQ", ltp: 11, prev_price: 10, perChange: 10 },
          { symbol: "BBB", series: "EQ", ltp: 12, prev_price: 10, perChange: 20 },
        ],
        losers: [],
      },
      { limit: 5 }
    )!;
    expect(result.gainers).toHaveLength(2);
    expect(result.losers).toHaveLength(0);
  });

  it("reports provider session metadata and never mixes sessions silently", () => {
    const result = normalizeNseMarketMovers(moversPayload, { limit: 10 })!;
    expect(result.segment).toBe("allSec");
    expect(result.universeLabel).toContain("EQ");
    expect(result.sessionDate).toBe("2026-11-12");
    expect(result.sessionMismatch).toBe(false);
    expect(result.gainers[0].quoteTime).not.toBeNull();
    expect(result.gainersUpdatedAt).toBe(Date.parse("2026-11-12T10:22:18.190Z"));

    const mixed = normalizeNseMarketMovers(
      {
        gainersUpdatedAt: "2026-11-12T10:00:00Z",
        losersUpdatedAt: "2026-11-11T10:00:00Z",
        gainers: [{ symbol: "AAA", series: "EQ", ltp: 11, prev_price: 10, perChange: 10 }],
        losers: [{ symbol: "BBB", series: "EQ", ltp: 9, prev_price: 10, perChange: -10 }],
      },
      { limit: 5 }
    )!;
    expect(mixed.sessionMismatch).toBe(true);
  });

  it("returns null when the provider supplied no rows", () => {
    expect(normalizeNseMarketMovers(null)).toBeNull();
    expect(normalizeNseMarketMovers({ gainers: [], losers: [] })).toBeNull();
  });
});

describe("market mover source is fixed and provider-independent", () => {
  it("routes only to NSE MCP", () => {
    expect(MARKET_MOVERS_SOURCE).toBe("nsemcp");
    expect(MARKET_MOVERS_UNIVERSE).toBe("allSec");
  });

  it("uses a cache key that cannot contain a user or quote preference", () => {
    expect(MARKET_MOVERS_CACHE_KEY).toContain("nsemcp");
    expect(MARKET_MOVERS_CACHE_KEY).not.toMatch(/tejhq|user|profile/i);
  });
});

describe("timestamps", () => {
  it("parses ISO timestamps with 9 fractional digits", () => {
    expect(parseIsoTimestamp("2026-11-12T10:22:18.190244815Z")).toBe(
      Date.parse("2026-11-12T10:22:18.190Z")
    );
    expect(parseIsoTimestamp("")).toBeNull();
    expect(parseIsoTimestamp("not a date")).toBeNull();
  });

  it("drops timestamps materially in the future instead of showing them fresh", () => {
    const now = Date.parse("2026-11-12T10:00:00Z");
    expect(sanitizeQuoteTime(now + 60_000, now)).toBe(now + 60_000);
    expect(sanitizeQuoteTime(now + 10 * 60_000, now)).toBeNull();
    expect(sanitizeQuoteTime(null, now)).toBeNull();
  });

  it("distinguishes retrieval time from provider quote time", () => {
    const quotes = normalizeLiveIndices(indicesPayload);
    const quoteTime = quotes[0].quoteTime!;
    expect(quoteTime).toBeLessThan(Date.parse("2026-11-12T10:00:00Z"));
  });
});
