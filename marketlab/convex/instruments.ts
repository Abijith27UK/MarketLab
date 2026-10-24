import { query, internalMutation } from "./_generated/server";

/**
 * Demonstration instrument catalogue.
 * These are STATIC SAMPLE records for development — not live market data,
 * not an exchange feed, and not indicative of real prices.
 */
const DEMO_CATALOGUE = [
  { symbol: "RELIANCE", name: "Reliance Industries", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Oil & Gas" },
  { symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Information Technology" },
  { symbol: "HDFCBANK", name: "HDFC Bank", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Financials" },
  { symbol: "INFY", name: "Infosys", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Information Technology" },
  { symbol: "SBIN", name: "State Bank of India", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Financials" },
  { symbol: "TATAMOTORS", name: "Tata Motors", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Automobiles" },
  { symbol: "ITC", name: "ITC", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Consumer Goods" },
  { symbol: "ICICIBANK", name: "ICICI Bank", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Financials" },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Telecom" },
  { symbol: "LT", name: "Larsen & Toubro", exchange: "NSE" as const, instrumentType: "EQUITY" as const, sector: "Infrastructure" },
  { symbol: "NIFTYBEES", name: "Nifty 50 ETF", exchange: "NSE" as const, instrumentType: "ETF" as const, sector: "Index Fund" },
  { symbol: "NIFTY 50", name: "Nifty 50 Index", exchange: "NSE" as const, instrumentType: "INDEX" as const, sector: "Index" },
  { symbol: "RELIANCE", name: "Reliance Industries", exchange: "BSE" as const, instrumentType: "EQUITY" as const, sector: "Oil & Gas" },
  { symbol: "TCS", name: "Tata Consultancy Services", exchange: "BSE" as const, instrumentType: "EQUITY" as const, sector: "Information Technology" },
  { symbol: "SENSEX", name: "BSE Sensex Index", exchange: "BSE" as const, instrumentType: "INDEX" as const, sector: "Index" },
];

/** Lists the demo catalogue. Public: contains no user data. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("instruments").collect();
  },
});

/** Seeds the demonstration catalogue (idempotent, internal only). */
export const seedDemoInstruments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("instruments").collect();
    if (existing.length > 0) return { inserted: 0, existing: existing.length };
    const now = Date.now();
    for (const inst of DEMO_CATALOGUE) {
      await ctx.db.insert("instruments", {
        ...inst,
        dataSource: "demo_catalogue",
        isSampleData: true,
        lastUpdated: now,
      });
    }
    return { inserted: DEMO_CATALOGUE.length, existing: 0 };
  },
});
