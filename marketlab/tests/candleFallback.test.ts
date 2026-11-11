import { describe, expect, it } from "vitest";
import {
  noProviderNote,
  providerFallbackWarning,
  sampleCandleFallback,
  sampleScreenerQuote,
} from "../convex/market/fallback";
import { istDateToUtcMs } from "../convex/market/time";

/**
 * These tests pin the contract for the market-data fallback path: whenever a
 * provider fails, is missing, or returns nothing, the series handed to the UI is
 * a labelled SAMPLE series with a reason — never a series that could be read as
 * genuine history.
 *
 * They exercise the same builders `marketData.getCandles` calls; the Convex
 * action wrapper itself is covered by the browser checks described in
 * docs/RELEASE_READINESS.md.
 */

const INSTRUMENT = { instrumentId: "NSE:RELIANCE:EQUITY", symbol: "RELIANCE" };
const NOW = istDateToUtcMs("2024-06-28");
const FROM = istDateToUtcMs("2024-04-01");
const TO = istDateToUtcMs("2024-06-28");

const build = (overrides: Partial<Parameters<typeof sampleCandleFallback>[0]> = {}) =>
  sampleCandleFallback({
    instrument: INSTRUMENT,
    interval: "1d",
    fromMs: FROM,
    toMs: TO,
    nowMs: NOW,
    maxCandles: 3000,
    ...overrides,
  });

describe("sample candle fallback", () => {
  it("labels the whole result SAMPLE and names the sample source", () => {
    const result = build();
    expect(result.mode).toBe("SAMPLE");
    expect(result.source).toBe("sample");
    expect(result.adjusted).toBe("unknown");
    expect(result.candles.length).toBeGreaterThan(0);
    for (const candle of result.candles) {
      expect(candle.mode).toBe("SAMPLE");
      expect(candle.source).toBe("sample");
      expect(candle.instrumentId).toBe(INSTRUMENT.instrumentId);
      expect(candle.interval).toBe("1d");
    }
  });

  it("never reports a fallback as HISTORICAL, LIVE or a provider source", () => {
    const result = build();
    const labels = new Set(result.candles.map((candle) => candle.mode));
    expect(labels).toEqual(new Set(["SAMPLE"]));
    expect(result.source).not.toBe("fyers");
    expect(result.source).not.toBe("breeze");
    expect(result.source).not.toBe("tapetide");
    expect(result.source).not.toBe("csv_import");
  });

  it("is deterministic for identical inputs and timestamps", () => {
    expect(build().candles).toEqual(build().candles);
    // A different symbol must produce a different series.
    const other = build({ instrument: { instrumentId: "NSE:TCS:EQUITY", symbol: "TCS" } });
    expect(other.candles).not.toEqual(build().candles);
  });

  it("honours the candle cap instead of returning an unbounded series", () => {
    const capped = build({ maxCandles: 5 });
    expect(capped.candles).toHaveLength(5);
    expect(capped.quality.rowCount).toBe(5);
    expect(capped.quality.lastTs).toBe(capped.candles[4].ts);
  });

  it("reports the requested interval and a quality summary", () => {
    const result = build({ interval: "1h" });
    expect(result.interval).toBe("1h");
    expect(result.quality.rowCount).toBe(result.candles.length);
    expect(result.quality.fromCache).toBe(false);
    expect(result.quality.firstTs).toBe(result.candles[0].ts);
  });

  it("makes no claim of freshness beyond the request time", () => {
    const result = build();
    expect(result.fetchedAt).toBe(NOW);
    expect(result.warning).toBeNull();
    expect(result.note).toBeNull();
  });
});

describe("screener sample fallback", () => {
  const screenerInstrument = {
    instrumentId: "NSE:RELIANCE:EQUITY",
    symbol: "RELIANCE",
    exchange: "NSE" as const,
    name: "Reliance Industries",
  };

  it("labels the fallback price SAMPLE and names the sample source", () => {
    const quote = sampleScreenerQuote(screenerInstrument, NOW);
    expect(quote.mode).toBe("SAMPLE");
    expect(quote.source).toBe("sample");
    expect(quote.lastPrice).toBeGreaterThan(0);
    expect(quote.fetchedAt).toBe(NOW);
  });

  it("is deterministic per instrument and timestamp", () => {
    expect(sampleScreenerQuote(screenerInstrument, NOW)).toEqual(
      sampleScreenerQuote(screenerInstrument, NOW)
    );
    const other = sampleScreenerQuote(
      { ...screenerInstrument, instrumentId: "NSE:TCS:EQUITY", symbol: "TCS" },
      NOW
    );
    expect(other.lastPrice).not.toBe(sampleScreenerQuote(screenerInstrument, NOW).lastPrice);
  });
});

describe("fallback reasons", () => {
  it("keeps the provider message but states that the data is not history", () => {
    const warning = providerFallbackWarning("FYERS", "Provider request timed out after 15000 ms");
    expect(warning).toContain("FYERS");
    expect(warning).toContain("timed out");
    expect(warning).toMatch(/sample/i);
    expect(warning).toMatch(/not market history/i);
    expect(warning).not.toMatch(/HISTORICAL/);
    expect(warning).not.toMatch(/\bLIVE\b/);
  });

  it("still produces a usable warning for an empty provider message", () => {
    const warning = providerFallbackWarning("Breeze", "   ");
    expect(warning).toContain("Breeze");
    expect(warning).toContain("no response");
  });

  it("explains a signed-out session, an empty provider range and a missing capability", () => {
    expect(
      noProviderNote({ signedIn: false, providerLabel: null, interval: "1d" })
    ).toMatch(/sign in/i);

    const empty = noProviderNote({ signedIn: true, providerLabel: "FYERS", interval: "1d" });
    expect(empty).toContain("FYERS");
    expect(empty).toMatch(/no candles/i);

    const unsupported = noProviderNote({
      signedIn: true,
      providerLabel: null,
      interval: "15m",
    });
    expect(unsupported).toContain("15m");
    expect(unsupported).toMatch(/no configured provider/i);
  });

  it("never phrases a fallback as a successful provider response", () => {
    for (const note of [
      noProviderNote({ signedIn: false, providerLabel: null, interval: "1d" }),
      noProviderNote({ signedIn: true, providerLabel: "Breeze", interval: "1d" }),
      noProviderNote({ signedIn: true, providerLabel: null, interval: "1d" }),
    ]) {
      expect(note).not.toMatch(/live data/i);
      expect(note).not.toMatch(/real data/i);
      expect(note).toMatch(/sample/i);
    }
  });
});
