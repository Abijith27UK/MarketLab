import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { NormalizedCandle, NormalizedInstrument, NormalizedQuote } from "./market/types";
import { consumeRate, consumeDailyQuota, windowStartFor, WINDOW_MS } from "./market/rateLimit";
import { istDateString, istDateToUtcMs } from "./market/time";
import { isEndOfDaySource } from "./market/provenance";
import {
  DASHBOARD_INDEX_DEFINITIONS,
  indexDefinitionToInstrument,
} from "./market/indexCatalogue";

const dataModeValidator = v.union(
  v.literal("LIVE"),
  v.literal("DELAYED"),
  v.literal("CACHED"),
  v.literal("HISTORICAL"),
  v.literal("SAMPLE")
);

const intervalValidator = v.union(
  v.literal("1m"),
  v.literal("5m"),
  v.literal("15m"),
  v.literal("1h"),
  v.literal("1d"),
  v.literal("1w"),
  v.literal("1M")
);

const adjustedValidator = v.union(
  v.literal("adjusted"),
  v.literal("raw"),
  v.literal("unknown")
);

/* ------------------------------------------------------------------ */
/* Auth helper                                                         */
/* ------------------------------------------------------------------ */

/**
 * Resolves the authenticated user from the request's session.
 * Actions cannot read the auth table directly, so they call this internally.
 * The id always comes from the verified identity, never from client input.
 */
export const currentUserId = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await getAuthUserId(ctx);
  },
});

/* ------------------------------------------------------------------ */
/* Instruments                                                         */
/* ------------------------------------------------------------------ */

export const instrumentsByIds = internalQuery({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const results: Doc<"instruments">[] = [];
    for (const instrumentId of args.ids) {
      const direct = await ctx.db
        .query("instruments")
        .withIndex("by_instrument_id", (q) => q.eq("instrumentId", instrumentId))
        .first();
      if (direct) {
        results.push(direct);
        continue;
      }
      const [exchange, symbol, type] = instrumentId.split(":");
      const legacy = await ctx.db
        .query("instruments")
        .withIndex("by_exchange_symbol_type", (q) =>
          q.eq("exchange", exchange as "NSE" | "BSE").eq("symbol", symbol)
        )
        .collect();
      const match = legacy.find((row) => row.instrumentType === type) ?? legacy[0];
      if (match) results.push(match);
    }
    return results;
  },
});

/**
 * Creates the small, verified dashboard index catalogue (6 rows).
 *
 * Indices are reference data, not equities: they are not in the bhavcopy
 * instrument master, so without this the dashboard has nothing to quote. It is
 * idempotent, preserves an existing row's `_id`, and never deletes anything.
 */
export const ensureIndexInstruments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const definition of DASHBOARD_INDEX_DEFINITIONS) {
      const instrument = indexDefinitionToInstrument(definition);
      const existing = await ctx.db
        .query("instruments")
        .withIndex("by_instrument_id", (q) => q.eq("instrumentId", instrument.instrumentId))
        .first();

      if (existing) {
        const patch: Partial<Doc<"instruments">> = {};
        if (existing.instrumentType !== "INDEX") patch.instrumentType = "INDEX";
        if (existing.providerIds?.nsemcp !== definition.nseName) {
          patch.providerIds = { ...(existing.providerIds ?? {}), nsemcp: definition.nseName };
        }
        if (existing.isSampleData) {
          patch.isSampleData = false;
          patch.dataSource = "nsemcp";
        }
        if (Object.keys(patch).length > 0) {
          await ctx.db.patch(existing._id, patch);
          updated += 1;
        }
        continue;
      }

      await ctx.db.insert("instruments", {
        symbol: instrument.symbol,
        name: instrument.name,
        exchange: instrument.exchange,
        instrumentType: instrument.instrumentType,
        sector: "Index",
        dataSource: "nsemcp",
        isSampleData: false,
        lastUpdated: now,
        instrumentId: instrument.instrumentId,
        tradingSymbol: instrument.tradingSymbol,
        segment: instrument.segment,
        isActive: true,
        providerIds: instrument.providerIds,
      });
      inserted += 1;
    }

    return { inserted, updated };
  },
});

/** Catalogue rows for the symbols a market ranking returned, for name resolution. */
export const instrumentsBySymbols = internalQuery({
  args: { symbols: v.array(v.string()) },
  handler: async (ctx, args) => {
    const rows: Doc<"instruments">[] = [];
    for (const symbol of args.symbols) {
      const matches = await ctx.db
        .query("instruments")
        .withIndex("by_exchange_symbol", (q) =>
          q.eq("exchange", "NSE").eq("symbol", symbol)
        )
        .collect();
      const match =
        matches.find((row) => row.instrumentType === "EQUITY") ??
        matches.find((row) => row.instrumentType === "ETF") ??
        matches[0];
      if (match) rows.push(match);
    }
    return rows;
  },
});

export const upsertInstrumentMaster = internalMutation({
  args: {
    instruments: v.array(
      v.object({
        instrumentId: v.string(),
        symbol: v.string(),
        tradingSymbol: v.string(),
        name: v.string(),
        exchange: v.union(v.literal("NSE"), v.literal("BSE")),
        instrumentType: v.union(
          v.literal("EQUITY"),
          v.literal("ETF"),
          v.literal("INDEX"),
          v.literal("OTHER")
        ),
        segment: v.string(),
        providerIds: v.object({
          fyers: v.optional(v.string()),
          breeze: v.optional(v.string()),
          tapetide: v.optional(v.string()),
          tejhq: v.optional(v.string()),
          nsemcp: v.optional(v.string()),
        }),
        isin: v.union(v.string(), v.null()),
        tickSize: v.union(v.number(), v.null()),
        lotSize: v.union(v.number(), v.null()),
        isActive: v.boolean(),
        source: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let inserted = 0;
    let updated = 0;

    for (const incoming of args.instruments) {
      const existing = await ctx.db
        .query("instruments")
        .withIndex("by_instrument_id", (q) => q.eq("instrumentId", incoming.instrumentId))
        .first();
      const legacy =
        existing ??
        (await ctx.db
          .query("instruments")
          .withIndex("by_exchange_symbol_type", (q) =>
            q
              .eq("exchange", incoming.exchange)
              .eq("symbol", incoming.symbol)
              .eq("instrumentType", incoming.instrumentType)
          )
          .first());

      if (legacy) {
        await ctx.db.patch(legacy._id, {
          instrumentId: incoming.instrumentId,
          tradingSymbol: incoming.tradingSymbol,
          name: incoming.name,
          segment: incoming.segment,
          isin: incoming.isin ?? undefined,
          tickSize: incoming.tickSize,
          lotSize: incoming.lotSize,
          isActive: incoming.isActive,
          // Merge, never replace: one provider's sync must not erase another's
          // symbol mapping for the same instrument.
          providerIds: { ...(legacy.providerIds ?? {}), ...incoming.providerIds },
          dataSource: incoming.source,
          isSampleData: false,
          lastUpdated: now,
        });
        updated += 1;
      } else {
        await ctx.db.insert("instruments", {
          symbol: incoming.symbol,
          name: incoming.name,
          exchange: incoming.exchange,
          instrumentType: incoming.instrumentType,
          sector: "",
          dataSource: incoming.source,
          isSampleData: false,
          lastUpdated: now,
          instrumentId: incoming.instrumentId,
          tradingSymbol: incoming.tradingSymbol,
          segment: incoming.segment,
          isin: incoming.isin ?? undefined,
          tickSize: incoming.tickSize,
          lotSize: incoming.lotSize,
          isActive: incoming.isActive,
          providerIds: incoming.providerIds,
        });
        inserted += 1;
      }
    }
    return { inserted, updated };
  },
});

/* ------------------------------------------------------------------ */
/* Rate limiting and provider health                                   */
/* ------------------------------------------------------------------ */

export const consumeProviderQuota = internalMutation({
  args: {
    providerId: v.string(),
    limitPerMinute: v.number(),
    limitPerDay: v.optional(v.number()),
    isSuccessfulTest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await ctx.db
      .query("providerState")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .first();

    const rate = consumeRate(
      { windowStart: state?.rateWindowStart ?? 0, count: state?.rateWindowCount ?? 0 },
      now,
      args.limitPerMinute
    );

    const dayStart = istDateToUtcMs(new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
    const daily = args.limitPerDay
      ? consumeDailyQuota(
          { dayStart: state?.dailyWindowStart ?? 0, count: state?.dailyCount ?? 0 },
          now,
          dayStart,
          args.limitPerDay
        )
      : null;

    const allowed = rate.allowed && (daily === null || daily.allowed);

    if (state) {
      await ctx.db.patch(state._id, {
        rateWindowStart: rate.window.windowStart,
        rateWindowCount: rate.window.count,
        dailyWindowStart: daily?.quota.dayStart ?? state.dailyWindowStart,
        dailyCount: daily?.quota.count ?? state.dailyCount,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("providerState", {
        providerId: args.providerId,
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastErrorAt: null,
        lastError: null,
        lastLatencyMs: null,
        instrumentsSyncedAt: null,
        instrumentCount: null,
        rateWindowStart: rate.window.windowStart,
        rateWindowCount: rate.window.count,
        dailyWindowStart: daily?.quota.dayStart ?? 0,
        dailyCount: daily?.quota.count ?? 0,
        updatedAt: now,
      });
    }

    return {
      allowed,
      remainingThisMinute: rate.remaining,
      remainingToday: daily?.remaining ?? null,
      retryAfterMs: allowed ? 0 : rate.retryAfterMs || WINDOW_MS,
    };
  },
});

export const recordProviderResult = internalMutation({
  args: {
    providerId: v.string(),
    ok: v.boolean(),
    latencyMs: v.optional(v.number()),
    error: v.optional(v.string()),
    /** IST date (YYYY-MM-DD) of the newest session the successful call returned. */
    dataDate: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await ctx.db
      .query("providerState")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .first();
    const patch = args.ok
      ? {
          lastAttemptAt: now,
          lastSuccessAt: now,
          lastLatencyMs: args.latencyMs ?? null,
          lastError: null,
          ...(args.dataDate ? { lastDataDate: args.dataDate } : {}),
          updatedAt: now,
        }
      : {
          lastAttemptAt: now,
          lastErrorAt: now,
          lastError: args.error ?? "Unknown provider error",
          updatedAt: now,
        };
    if (state) {
      await ctx.db.patch(state._id, patch);
    } else {
      await ctx.db.insert("providerState", {
        providerId: args.providerId,
        lastAttemptAt: now,
        lastSuccessAt: args.ok ? now : null,
        lastErrorAt: args.ok ? null : now,
        lastError: args.ok ? null : (args.error ?? "Unknown provider error"),
        lastLatencyMs: args.latencyMs ?? null,
        instrumentsSyncedAt: null,
        instrumentCount: null,
        lastDataDate: args.dataDate ?? null,
        rateWindowStart: windowStartFor(now),
        rateWindowCount: 0,
        dailyWindowStart: 0,
        dailyCount: 0,
        updatedAt: now,
      });
    }
  },
});

export const recordInstrumentSync = internalMutation({
  args: { providerId: v.string(), count: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const state = await ctx.db
      .query("providerState")
      .withIndex("by_provider", (q) => q.eq("providerId", args.providerId))
      .first();
    if (state) {
      await ctx.db.patch(state._id, {
        instrumentsSyncedAt: now,
        instrumentCount: args.count,
        lastSuccessAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("providerState", {
        providerId: args.providerId,
        lastAttemptAt: now,
        lastSuccessAt: now,
        lastErrorAt: null,
        lastError: null,
        lastLatencyMs: null,
        instrumentsSyncedAt: now,
        instrumentCount: args.count,
        rateWindowStart: windowStartFor(now),
        rateWindowCount: 0,
        dailyWindowStart: 0,
        dailyCount: 0,
        updatedAt: now,
      });
    }
  },
});

export const providerStates = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("providerState").collect();
  },
});

/** Catalogue counts (sample vs provider-sourced) for status screens. */
export const catalogueCounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("instruments").collect();
    const sample = rows.filter((row) => row.isSampleData).length;
    const lastUpdated = rows.reduce((latest, row) => Math.max(latest, row.lastUpdated), 0);
    return {
      total: rows.length,
      sample,
      provider: rows.length - sample,
      lastUpdated: lastUpdated || null,
    };
  },
});

/**
 * What real data MarketLab actually holds, for the Data Sources feature table.
 * Counts only — no user data leaves this query.
 */
export const dataCoverage = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const datasets = (await ctx.db.query("candleDatasets").collect()).filter(
      (dataset) => dataset.expiresAt === null || dataset.expiresAt > now
    );
    const caches = datasets.filter(
      (dataset) => dataset.kind === "cache" && dataset.source !== "sample"
    );
    const imports = datasets.filter((dataset) => dataset.kind === "import");
    const quotes = await ctx.db.query("marketQuotes").collect();
    const providerQuotes = quotes.filter((quote) => quote.source !== "sample");
    const eodQuotes = providerQuotes.filter((quote) => isEndOfDaySource(quote.source));

    const latestQuoteAt = providerQuotes.reduce(
      (latest, quote) => Math.max(latest, quote.quoteTime ?? 0),
      0
    );
    const latestCandleTs = caches.reduce(
      (latest, dataset) => Math.max(latest, dataset.lastTs ?? 0),
      0
    );

    return {
      instruments: (await ctx.db.query("instruments").collect()).length,
      providerQuotes: providerQuotes.length,
      sampleQuotes: quotes.length - providerQuotes.length,
      eodQuotes: eodQuotes.length,
      cachedCandleSeries: caches.length,
      importedCandleSeries: imports.length,
      candleSources: [...new Set(caches.map((dataset) => dataset.source))],
      latestProviderQuoteAt: latestQuoteAt || null,
      latestQuoteSessionDate: latestQuoteAt ? istDateString(latestQuoteAt) : null,
      latestCandleTs: latestCandleTs || null,
      latestCandleDate: latestCandleTs ? istDateString(latestCandleTs) : null,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * Candidate instruments for a stock screen, filtered at the database level.
 *
 * This lives in the store module rather than beside the screener action that
 * consumes it. A module that reads itself back through `internal.*` makes the
 * generated `api.d.ts` circular, and TypeScript then degrades every
 * `internal.*` result to `{}` across the whole backend.
 *
 * Filter values arrive as strings so this query does not need the screener's
 * literal unions; anything unrecognised narrows to "ALL" instead of matching
 * nothing, and the DB-side search filters still only use validated literals.
 */
export const screenerCandidates = internalQuery({
  args: {
    search: v.optional(v.string()),
    exchange: v.optional(v.string()),
    instrumentType: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const term = (args.search ?? "").trim();
    const rawExchange = args.exchange ?? "ALL";
    const exchange: "NSE" | "BSE" | "ALL" =
      rawExchange === "NSE" || rawExchange === "BSE" ? rawExchange : "ALL";
    const rawType = args.instrumentType ?? "ALL";
    const instrumentType: "EQUITY" | "ETF" | "INDEX" | "OTHER" | "ALL" =
      rawType === "EQUITY" || rawType === "ETF" || rawType === "INDEX" || rawType === "OTHER"
        ? rawType
        : "ALL";

    if (term.length > 0) {
      return await ctx.db
        .query("instruments")
        .withSearchIndex("search_name", (q) => {
          const base = q.search("name", term);
          const scoped = exchange === "ALL" ? base : base.eq("exchange", exchange);
          return instrumentType === "ALL"
            ? scoped
            : scoped.eq("instrumentType", instrumentType);
        })
        .take(args.limit);
    }

    const rows = await ctx.db
      .query("instruments")
      .withIndex("by_exchange")
      .take(args.limit * 3);
    return rows
      .filter((row) => exchange === "ALL" || row.exchange === exchange)
      .filter((row) => instrumentType === "ALL" || row.instrumentType === instrumentType)
      .slice(0, args.limit);
  },
});

export const quotesByInstrumentIds = internalQuery({
  args: { ids: v.array(v.string()), source: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const quotes: Doc<"marketQuotes">[] = [];
    // Calculations (paper fills, alerts, screener) read TejHQ only: an
    // experimental provider must never price an order. Quote views pass the
    // provider they selected explicitly.
    const source = args.source ?? "tejhq";
    for (const instrumentId of args.ids) {
      const quote = await ctx.db
        .query("marketQuotes")
        .withIndex("by_instrument_source", (q) =>
          q.eq("instrumentId", instrumentId).eq("source", source)
        )
        .first();
      if (quote) quotes.push(quote);
    }
    return quotes;
  },
});

/** The signed-in user's chosen informational quote source, or null. */
export const preferredQuoteProvider = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return profile?.quoteProvider ?? null;
  },
});

/** The signed-in user's chosen chart-history source, or null (TejHQ default). */
export const preferredChartSource = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return profile?.chartSource ?? null;
  },
});

/** Latest stored quotes, newest first, for ranking (gainers/losers). */
export const recentQuotes = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const quotes = await ctx.db.query("marketQuotes").collect();
    // Multiple providers may cache the same instrument; keep the freshest row
    // per instrument so a mover never appears twice.
    const newest = new Map<string, Doc<"marketQuotes">>();
    for (const quote of quotes) {
      if (quote.source === "sample") continue;
      const existing = newest.get(quote.instrumentId);
      if (!existing || (quote.quoteTime ?? 0) > (existing.quoteTime ?? 0)) {
        newest.set(quote.instrumentId, quote);
      }
    }
    return [...newest.values()]
      .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
      .slice(0, args.limit);
  },
});

export const upsertQuotes = internalMutation({
  args: {
    quotes: v.array(
      v.object({
        instrumentId: v.string(),
        symbol: v.string(),
        exchange: v.union(v.literal("NSE"), v.literal("BSE")),
        lastPrice: v.number(),
        change: v.union(v.number(), v.null()),
        changePercent: v.union(v.number(), v.null()),
        open: v.union(v.number(), v.null()),
        high: v.union(v.number(), v.null()),
        low: v.union(v.number(), v.null()),
        previousClose: v.union(v.number(), v.null()),
        volume: v.union(v.number(), v.null()),
        bid: v.union(v.number(), v.null()),
        ask: v.union(v.number(), v.null()),
        quoteTime: v.union(v.number(), v.null()),
        source: v.string(),
        mode: dataModeValidator,
      })
    ),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    for (const quote of args.quotes) {
      // One cache row per (instrument, provider), so switching sources can never
      // surface another provider's price under the new provider's name.
      const existing = await ctx.db
        .query("marketQuotes")
        .withIndex("by_instrument_source", (q) =>
          q.eq("instrumentId", quote.instrumentId).eq("source", quote.source)
        )
        .first();
      const record = { ...quote, fetchedAt: args.fetchedAt };
      if (existing) await ctx.db.patch(existing._id, record);
      else await ctx.db.insert("marketQuotes", record);
    }
    return args.quotes.length;
  },
});

export const upsertFundamentals = internalMutation({
  args: {
    records: v.array(
      v.object({
        instrumentId: v.string(),
        symbol: v.string(),
        source: v.string(),
        mode: dataModeValidator,
        fetchedAt: v.number(),
        asOf: v.union(v.string(), v.null()),
        peTtm: v.union(v.number(), v.null()),
        marketCapCrore: v.union(v.number(), v.null()),
        high52w: v.union(v.number(), v.null()),
        low52w: v.union(v.number(), v.null()),
        sections: v.array(v.object({ name: v.string(), periodCount: v.number() })),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const record of args.records) {
      const existing = await ctx.db
        .query("fundamentals")
        .withIndex("by_instrument", (q) => q.eq("instrumentId", record.instrumentId))
        .first();
      if (existing) await ctx.db.patch(existing._id, record);
      else await ctx.db.insert("fundamentals", record);
    }
  },
});

export const fundamentalsByInstrumentIds = internalQuery({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const records: Doc<"fundamentals">[] = [];
    for (const instrumentId of args.ids) {
      const record = await ctx.db
        .query("fundamentals")
        .withIndex("by_instrument", (q) => q.eq("instrumentId", instrumentId))
        .first();
      if (record) records.push(record);
    }
    return records;
  },
});

/* ------------------------------------------------------------------ */
/* Candles                                                             */
/* ------------------------------------------------------------------ */

const candleValidator = v.object({
  ts: v.number(),
  open: v.number(),
  high: v.number(),
  low: v.number(),
  close: v.number(),
  volume: v.union(v.number(), v.null()),
});

/**
 * Replaces the cached candle window for an instrument/interval/source.
 * Old cache rows are deleted so the cache never grows without bound.
 */
export const replaceCacheDataset = internalMutation({
  args: {
    instrumentId: v.string(),
    interval: intervalValidator,
    source: v.string(),
    adjusted: adjustedValidator,
    candles: v.array(candleValidator),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.candles.length === 0) return { datasetId: null, rowCount: 0 };
    const now = Date.now();

    const existing = await ctx.db
      .query("candleDatasets")
      .withIndex("by_instrument_interval", (q) =>
        q.eq("instrumentId", args.instrumentId).eq("interval", args.interval)
      )
      .collect();
    for (const dataset of existing) {
      if (dataset.kind !== "cache" || dataset.source !== args.source) continue;
      const rows = await ctx.db
        .query("candles")
        .withIndex("by_dataset", (q) => q.eq("datasetId", dataset._id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
      await ctx.db.delete(dataset._id);
    }

    const datasetId = await ctx.db.insert("candleDatasets", {
      kind: "cache",
      name: `${args.source} ${args.interval} cache`,
      instrumentId: args.instrumentId,
      interval: args.interval,
      source: args.source,
      mode: "HISTORICAL",
      adjusted: args.adjusted,
      rowCount: args.candles.length,
      firstTs: args.candles[0].ts,
      lastTs: args.candles[args.candles.length - 1].ts,
      expiresAt: now + args.ttlMs,
      createdAt: now,
      updatedAt: now,
    });

    for (const candle of args.candles) {
      await ctx.db.insert("candles", {
        datasetId,
        instrumentId: args.instrumentId,
        interval: args.interval,
        ...candle,
      });
    }
    return { datasetId, rowCount: args.candles.length };
  },
});

/** Newest non-expired dataset for an instrument/interval, with its rows. */
export const latestDataset = internalQuery({
  args: {
    instrumentId: v.string(),
    interval: intervalValidator,
    ownerId: v.union(v.id("users"), v.null()),
    fromMs: v.number(),
    toMs: v.number(),
    limit: v.number(),
    /** Restrict provider caches to one source; imports are always eligible. */
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const datasets = await ctx.db
      .query("candleDatasets")
      .withIndex("by_instrument_interval", (q) =>
        q.eq("instrumentId", args.instrumentId).eq("interval", args.interval)
      )
      .collect();

    const usable = datasets
      .filter((dataset) => dataset.expiresAt === null || dataset.expiresAt > now)
      .filter(
        (dataset) =>
          dataset.kind === "cache" ||
          (dataset.kind === "import" && dataset.ownerId === args.ownerId)
      )
      // A TejHQ cache must never be served as if it came from NSE Bhavcopy.
      .filter((dataset) => dataset.kind === "import" || !args.source || dataset.source === args.source)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const dataset = usable[0];
    if (!dataset) return null;

    const rows = await ctx.db
      .query("candles")
      .withIndex("by_dataset_ts", (q) =>
        q.eq("datasetId", dataset._id).gte("ts", args.fromMs).lte("ts", args.toMs)
      )
      .take(args.limit);

    return {
      dataset: {
        _id: dataset._id,
        kind: dataset.kind,
        source: dataset.source,
        interval: dataset.interval,
        mode: dataset.mode,
        adjusted: dataset.adjusted,
        firstTs: dataset.firstTs,
        lastTs: dataset.lastTs,
        rowCount: dataset.rowCount,
        updatedAt: dataset.updatedAt,
        expiresAt: dataset.expiresAt,
      },
      candles: rows.map(
        (row): NormalizedCandle => ({
          instrumentId: row.instrumentId,
          interval: row.interval,
          ts: row.ts,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          source: dataset.source as NormalizedCandle["source"],
          mode: dataset.mode as NormalizedCandle["mode"],
          adjusted: dataset.adjusted as NormalizedCandle["adjusted"],
        })
      ),
    };
  },
});

/** Deletes expired cache datasets (called opportunistically by actions). */
export const purgeExpiredCaches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const caches = await ctx.db
      .query("candleDatasets")
      .withIndex("by_kind", (q) => q.eq("kind", "cache"))
      .collect();
    let deleted = 0;
    for (const dataset of caches) {
      if (dataset.expiresAt === null || dataset.expiresAt > now) continue;
      const rows = await ctx.db
        .query("candles")
        .withIndex("by_dataset", (q) => q.eq("datasetId", dataset._id))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
      await ctx.db.delete(dataset._id);
      deleted += 1;
    }
    return deleted;
  },
});

/* ------------------------------------------------------------------ */
/* CSV imports                                                         */
/* ------------------------------------------------------------------ */

export const createImport = internalMutation({
  args: {
    userId: v.id("users"),
    instrumentId: v.string(),
    instrumentLabel: v.string(),
    interval: intervalValidator,
    fileName: v.string(),
    candles: v.array(candleValidator),
    totalRows: v.number(),
    rejectedRows: v.number(),
    duplicatedRows: v.number(),
    rejectionSample: v.array(v.object({ line: v.number(), reason: v.string() })),
    error: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const status = args.candles.length > 0 ? "completed" : "failed";

    let datasetId: Id<"candleDatasets"> | null = null;
    if (status === "completed") {
      datasetId = await ctx.db.insert("candleDatasets", {
        kind: "import",
        name: args.fileName,
        instrumentId: args.instrumentId,
        interval: args.interval,
        source: "csv_import",
        mode: "HISTORICAL",
        adjusted: "unknown",
        ownerId: args.userId,
        rowCount: args.candles.length,
        firstTs: args.candles[0].ts,
        lastTs: args.candles[args.candles.length - 1].ts,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      });
      for (const candle of args.candles) {
        await ctx.db.insert("candles", {
          datasetId,
          instrumentId: args.instrumentId,
          interval: args.interval,
          ...candle,
        });
      }
    }

    await ctx.db.insert("dataImports", {
      userId: args.userId,
      instrumentId: args.instrumentId,
      instrumentLabel: args.instrumentLabel,
      interval: args.interval,
      fileName: args.fileName,
      status,
      datasetId,
      totalRows: args.totalRows,
      acceptedRows: args.candles.length,
      rejectedRows: args.rejectedRows,
      duplicatedRows: args.duplicatedRows,
      firstTs: args.candles.length > 0 ? args.candles[0].ts : null,
      lastTs: args.candles.length > 0 ? args.candles[args.candles.length - 1].ts : null,
      rejectionSample: args.rejectionSample.slice(0, 20),
      error: args.error,
      createdAt: now,
    });

    return { status, datasetId, acceptedRows: args.candles.length };
  },
});

export const importsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dataImports")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
  },
});

export const deleteImport = internalMutation({
  args: { userId: v.id("users"), importId: v.id("dataImports") },
  handler: async (ctx, args) => {
    const record = await ctx.db.get(args.importId);
    if (!record) throw new Error("Import not found");
    if (record.userId !== args.userId) throw new Error("Not authorized");
    if (record.datasetId) {
      const rows = await ctx.db
        .query("candles")
        .withIndex("by_dataset", (q) => q.eq("datasetId", record.datasetId as Id<"candleDatasets">))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
      await ctx.db.delete(record.datasetId);
    }
    await ctx.db.delete(args.importId);
    return { deleted: true };
  },
});

/* ------------------------------------------------------------------ */
/* Market calendar                                                     */
/* ------------------------------------------------------------------ */

export const holidays = internalQuery({
  args: { fromDate: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("marketCalendar").collect();
    return rows.map((row) => row.date).filter((date) => date >= args.fromDate);
  },
});

export const addHolidays = internalMutation({
  args: { holidays: v.array(v.object({ date: v.string(), description: v.string() })) },
  handler: async (ctx, args) => {
    let inserted = 0;
    for (const holiday of args.holidays) {
      const existing = await ctx.db
        .query("marketCalendar")
        .withIndex("by_date", (q) => q.eq("date", holiday.date))
        .first();
      if (existing) continue;
      await ctx.db.insert("marketCalendar", holiday);
      inserted += 1;
    }
    return inserted;
  },
});

export type StoredQuote = Doc<"marketQuotes">;
export type StoredInstrument = Doc<"instruments">;
export type NormalizedInstrumentInput = NormalizedInstrument;
export type NormalizedQuoteInput = NormalizedQuote;
export type StoredImport = Doc<"dataImports">;
