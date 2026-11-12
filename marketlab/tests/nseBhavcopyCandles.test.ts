import { describe, expect, it } from "vitest";
import {
  normalizeBhavcopyRows,
  parseJsonPrefix,
  unwrapMcpToolPayload,
  provider as nseProvider,
} from "../convex/market/providers/nsemcp";
import type { NormalizedInstrument } from "../convex/market/types";

const instrument: NormalizedInstrument = {
  instrumentId: "NSE:ITC:EQUITY",
  symbol: "ITC",
  tradingSymbol: "ITC",
  name: "ITC Limited",
  exchange: "NSE",
  instrumentType: "EQUITY",
  segment: "EQ",
  providerIds: { nsemcp: "ITC" },
  isin: null,
  tickSize: null,
  lotSize: null,
  isActive: true,
  source: "tejhq",
};

describe("bhavcopy candle normalization", () => {
  it("unwraps the MCP content envelope", () => {
    const payload = unwrapMcpToolPayload({
      content: [{ type: "text", text: JSON.stringify({ symbol: "ITC", data: [] }) }],
    });
    expect(payload?.symbol).toBe("ITC");
    expect(unwrapMcpToolPayload({ plain: true })).toEqual({ plain: true });
    expect(unwrapMcpToolPayload(null)).toBeNull();
  });

  it("parses a JSON payload that the MCP server truncates with a trailing note", () => {
    // Observed on Tapetide: the JSON document is followed by a size note.
    const text = '{"data":[{"title":"ITC news"}],"meta":{"count":1}}\n\n[TRUNCATED: Reduced arrays to fit 25000 chars.]';
    const parsed = parseJsonPrefix(text) as { data: unknown[] };
    expect(parsed.data).toHaveLength(1);
    expect(parseJsonPrefix("not json at all")).toBeNull();
  });

  it("keeps valid EQ rows, sorts them, and de-duplicates by date", () => {
    const candles = normalizeBhavcopyRows(
      [
        { symbol: "ITC", series: "EQ", date: "2026-11-10", open: 280, high: 286, low: 279, close: 285, volume: 100 },
        { symbol: "ITC", series: "EQ", date: "2026-11-11", open: 285, high: 288, low: 283, close: 287, volume: 120 },
        { symbol: "ITC", series: "EQ", date: "2026-11-10", open: 280, high: 286, low: 279, close: 285, volume: 110 },
        { symbol: "ITC", series: "BE", date: "2026-11-11", open: 1, high: 1, low: 1, close: 1 },
      ],
      instrument
    );

    expect(candles).toHaveLength(2);
    const istDate = (ts: number) =>
      new Date(ts).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    expect(istDate(candles[0].ts)).toBe("2026-11-10");
    expect(istDate(candles[1].ts)).toBe("2026-11-11");
    expect(candles[1].volume).toBe(120);
    expect(candles.every((candle) => candle.source === "nsemcp")).toBe(true);
    expect(candles.every((candle) => candle.adjusted === "unknown")).toBe(true);
  });

  it("drops inconsistent or malformed bars instead of repairing them", () => {
    const candles = normalizeBhavcopyRows(
      [
        { date: "2026-11-10", open: 100, high: 99, low: 95, close: 98 }, // high < open
        { date: "2026-11-10", open: 100, high: 105, low: 101, close: 104 }, // low > open
        { date: "not-a-date", open: 100, high: 105, low: 95, close: 98 },
        { date: "2026-11-11", open: 0, high: 0, low: 0, close: 0 },
        { date: "2026-11-11", open: "100", high: "105", low: "95", close: "102", volume: "-5" },
      ],
      instrument
    );

    expect(candles).toHaveLength(1);
    expect(candles[0].close).toBe(102);
    expect(candles[0].volume).toBeNull();
  });

  it("rejects intraday intervals and non-equity instruments", async () => {
    const env = { NSE_MCP_POC_ENABLED: "true" };
    await expect(
      nseProvider.fetchCandles!(env, {
        instrument,
        interval: "1h",
        fromMs: Date.now() - 86_400_000,
        toMs: Date.now(),
      })
    ).rejects.toThrow(/daily only/i);

    await expect(
      nseProvider.fetchCandles!(env, {
        instrument: { ...instrument, instrumentType: "INDEX", symbol: "NIFTY 50" },
        interval: "1d",
        fromMs: Date.now() - 86_400_000,
        toMs: Date.now(),
      })
    ).rejects.toThrow(/equities only/i);
  });

  it("stays disabled without the feature flag", async () => {
    await expect(
      nseProvider.fetchCandles!({}, {
        instrument,
        interval: "1d",
        fromMs: Date.now() - 86_400_000,
        toMs: Date.now(),
      })
    ).rejects.toThrow(/NSE_MCP_POC_ENABLED/);
  });

  it("is registered as a daily-only candle provider", () => {
    expect(nseProvider.capabilities.candles.supported).toBe(true);
    expect(nseProvider.capabilities.candles.intervals).toEqual(["1d"]);
  });
});
