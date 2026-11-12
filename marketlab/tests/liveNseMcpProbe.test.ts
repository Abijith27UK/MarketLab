import { describe, expect, it } from "vitest";
import { provider } from "../convex/market/providers/nsemcp";
import type { NormalizedInstrument } from "../convex/market/types";

/**
 * Opt-in live probe against the real NSE MCP endpoint.
 *
 * Skipped unless `LIVE_NSE_MCP=1`, because it performs genuine network requests
 * to a public exchange service:
 *
 *   LIVE_NSE_MCP=1 npx vitest run tests/liveNseMcpProbe.test.ts
 *
 * It is not part of the default suite and must never be treated as offline
 * verification.
 */
const live = process.env.LIVE_NSE_MCP === "1";

const instrument = (symbol: string): NormalizedInstrument => ({
  instrumentId: `NSE:${symbol}:EQUITY`,
  symbol,
  tradingSymbol: `NSE:${symbol}`,
  name: symbol,
  exchange: "NSE",
  instrumentType: "EQUITY",
  segment: "EQ",
  providerIds: {},
  isin: null,
  tickSize: null,
  lotSize: null,
  isActive: true,
  source: "tejhq",
  isSampleData: false,
});

const indexInstrument = (symbol: string): NormalizedInstrument => ({
  ...instrument(symbol),
  instrumentId: `NSE:${symbol}:INDEX`,
  instrumentType: "INDEX",
});

describe.skipIf(!live)("NSE MCP live probe (opt-in)", () => {
  it("handshakes, discovers tools and returns a real quote", async () => {
    const env = { NSE_MCP_POC_ENABLED: "true" };

    const connection = await provider.testConnection(env);
    console.log("[handshake]", connection.message, "|", connection.detail);
    expect(connection.ok).toBe(true);

    const quotes = await provider.fetchQuotes?.(env, [instrument("RELIANCE")]);
    console.log("[quote]", JSON.stringify(quotes?.[0] ?? null));

    expect(quotes).toBeDefined();
    expect(quotes!.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const quote = quotes![0];
    expect(quote.source).toBe("nsemcp");
    expect(quote.mode).toBe("DELAYED");
    expect(quote.mode).not.toBe("LIVE");
    expect(quote.lastPrice).toBeGreaterThan(0);
    expect(quote.quoteTime).not.toBeNull();
    // A real session stamp, not something synthesised at request time.
    expect(quote.quoteTime!).toBeGreaterThan(Date.now() - 7 * 24 * 3600 * 1000);
  }, 90_000);

  it("returns real index quotes for NIFTY 50 and NIFTY BANK", async () => {
    const env = { NSE_MCP_POC_ENABLED: "true" };
    const quotes = await provider.fetchQuotes?.(env, [
      indexInstrument("NIFTY 50"),
      indexInstrument("NIFTY BANK"),
    ]);
    console.log("[indices]", JSON.stringify(quotes ?? []));
    expect(quotes && quotes.length).toBeTruthy();
    for (const quote of quotes ?? []) {
      expect(quote.mode).toBe("DELAYED");
      expect(quote.lastPrice).toBeGreaterThan(0);
      expect(quote.quoteTime).not.toBeNull();
    }
  }, 90_000);

  it("returns real quotes for the verified large caps", async () => {
    const env = { NSE_MCP_POC_ENABLED: "true" };
    const quotes = await provider.fetchQuotes?.(env, [
      instrument("TCS"),
      instrument("HDFCBANK"),
      instrument("INFY"),
      instrument("ICICIBANK"),
    ]);
    console.log("[largecaps]", JSON.stringify(quotes ?? []));
    for (const quote of quotes ?? []) {
      expect(quote.lastPrice).toBeGreaterThan(0);
      expect(quote.previousClose).not.toBeNull();
      expect(quote.quoteTime).not.toBeNull();
      expect(quote.mode).toBe("DELAYED");
    }
  }, 90_000);
});
