import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { rsi, sma, latestDefined } from "./market/indicators";
import { toNormalizedInstrument } from "./marketData";
import { makeInstrumentId, type DataMode, type InstrumentType } from "./market/types";
import { sampleScreenerQuote, type ScreenerQuote } from "./market/fallback";
import { isEndOfDaySource, isSamplePricedRow } from "./market/provenance";
import { istDateString } from "./market/time";
// Type-only result contract; see the note in `marketData.ts`. The explicit return
// annotation is what keeps the generated API object free of type cycles.
import type { ScreenerResult } from "../src/lib/marketClient";

/**
 * Stock screener.
 *
 * The screener filters the data MarketLab already holds for the signed-in user:
 * the instrument master, stored quotes, stored fundamentals and any locally
 * stored candle history. It never fires one provider request per instrument, so
 * running a screen cannot burn a provider quota or trigger NSE/BSE-side limits.
 *
 * Every row reports the freshness label of the quote it was filtered on, and the
 * response reports how many instruments were skipped for lack of data instead of
 * silently hiding them.
 */

const exchangeFilter = v.union(v.literal("NSE"), v.literal("BSE"), v.literal("ALL"));
const instrumentTypeFilter = v.union(
  v.literal("EQUITY"),
  v.literal("ETF"),
  v.literal("INDEX"),
  v.literal("OTHER"),
  v.literal("ALL")
);
const intervalArg = v.union(
  v.literal("1m"),
  v.literal("5m"),
  v.literal("15m"),
  v.literal("1h"),
  v.literal("1d"),
  v.literal("1w"),
  v.literal("1M")
);

export const screenerFiltersValidator = v.object({
  search: v.optional(v.string()),
  exchange: v.optional(exchangeFilter),
  instrumentType: v.optional(instrumentTypeFilter),
  minPrice: v.optional(v.number()),
  maxPrice: v.optional(v.number()),
  minChangePercent: v.optional(v.number()),
  maxChangePercent: v.optional(v.number()),
  minVolume: v.optional(v.number()),
  minPe: v.optional(v.number()),
  maxPe: v.optional(v.number()),
  minMarketCapCrore: v.optional(v.number()),
  maxMarketCapCrore: v.optional(v.number()),
  technical: v.optional(
    v.object({
      indicator: v.union(v.literal("RSI"), v.literal("PRICE_VS_SMA")),
      period: v.number(),
      interval: intervalArg,
      min: v.optional(v.number()),
      max: v.optional(v.number()),
    })
  ),
  /** Drop rows whose price would be synthetic (no stored provider quote). */
  excludeSample: v.optional(v.boolean()),
  limit: v.optional(v.number()),
});

type ScreenerFilters = {
  search?: string;
  exchange?: "NSE" | "BSE" | "ALL";
  instrumentType?: "EQUITY" | "ETF" | "INDEX" | "OTHER" | "ALL";
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minVolume?: number;
  minPe?: number;
  maxPe?: number;
  minMarketCapCrore?: number;
  maxMarketCapCrore?: number;
  technical?: {
    indicator: "RSI" | "PRICE_VS_SMA";
    period: number;
    interval: "1m" | "5m" | "15m" | "1h" | "1d" | "1w" | "1M";
    min?: number;
    max?: number;
  };
  excludeSample?: boolean;
  limit?: number;
};

interface StoredScreenerRow {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: "NSE" | "BSE";
  instrumentType: InstrumentType;
  isSampleData: boolean;
  lastPrice: number | null;
  changePercent: number | null;
  volume: number | null;
  peTtm: number | null;
  marketCapCrore: number | null;
  technicalValue: number | null;
  technicalNote: string | null;
  technicalMode: DataMode | null;
  technicalSource: string | null;
  mode: DataMode;
  source: string;
  /** True when the price is a completed session's close (EOD-only provider). */
  eod: boolean;
  /** IST session date of the stored quote, if any. */
  quoteDate: string | null;
  quoteFetchedAt: number | null;
  hasQuote: boolean;
}

function inRange(value: number | null | undefined, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) return true;
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

function modeOfRow(quoteMode: DataMode | undefined): DataMode {
  return quoteMode ?? "SAMPLE";
}

/**
 * Runs a screen against stored data.
 * Requires a signed-in user because saved screens and imported history are
 * user-owned; nothing here is shared across accounts.
 */
export const run = action({
  args: { filters: screenerFiltersValidator },
  handler: async (ctx, rawArgs): Promise<ScreenerResult> => {
    const userId = (await ctx.runQuery(internal.marketStore.currentUserId, {})) as
      | Id<"users">
      | null;
    if (!userId) throw new Error("Sign in to run the screener");

    const filters = rawArgs.filters as ScreenerFilters;
    const limit = Math.min(Math.max(1, filters.limit ?? 50), 100);
    const candidateRows = await ctx.runQuery(internal.marketStore.screenerCandidates, {
      search: filters.search,
      exchange: filters.exchange,
      instrumentType: filters.instrumentType,
      limit: Math.min(400, limit * 8),
    });

    const instruments = candidateRows.map(toNormalizedInstrument);
    const ids = instruments.map((instrument) => instrument.instrumentId);

    const quotes = await ctx.runQuery(internal.marketStore.quotesByInstrumentIds, { ids });
    const quoteById = new Map(quotes.map((quote) => [quote.instrumentId, quote]));
    const fundamentals = await ctx.runQuery(internal.marketStore.fundamentalsByInstrumentIds, {
      ids,
    });
    const fundamentalsById = new Map(
      fundamentals.map((record) => [record.instrumentId, record])
    );

    const now = Date.now();
    const technical = filters.technical;
    const excludeSample = filters.excludeSample === true;
    let skippedNoQuote = 0;
    let skippedNoHistory = 0;
    let samplePriced = 0;
    let sampleExcluded = 0;

    const rows: StoredScreenerRow[] = [];
    for (const instrument of instruments) {
      const storedQuote = quoteById.get(instrument.instrumentId);
      // Without a stored provider quote the deterministic SAMPLE price is used,
      // so the demo screener still filters on a complete row. The fallback is
      // labelled SAMPLE on the row and in the response — it is never presented
      // as a stored or live quote.
      const quote: ScreenerQuote = storedQuote
        ? {
            lastPrice: storedQuote.lastPrice,
            changePercent: storedQuote.changePercent,
            volume: storedQuote.volume,
            mode: storedQuote.mode as DataMode,
            source: storedQuote.source,
            fetchedAt: storedQuote.fetchedAt,
          }
        : sampleScreenerQuote(instrument, now);
      const sampleRow = isSamplePricedRow({
        hasStoredQuote: Boolean(storedQuote),
        mode: quote.mode,
      });
      if (sampleRow) samplePriced += 1;

      const fundamentalsRecord = fundamentalsById.get(instrument.instrumentId);

      if (
        (filters.minPe !== undefined ||
          filters.maxPe !== undefined ||
          filters.minMarketCapCrore !== undefined ||
          filters.maxMarketCapCrore !== undefined) &&
        !fundamentalsRecord
      ) {
        // Fundamentals filters require a stored fundamentals snapshot.
        skippedNoQuote += 1;
        continue;
      }

      if (!inRange(quote?.lastPrice, filters.minPrice, filters.maxPrice)) continue;
      if (!inRange(quote?.changePercent, filters.minChangePercent, filters.maxChangePercent)) {
        continue;
      }
      if (!inRange(quote?.volume, filters.minVolume, undefined)) continue;
      if (!inRange(fundamentalsRecord?.peTtm, filters.minPe, filters.maxPe)) continue;
      if (
        !inRange(
          fundamentalsRecord?.marketCapCrore,
          filters.minMarketCapCrore,
          filters.maxMarketCapCrore
        )
      ) {
        continue;
      }

      // Filtering SAMPLE rows happens after the price filters so the count says
      // how many otherwise-qualifying instruments were dropped for lacking a
      // real price.
      if (sampleRow && excludeSample) {
        sampleExcluded += 1;
        continue;
      }

      let technicalValue: number | null = null;
      let technicalNote: string | null = null;
      let technicalMode: DataMode | null = null;
      let technicalSource: string | null = null;

      if (technical) {
        const period = Math.min(Math.max(2, Math.round(technical.period)), 200);
        const history = await ctx.runQuery(internal.marketStore.latestDataset, {
          instrumentId: instrument.instrumentId,
          interval: technical.interval,
          ownerId: userId,
          fromMs: now - 400 * 24 * 60 * 60 * 1000,
          toMs: now,
          limit: 400,
        });
        const closes = (history?.candles ?? []).map((candle) => candle.close);
        technicalMode = history ? (history.dataset.mode as DataMode) : null;
        technicalSource = history?.dataset.source ?? null;
        if (closes.length < period + 1) {
          skippedNoHistory += 1;
          continue;
        }
        // A technical value computed from the synthetic series must never be
        // presented as a real setup when the caller asked for real data only.
        if (excludeSample && technicalSource === "sample") {
          sampleExcluded += 1;
          continue;
        }
        if (technical.indicator === "RSI") {
          technicalValue = latestDefined(rsi(closes, period));
        } else {
          const average = latestDefined(sma(closes, period));
          const last = closes[closes.length - 1];
          technicalValue =
            average === null || average === 0 ? null : ((last - average) / average) * 100;
          technicalNote = "% vs SMA";
        }
        if (technicalValue === null) {
          skippedNoHistory += 1;
          continue;
        }
        if (!inRange(technicalValue, technical.min, technical.max)) continue;
      }

      rows.push({
        instrumentId: instrument.instrumentId,
        symbol: instrument.symbol,
        name: instrument.name,
        exchange: instrument.exchange,
        instrumentType: instrument.instrumentType,
        isSampleData: instrument.isSampleData,
        lastPrice: quote?.lastPrice ?? null,
        changePercent: quote?.changePercent ?? null,
        volume: quote?.volume ?? null,
        peTtm: fundamentalsRecord?.peTtm ?? null,
        marketCapCrore: fundamentalsRecord?.marketCapCrore ?? null,
        technicalValue,
        technicalNote,
        technicalMode,
        technicalSource,
        mode: modeOfRow(quote?.mode),
        source: quote?.source ?? "none",
        eod: Boolean(storedQuote && isEndOfDaySource(storedQuote.source)),
        quoteDate: storedQuote?.quoteTime ? istDateString(storedQuote.quoteTime) : null,
        quoteFetchedAt: quote?.fetchedAt ?? null,
        hasQuote: Boolean(storedQuote),
      });
    }

    const sorted = rows
      .sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity))
      .slice(0, limit);

    const modes = sorted.map((row) => row.mode as DataMode);
    const overall: DataMode = modes.length === 0
      ? "SAMPLE"
      : modes.every((mode) => mode === "SAMPLE")
        ? "SAMPLE"
        : modes.includes("LIVE")
          ? "LIVE"
          : modes.includes("DELAYED")
            ? "DELAYED"
            : modes.includes("CACHED")
              ? "CACHED"
              : "HISTORICAL";

    return {
      rows: sorted,
      evaluated: instruments.length,
      matched: sorted.length,
      skippedNoQuote,
      skippedNoHistory,
      samplePriced,
      sampleExcluded,
      mode: overall,
      asOf: now,
      note:
        quotes.length === 0 && excludeSample
          ? "No provider quotes are stored, so every row would be SAMPLE data; with “real data only” enabled this screen returns nothing."
          : quotes.length === 0
            ? "No provider quotes are stored, so every price here is the deterministic SAMPLE series — not market data. Technical filters additionally need stored candle history."
            : technical
              ? "Technical filters use locally stored candle history; instruments without stored history are skipped."
              : null,
      excludedNote:
        excludeSample && sampleExcluded > 0
          ? `${sampleExcluded} instrument${sampleExcluded === 1 ? " was" : "s were"} excluded for having only SAMPLE data.`
          : null,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Saved screeners (user-owned)                                        */
/* ------------------------------------------------------------------ */

export const listSaved = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("savedScreeners")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const save = mutation({
  args: {
    name: v.string(),
    filtersJson: v.string(),
    resultCount: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    if (name.length > 60) throw new Error("Name is too long");
    if (args.filtersJson.length > 4000) throw new Error("Filter definition is too large");
    try {
      JSON.parse(args.filtersJson);
    } catch {
      throw new Error("Filter definition is not valid JSON");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("savedScreeners")
      .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", name))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        filtersJson: args.filtersJson,
        lastResultCount: args.resultCount,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("savedScreeners", {
      userId,
      name,
      filtersJson: args.filtersJson,
      lastResultCount: args.resultCount,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const renameSaved = mutation({
  args: { id: v.id("savedScreeners"), name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Saved screen not found");
    if (record.userId !== userId) throw new Error("Not authorized");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    await ctx.db.patch(args.id, { name, updatedAt: Date.now() });
  },
});

export const removeSaved = mutation({
  args: { id: v.id("savedScreeners") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const record = await ctx.db.get(args.id);
    if (!record) throw new Error("Saved screen not found");
    if (record.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(args.id);
  },
});

/** Field availability: which screener filters this deployment can honour. */
export const availability = query({
  args: {},
  handler: async (ctx) => {
    const quotes = await ctx.db.query("marketQuotes").collect();
    const fundamentals = await ctx.db.query("fundamentals").collect();
    const datasets = await ctx.db.query("candleDatasets").collect();
    return {
      quoteFields: quotes.length > 0,
      fundamentalFields: fundamentals.length > 0,
      technicalFields: datasets.length > 0,
      instrumentCount: (await ctx.db.query("instruments").collect()).length,
    };
  },
});

export { makeInstrumentId };
