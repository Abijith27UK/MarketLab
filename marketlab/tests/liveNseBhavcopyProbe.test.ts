/**
 * Opt-in live probe for the NSE MCP historical Bhavcopy server.
 *
 * The default test run never touches the network. Run it deliberately:
 *
 *   LIVE_NSE_BHAVCOPY=1 npx vitest run tests/liveNseBhavcopyProbe.test.ts
 *
 * It performs one handshake, one tool listing and at most one history call, so
 * the shared public server is not hammered. Nothing is written to the database.
 */

import { describe, expect, it } from "vitest";
import {
  NseMcpClient,
  NSE_MCP_BHAVCOPY_URL,
  provider as nseProvider,
} from "../convex/market/providers/nsemcp";
import type { NormalizedInstrument } from "../convex/market/types";

const LIVE = process.env.LIVE_NSE_BHAVCOPY === "1";

describe.skipIf(!LIVE)("NSE MCP bhavcopy live probe", () => {
  it("discovers the historical tools and reports what they accept", async () => {
    const client = new NseMcpClient(NSE_MCP_BHAVCOPY_URL);
    try {
      const init = await client.initialize();
      const tools = await client.listTools();

      const summary = tools.map((tool) => ({
        name: tool.name,
        required: tool.inputSchema?.required ?? [],
        properties: Object.keys(tool.inputSchema?.properties ?? {}),
      }));
      console.log(
        `[bhavcopy] MCP ${init.protocolVersion} · ${tools.length} tools\n` +
          summary.map((tool) => `- ${tool.name} (${tool.properties.join(", ")})`).join("\n")
      );

      expect(tools.length).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  }, 60_000);

  it("retrieves one daily OHLCV series when a history tool exists", async () => {
    const client = new NseMcpClient(NSE_MCP_BHAVCOPY_URL);
    try {
      await client.initialize();
      const tools = await client.listTools();
      const historyTool = tools.find((tool) =>
        /(history|ohlc|bhavcopy|candle)/i.test(tool.name)
      );
      if (!historyTool) {
        console.warn("[bhavcopy] no history tool advertised; nothing to call");
        return;
      }

      const props = historyTool.inputSchema?.properties ?? {};
      // Discovered schema for get_stock_history is (symbol, months, endDate).
      // Sending from/to instead makes the server throw an NPE, so the probe
      // mirrors the advertised properties exactly.
      const args: Record<string, unknown> = {};
      for (const key of Object.keys(props)) {
        if (/symbol|ticker|scrip|security/i.test(key)) args[key] = "ITC";
        else if (/months|period/i.test(key)) args[key] = 3;
        else if (/enddate|end_date|to|date/i.test(key)) args[key] = "2026-11-11";
        else if (/days/i.test(key)) args[key] = 30;
        else if (/series/i.test(key)) args[key] = "EQ";
      }

      const raw = await client.callTool(historyTool.name, args);
      console.log(`[bhavcopy] ${historyTool.name} →`, JSON.stringify(raw).slice(0, 1200));
      expect(raw).toBeTruthy();
    } finally {
      await client.close();
    }
  }, 60_000);

  it("normalizes real bhavcopy rows into sorted, valid chart candles", async () => {
    const now = Date.parse("2026-11-12T00:00:00.000Z");
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

    const candles = await nseProvider.fetchCandles!(
      { NSE_MCP_POC_ENABLED: "true" },
      { instrument, interval: "1d", fromMs: now - 30 * 86_400_000, toMs: now }
    );

    expect(candles.length).toBeGreaterThan(10);
    expect(candles.every((candle) => candle.source === "nsemcp")).toBe(true);
    for (let i = 0; i < candles.length; i += 1) {
      const candle = candles[i];
      expect(candle.low).toBeLessThanOrEqual(Math.min(candle.open, candle.close));
      expect(candle.high).toBeGreaterThanOrEqual(Math.max(candle.open, candle.close));
      if (i > 0) expect(candle.ts).toBeGreaterThan(candles[i - 1].ts);
    }
    console.log(
      `[bhavcopy] normalized ${candles.length} candles · ${new Date(candles[0].ts)
        .toISOString()
        .slice(0, 10)} → ${new Date(candles.at(-1)!.ts).toISOString().slice(0, 10)}`
    );
  }, 60_000);

  it("serves history for symbols beyond the original sample list", async () => {
    const now = Date.parse("2026-11-12T00:00:00.000Z");
    const symbols = ["RELIANCE", "WIPRO", "INFY"];
    const results: Array<{ symbol: string; candles: number }> = [];

    for (const symbol of symbols) {
      const instrument = {
        instrumentId: `NSE:${symbol}:EQUITY`,
        symbol,
        tradingSymbol: symbol,
        name: symbol,
        exchange: "NSE" as const,
        instrumentType: "EQUITY" as const,
        segment: "EQ",
        providerIds: { nsemcp: symbol },
        isin: null,
        tickSize: null,
        lotSize: null,
        isActive: true,
        source: "tejhq",
      };
      const candles = await nseProvider.fetchCandles!(
        { NSE_MCP_POC_ENABLED: "true" },
        { instrument, interval: "1d", fromMs: now - 30 * 86_400_000, toMs: now }
      );
      results.push({ symbol, candles: candles.length });
    }

    console.log("[bhavcopy] coverage", JSON.stringify(results));
    expect(results.every((result) => result.candles > 0)).toBe(true);
  }, 120_000);
});
