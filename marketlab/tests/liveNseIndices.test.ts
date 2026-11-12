import { describe, expect, it } from "vitest";
import { provider } from "../convex/market/providers/nsemcp";
import {
  DASHBOARD_INDEX_DEFINITIONS,
  indexDefinitionToInstrument,
} from "../convex/market/indexCatalogue";

const LIVE = process.env.LIVE_NSE_MCP === "1";
const env = { NSE_MCP_POC_ENABLED: "true" };

describe.skipIf(!LIVE)("live NSE MCP index quotes", () => {
  it("returns real levels for NIFTY 50, NIFTY BANK and NIFTY IT", async () => {
    const instruments = ["NIFTY50", "BANKNIFTY", "NIFTYIT"].map((symbol) => {
      const definition = DASHBOARD_INDEX_DEFINITIONS.find((entry) => entry.symbol === symbol)!;
      return indexDefinitionToInstrument(definition);
    });
    const quotes = await provider.fetchQuotes!(env, instruments);
    for (const quote of quotes) {
      console.log(
        "INDEX",
        quote.symbol,
        quote.lastPrice,
        quote.change,
        quote.changePercent,
        quote.quoteTime === null ? "no-time" : new Date(quote.quoteTime).toISOString(),
        quote.mode,
        quote.source
      );
    }
    expect(quotes.length).toBe(3);
    for (const quote of quotes) {
      expect(quote.lastPrice).toBeGreaterThan(0);
      expect(quote.mode).toBe("DELAYED");
      expect(quote.source).toBe("nsemcp");
      expect(quote.quoteTime).not.toBeNull();
    }
  }, 120_000);
});
