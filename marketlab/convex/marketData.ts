import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  ALL_PROVIDERS,
  availableIntervals,
  getProvider,
  providerFor,
  providerStatuses,
} from "./market/registry";
import {
  classifyQuoteMode,
  findGaps,
  normalizeCandles,
  redactError,
} from "./market/normalize";
import { istDateString, marketSession } from "./market/time";
import { featureDataModes, isCandleCacheFresh, isEndOfDaySource } from "./market/provenance";
import { sampleQuote } from "./market/sample";
import {
  noProviderNote,
  providerFallbackWarning,
  sampleCandleFallback,
} from "./market/fallback";
import { parseOhlcvCsv } from "./market/csv";
import {
  INTERVAL_MS,
  makeInstrumentId,
  type DataMode,
  type Interval,
  type NormalizedCandle,
  type NormalizedInstrument,
  type NormalizedQuote,
  type ProviderId,
} from "./market/types";
import { FYERS_RATE_LIMIT_PER_MINUTE } from "./market/providers/fyers";
import { BREEZE_RATE_LIMIT_PER_MINUTE } from "./market/providers/breeze";
import {
  TAPETIDE_DAILY_LIMIT,
  TAPETIDE_RATE_LIMIT_PER_MINUTE,
} from "./market/providers/tapetide";
import { TEJHQ_RATE_LIMIT_PER_MINUTE } from "./market/providers/tejhq";
// Type-only contract for the action results. These annotations are what keep the
// generated `api.d.ts` acyclic: without them the return types of actions that call
// `internal.*` are inferred through the API object they are part of, and
// TypeScript then degrades every `internal.*` result to `{}`. They are erased at
// bundle time, so nothing from `src/` is shipped to the backend.
import type {
  CandleResult,
  CsvImportResult,
  FundamentalsResult,
  ProviderOverview,
  QuotesResult,
  TestProviderResult,
} from "../src/lib/marketClient";

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

/** Quotes are refreshed at most this often. */
const QUOTE_REFRESH_MS = 30_000;
/**
 * EOD-only providers publish once per session, so re-asking every 30s wastes
 * quota and can never return anything new. Six hours still picks up the evening
 * bhavcopy and the next session within a few hours.
 */
const EOD_QUOTE_REFRESH_MS = 6 * 60 * 60_000;
/** A cached quote stops being shown as fresh after this. */
const QUOTE_LABEL_TTL_MS = 180_000;
/** A quote tick older than this can never be called LIVE. */
const MAX_LIVE_TICK_AGE_MS = 120_000;
/** Provider candle windows are kept this long before being re-fetched. */
const CANDLE_CACHE_TTL_MS = 30 * 60_000;
/** Hard cap on candles returned to the browser (and cached per request). */
const MAX_CANDLES = 3000;
/** Hard cap on quotes per request (FYERS allows 50 per call). */
const MAX_QUOTE_SYMBOLS = 60;

const exchangeArg = v.union(v.literal("NSE"), v.literal("BSE"));
const exchangeFilter = v.union(v.literal("NSE"), v.literal("BSE"), v.literal("ALL"));
const instrumentTypeArg = v.union(
  v.literal("EQUITY"),
  v.literal("ETF"),
  v.literal("INDEX"),
  v.literal("OTHER")
);
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

function readEnv(): Record<string, string | undefined> {
  // Only actions can read deployment environment variables.
  return (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
}

const RATE_LIMIT: Record<ProviderId, number> = {
  fyers: FYERS_RATE_LIMIT_PER_MINUTE,
  breeze: BREEZE_RATE_LIMIT_PER_MINUTE,
  tapetide: TAPETIDE_RATE_LIMIT_PER_MINUTE,
  tejhq: TEJHQ_RATE_LIMIT_PER_MINUTE,
};

const DAILY_LIMIT: Partial<Record<ProviderId, number>> = {
  tapetide: TAPETIDE_DAILY_LIMIT,
};

/** Converts a database row into the provider-neutral instrument shape. */
export function toNormalizedInstrument(row: Doc<"instruments">): NormalizedInstrument {
  const instrumentId =
    row.instrumentId ?? makeInstrumentId(row.exchange, row.symbol, row.instrumentType);
  return {
    instrumentId,
    symbol: row.symbol,
    tradingSymbol:
      row.tradingSymbol ??
      `${row.exchange}:${row.symbol}${row.instrumentType === "INDEX" ? "-INDEX" : "-EQ"}`,
    name: row.name,
    exchange: row.exchange,
    instrumentType: row.instrumentType,
    segment: row.segment ?? "CM",
    providerIds: row.providerIds ?? {},
    isin: row.isin ?? null,
    tickSize: row.tickSize ?? null,
    lotSize: row.lotSize ?? null,
    isActive: row.isActive ?? true,
    source: row.isSampleData ? "sample" : ((row.dataSource as ProviderId) ?? "sample"),
    isSampleData: row.isSampleData,
  };
}

const MODE_PRIORITY: DataMode[] = ["LIVE", "DELAYED", "CACHED", "HISTORICAL", "SAMPLE"];

function overallMode(modes: DataMode[]): DataMode {
  if (modes.length === 0) return "SAMPLE";
  if (modes.every((mode) => mode === "SAMPLE")) return "SAMPLE";
  for (const mode of MODE_PRIORITY) {
    if (modes.includes(mode)) return mode;
  }
  return "SAMPLE";
}

/** Applies the freshness rules to a provider or cached quote. */
function labelQuote(
  quote: NormalizedQuote,
  context: { nowMs: number; fetchedAt: number; marketOpen: boolean }
): NormalizedQuote {
  const mode = classifyQuoteMode({
    source: quote.source,
    // Tapetide publishes delayed snapshots and TejHQ is end-of-day: neither may
    // ever be upgraded to LIVE by the freshness rules.
    providerMode:
      quote.source === "tapetide" || quote.source === "tejhq" ? "DELAYED" : undefined,
    quoteTime: quote.quoteTime,
    fetchedAt: context.fetchedAt,
    nowMs: context.nowMs,
    ttlMs: QUOTE_LABEL_TTL_MS,
    marketOpen: context.marketOpen,
    maxLiveAgeMs: MAX_LIVE_TICK_AGE_MS,
  });
  return { ...quote, mode, eod: isEndOfDaySource(quote.source) };
}

/* ------------------------------------------------------------------ */
/* Instrument explorer (queries)                                       */
/* ------------------------------------------------------------------ */

/**
 * Server-side instrument search with pagination.
 *
 * Free-text search uses Convex full-text indexes on symbol and name and returns
 * the best `limit` matches. Browsing (empty search) is cursor-paginated in
 * symbol order. Exchange/type filters are applied inside the search index and
 * in memory for browse pages.
 */
export const searchInstruments = query({
  args: {
    search: v.optional(v.string()),
    exchange: v.optional(exchangeFilter),
    instrumentType: v.optional(instrumentTypeFilter),
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, args.limit ?? 24), 100);
    const term = (args.search ?? "").trim();
    const exchange = args.exchange ?? "ALL";
    const instrumentType = args.instrumentType ?? "ALL";

    if (term.length > 0) {
      const runSearch = async (index: "search_symbol" | "search_name") =>
        await ctx.db
          .query("instruments")
          .withSearchIndex(index, (q) => {
            const base = q.search(index === "search_symbol" ? "symbol" : "name", term);
            const scoped = exchange === "ALL" ? base : base.eq("exchange", exchange);
            return instrumentType === "ALL"
              ? scoped
              : scoped.eq("instrumentType", instrumentType);
          })
          .take(limit);

      const [bySymbol, byName] = await Promise.all([
        runSearch("search_symbol"),
        runSearch("search_name"),
      ]);
      const seen = new Set<string>();
      const merged = [...bySymbol, ...byName]
        .filter((row) => {
          if (seen.has(row._id)) return false;
          seen.add(row._id);
          return true;
        })
        .sort((a, b) => {
          const aExact = a.symbol.toLowerCase() === term.toLowerCase() ? 0 : 1;
          const bExact = b.symbol.toLowerCase() === term.toLowerCase() ? 0 : 1;
          if (aExact !== bExact) return aExact - bExact;
          return a.symbol.localeCompare(b.symbol);
        })
        .slice(0, limit);

      return {
        items: merged,
        nextCursor: null as string | null,
        isDone: true,
        mode: "search" as const,
      };
    }

    const page = await ctx.db.query("instruments").withIndex("by_symbol").paginate({
      numItems: limit,
      cursor: args.cursor ?? null,
    });
    const items = page.page.filter((row) => {
      if (exchange !== "ALL" && row.exchange !== exchange) return false;
      if (instrumentType !== "ALL" && row.instrumentType !== instrumentType) return false;
      return true;
    });
    return {
      items,
      nextCursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      mode: "browse" as const,
    };
  },
});

/** Single instrument by internal id (falls back to exchange:symbol:type parsing). */
export const getInstrument = query({
  args: { instrumentId: v.string() },
  handler: async (ctx, args) => {
    const direct = await ctx.db
      .query("instruments")
      .withIndex("by_instrument_id", (q) => q.eq("instrumentId", args.instrumentId))
      .first();
    if (direct) return direct;

    const [exchange, symbol, type] = args.instrumentId.split(":");
    if (!exchange || !symbol) return null;
    const rows = await ctx.db
      .query("instruments")
      .withIndex("by_exchange_symbol", (q) =>
        q.eq("exchange", exchange as "NSE" | "BSE").eq("symbol", symbol)
      )
      .collect();
    return rows.find((row) => row.instrumentType === type) ?? rows[0] ?? null;
  },
});

/** Instrument catalogue counts, used by the explorer header. */
export const catalogueStats = query({
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
 * Exchange session status. Derived from UTC → IST conversion plus the stored
 * holiday list; never from the browser clock. Reports when holidays are not
 * configured instead of silently implying a full calendar.
 */
export const marketStatus = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const holidays = await ctx.db.query("marketCalendar").collect();
    const session = marketSession(
      now,
      holidays.map((row) => row.date)
    );
    return {
      ...session,
      now,
      holidaysConfigured: holidays.length > 0,
      holidayCount: holidays.length,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Quotes (action)                                                     */
/* ------------------------------------------------------------------ */

export const getQuotes = action({
  args: {
    instrumentIds: v.array(v.string()),
    forceRefresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<QuotesResult> => {
    const ids = [...new Set(args.instrumentIds)].slice(0, MAX_QUOTE_SYMBOLS);
    const now = Date.now();
    if (ids.length === 0) {
      const holidaysForEmpty = await ctx.runQuery(internal.marketStore.holidays, {
        fromDate: istDateString(now - 3 * 24 * 60 * 60 * 1000),
      });
      return {
        quotes: [],
        mode: "SAMPLE" as DataMode,
        source: "sample",
        asOf: now,
        session: marketSession(now, holidaysForEmpty),
        note: null,
        warning: null,
      };
    }

    const rows = await ctx.runQuery(internal.marketStore.instrumentsByIds, { ids });
    const instruments = rows.map(toNormalizedInstrument);
    const holidays = await ctx.runQuery(internal.marketStore.holidays, {
      fromDate: istDateString(now - 3 * 24 * 60 * 60 * 1000),
    });
    const session = marketSession(now, holidays);
    const marketOpen = session.status === "OPEN";

    const userId = await ctx.runQuery(internal.marketStore.currentUserId, {});
    const env = readEnv();
    const provider = userId ? providerFor(env, "quotes") : null;

    const cachedRows = await ctx.runQuery(internal.marketStore.quotesByInstrumentIds, { ids });
    const cachedById = new Map(cachedRows.map((row) => [row.instrumentId, row]));

    let warning: string | null = null;
    let note: string | null = null;
    const quotesById = new Map<string, NormalizedQuote>();

    for (const row of cachedRows) {
      const cached: NormalizedQuote = {
        instrumentId: row.instrumentId,
        symbol: row.symbol,
        exchange: row.exchange,
        lastPrice: row.lastPrice,
        change: row.change,
        changePercent: row.changePercent,
        open: row.open,
        high: row.high,
        low: row.low,
        previousClose: row.previousClose,
        volume: row.volume,
        bid: row.bid,
        ask: row.ask,
        quoteTime: row.quoteTime,
        source: row.source as NormalizedQuote["source"],
        mode: row.mode,
        eod: isEndOfDaySource(row.source),
      };
      quotesById.set(row.instrumentId, labelQuote(cached, { nowMs: now, fetchedAt: row.fetchedAt, marketOpen }));
    }

    const needsRefresh = instruments.filter((instrument) => {
      const cached = cachedById.get(instrument.instrumentId);
      if (!cached) return true;
      if (args.forceRefresh) return true;
      // An EOD-only provider cannot produce a new price between sessions.
      if (isEndOfDaySource(cached.source)) return now - cached.fetchedAt > EOD_QUOTE_REFRESH_MS;
      // Outside exchange hours the last snapshot stays valid, so no quota is spent.
      if (!marketOpen) return cached.source === "sample";
      return now - cached.fetchedAt > QUOTE_REFRESH_MS;
    });

    if (provider && provider.fetchQuotes && needsRefresh.length > 0) {
      const quota = await ctx.runMutation(internal.marketStore.consumeProviderQuota, {
        providerId: provider.id,
        limitPerMinute: RATE_LIMIT[provider.id],
        limitPerDay: DAILY_LIMIT[provider.id],
      });
      if (!quota.allowed) {
        warning = `${provider.label} rate limit reached — showing cached values. Retry in ${Math.ceil(
          quota.retryAfterMs / 1000
        )}s.`;
      } else {
        const startedAt = Date.now();
        try {
          const fresh = await provider.fetchQuotes(env, needsRefresh);
          const fetchedAt = Date.now();
          const labelled = fresh.map((quote) =>
            labelQuote(quote, { nowMs: fetchedAt, fetchedAt, marketOpen })
          );
          if (labelled.length > 0) {
            await ctx.runMutation(internal.marketStore.upsertQuotes, {
              quotes: labelled.map((quote) => ({
                instrumentId: quote.instrumentId,
                symbol: quote.symbol,
                exchange: quote.exchange,
                lastPrice: quote.lastPrice,
                change: quote.change,
                changePercent: quote.changePercent,
                open: quote.open,
                high: quote.high,
                low: quote.low,
                previousClose: quote.previousClose,
                volume: quote.volume,
                bid: quote.bid,
                ask: quote.ask,
                quoteTime: quote.quoteTime,
                source: quote.source,
                mode: quote.mode,
              })),
              fetchedAt,
            });
          }
          for (const quote of labelled) quotesById.set(quote.instrumentId, quote);
          const eod = isEndOfDaySource(provider.id);
          const newestQuoteTime = labelled.reduce(
            (latest, quote) => Math.max(latest, quote.quoteTime ?? 0),
            0
          );
          await ctx.runMutation(internal.marketStore.recordProviderResult, {
            providerId: provider.id,
            ok: true,
            latencyMs: Date.now() - startedAt,
            dataDate: eod && newestQuoteTime ? istDateString(newestQuoteTime) : null,
          });
        } catch (error) {
          const message = redactError(error);
          await ctx.runMutation(internal.marketStore.recordProviderResult, {
            providerId: provider.id,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: message,
          });
          warning = `${provider.label} request failed: ${message}`;
        }
      }
    } else if (!provider) {
      note =
        userId === null
          ? "Sign in and configure a market-data provider for real quotes — showing sample data."
          : "No market-data provider is configured — showing sample data. Add credentials on the Data Sources page.";
    }

    const quotes: NormalizedQuote[] = instruments.map((instrument) => {
      const existing = quotesById.get(instrument.instrumentId);
      if (existing && existing.source !== "sample") return existing;
      const sample = sampleQuote(instrument, now);
      return existing ?? sample;
    });

    // A provider answering for only part of the request must not leave the rest
    // looking real. Name the instruments that fell back to synthetic prices.
    if (provider) {
      const missing = instruments.filter((instrument) => {
        const quote = quotesById.get(instrument.instrumentId);
        return !quote || quote.source === "sample";
      });
      if (missing.length > 0) {
        const names = missing.slice(0, 5).map((instrument) => instrument.symbol).join(", ");
        const more = missing.length > 5 ? ` and ${missing.length - 5} more` : "";
        const message = `${provider.label} returned no price for ${names}${more} — those rows are SAMPLE data, not market prices.`;
        warning = warning ? `${warning} ${message}` : message;
      }
      if (isEndOfDaySource(provider.id)) {
        const real = quotes.filter((quote) => quote.source === provider.id && quote.eod);
        const newest = real.reduce((latest, quote) => Math.max(latest, quote.quoteTime ?? 0), 0);
        note = `TejHQ publishes end-of-day prices only: the close of the last completed session${
          newest ? ` (${istDateString(newest)})` : ""
        }. These are not live or intraday quotes.`;
      }
    }

    const modes = quotes.map((quote) => quote.mode);
    const source = quotes.find((quote) => quote.source !== "sample")?.source ?? "sample";
    return {
      quotes,
      mode: overallMode(modes),
      source,
      asOf: now,
      session,
      note,
      warning,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Candles (action)                                                    */
/* ------------------------------------------------------------------ */

function defaultRange(interval: Interval, now: number): { fromMs: number; toMs: number } {
  const day = 24 * 60 * 60 * 1000;
  const toMs = now;
  switch (interval) {
    case "1m":
    case "5m":
      return { fromMs: now - 5 * day, toMs };
    case "15m":
    case "1h":
      return { fromMs: now - 30 * day, toMs };
    case "1d":
    case "1w":
      return { fromMs: now - 730 * day, toMs };
    case "1M":
      return { fromMs: now - 3650 * day, toMs };
    default:
      return { fromMs: now - 90 * day, toMs };
  }
}

export const getCandles = action({
  args: {
    instrumentId: v.string(),
    interval: intervalArg,
    fromMs: v.optional(v.number()),
    toMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<CandleResult> => {
    const now = Date.now();
    const interval = args.interval as Interval;
    const range = defaultRange(interval, now);
    const fromMs = args.fromMs ?? range.fromMs;
    const toMs = args.toMs ?? range.toMs;

    const rows = await ctx.runQuery(internal.marketStore.instrumentsByIds, {
      ids: [args.instrumentId],
    });
    if (rows.length === 0) throw new Error("Instrument not found");
    const instrument = toNormalizedInstrument(rows[0]);

    const userId = (await ctx.runQuery(internal.marketStore.currentUserId, {})) as
      | Id<"users">
      | null;
    const env = readEnv();
    const provider = userId ? providerFor(env, "candles", interval) : null;

    const cached = await ctx.runQuery(internal.marketStore.latestDataset, {
      instrumentId: instrument.instrumentId,
      interval,
      ownerId: userId,
      fromMs,
      toMs,
      limit: MAX_CANDLES,
    });

    const cacheIsFresh =
      cached !== null &&
      isCandleCacheFresh(
        {
          kind: cached.dataset.kind,
          updatedAt: cached.dataset.updatedAt,
          lastTs: cached.dataset.lastTs ?? null,
          rowCount: cached.candles.length,
        },
        {
          nowMs: now,
          toMs,
          intervalMs: INTERVAL_MS[interval],
          ttlMs: CANDLE_CACHE_TTL_MS,
        }
      );

    if (cacheIsFresh && cached) {
      const gaps = findGaps(cached.candles, interval);
      return {
        instrumentId: instrument.instrumentId,
        symbol: instrument.symbol,
        interval,
        candles: cached.candles,
        mode: cached.dataset.mode as DataMode,
        source: cached.dataset.source,
        adjusted: cached.dataset.adjusted,
        fetchedAt: cached.dataset.updatedAt,
        note:
          cached.dataset.kind === "import"
            ? "Served from your imported CSV dataset."
            : cached.dataset.source === "tejhq"
              ? "End-of-day (EOD) daily bars from TejHQ — completed sessions only, not intraday data."
              : null,
        warning: null as string | null,
        quality: {
          rowCount: cached.candles.length,
          gaps: gaps.count,
          gapSamples: gaps.firstFew,
          firstTs: cached.candles[0]?.ts ?? null,
          lastTs: cached.candles[cached.candles.length - 1]?.ts ?? null,
          fromCache: true,
        },
      };
    }

    if (provider && provider.fetchCandles) {
      const quota = await ctx.runMutation(internal.marketStore.consumeProviderQuota, {
        providerId: provider.id,
        limitPerMinute: RATE_LIMIT[provider.id],
        limitPerDay: DAILY_LIMIT[provider.id],
      });
      if (quota.allowed) {
        const startedAt = Date.now();
        try {
          const fetched = await provider.fetchCandles(env, { instrument, interval, fromMs, toMs });
          const normalized = normalizeCandles(fetched).candles.slice(-MAX_CANDLES);
          await ctx.runMutation(internal.marketStore.recordProviderResult, {
            providerId: provider.id,
            ok: true,
            latencyMs: Date.now() - startedAt,
            dataDate:
              normalized.length > 0
                ? istDateString(normalized[normalized.length - 1].ts)
                : null,
          });
          if (normalized.length > 0) {
            await ctx.runMutation(internal.marketStore.replaceCacheDataset, {
              instrumentId: instrument.instrumentId,
              interval,
              source: provider.id,
              adjusted: normalized[0].adjusted,
              candles: normalized.map((candle) => ({
                ts: candle.ts,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                volume: candle.volume,
              })),
              ttlMs: CANDLE_CACHE_TTL_MS * 4,
            });
            const gaps = findGaps(normalized, interval);
            return {
              instrumentId: instrument.instrumentId,
              symbol: instrument.symbol,
              interval,
              candles: normalized,
              mode: "HISTORICAL" as DataMode,
              source: provider.id,
              adjusted: normalized[0].adjusted,
              fetchedAt: Date.now(),
              // TejHQ is an end-of-day feed: say so on the series rather than
              // letting a HISTORICAL badge imply intraday coverage.
              note:
                provider.id === "tejhq"
                  ? "End-of-day (EOD) daily bars from TejHQ — completed sessions only, not intraday data."
                  : null,
              warning: null as string | null,
              quality: {
                rowCount: normalized.length,
                gaps: gaps.count,
                gapSamples: gaps.firstFew,
                firstTs: normalized[0].ts,
                lastTs: normalized[normalized.length - 1].ts,
                fromCache: false,
              },
            };
          }
        } catch (error) {
          const message = redactError(error);
          await ctx.runMutation(internal.marketStore.recordProviderResult, {
            providerId: provider.id,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: message,
          });
          return {
            ...buildSampleSeries(instrument, interval, fromMs, toMs),
            warning: providerFallbackWarning(provider.label, message),
          };
        }
      }
    }

    // Imported data (any age) is still better than synthetic data.
    if (cached && cached.dataset.kind === "import" && cached.candles.length > 0) {
      const gaps = findGaps(cached.candles, interval);
      return {
        instrumentId: instrument.instrumentId,
        symbol: instrument.symbol,
        interval,
        candles: cached.candles,
        mode: "HISTORICAL" as DataMode,
        source: "csv_import",
        adjusted: cached.dataset.adjusted,
        fetchedAt: cached.dataset.updatedAt,
        note: "Served from your imported CSV dataset.",
        warning: null as string | null,
        quality: {
          rowCount: cached.candles.length,
          gaps: gaps.count,
          gapSamples: gaps.firstFew,
          firstTs: cached.candles[0]?.ts ?? null,
          lastTs: cached.candles[cached.candles.length - 1]?.ts ?? null,
          fromCache: true,
        },
      };
    }

    return {
      ...buildSampleSeries(instrument, interval, fromMs, toMs),
      note: noProviderNote({
        signedIn: Boolean(userId),
        providerLabel: provider?.label ?? null,
        interval,
      }),
    };
  },
});

function buildSampleSeries(
  instrument: NormalizedInstrument,
  interval: Interval,
  fromMs: number,
  toMs: number
) {
  return sampleCandleFallback({
    instrument,
    interval,
    fromMs,
    toMs,
    nowMs: Date.now(),
    maxCandles: MAX_CANDLES,
  });
}

/* ------------------------------------------------------------------ */
/* Fundamentals (action)                                               */
/* ------------------------------------------------------------------ */

export const getFundamentals = action({
  args: { instrumentId: v.string() },
  handler: async (ctx, args): Promise<FundamentalsResult> => {
    const rows = await ctx.runQuery(internal.marketStore.instrumentsByIds, {
      ids: [args.instrumentId],
    });
    if (rows.length === 0) throw new Error("Instrument not found");
    const instrument = toNormalizedInstrument(rows[0]);
    const env = readEnv();
    const provider = providerFor(env, "fundamentals");
    const cached = await ctx.runQuery(internal.marketStore.fundamentalsByInstrumentIds, {
      ids: [instrument.instrumentId],
    });
    const existing = cached[0];
    if (existing && Date.now() - existing.fetchedAt < 24 * 60 * 60 * 1000) {
      return { fundamentals: existing, note: null as string | null };
    }
    if (!provider?.fetchFundamentals) {
      return {
        fundamentals: null,
        note: "No fundamentals provider configured. Set TAPETIDE_API_TOKEN to enable company fundamentals.",
      };
    }
    const quota = await ctx.runMutation(internal.marketStore.consumeProviderQuota, {
      providerId: provider.id,
      limitPerMinute: RATE_LIMIT[provider.id],
      limitPerDay: DAILY_LIMIT[provider.id],
    });
    if (!quota.allowed) {
      return {
        fundamentals: existing ?? null,
        note: `${provider.label} quota reached — showing the last stored snapshot if available.`,
      };
    }
    try {
      const fundamentals = await provider.fetchFundamentals(env, instrument);
      await ctx.runMutation(internal.marketStore.upsertFundamentals, {
        records: [
          {
            instrumentId: instrument.instrumentId,
            symbol: fundamentals.symbol,
            source: fundamentals.source,
            mode: fundamentals.mode,
            fetchedAt: fundamentals.fetchedAt,
            asOf: fundamentals.asOf,
            peTtm: fundamentals.peTtm,
            marketCapCrore: fundamentals.marketCapCrore,
            high52w: fundamentals.high52w,
            low52w: fundamentals.low52w,
            sections: fundamentals.sections,
          },
        ],
      });
      await ctx.runMutation(internal.marketStore.recordProviderResult, {
        providerId: provider.id,
        ok: true,
      });
      return {
        fundamentals: { ...fundamentals, instrumentId: instrument.instrumentId },
        note: null as string | null,
      };
    } catch (error) {
      const message = redactError(error);
      await ctx.runMutation(internal.marketStore.recordProviderResult, {
        providerId: provider.id,
        ok: false,
        error: message,
      });
      return { fundamentals: existing ?? null, note: `${provider.label}: ${message}` };
    }
  },
});

/* ------------------------------------------------------------------ */
/* Provider status                                                     */
/* ------------------------------------------------------------------ */

export const providerOverview = action({
  args: {},
  handler: async (ctx): Promise<ProviderOverview> => {
    const now = Date.now();
    const env = readEnv();
    const statuses = providerStatuses(env);
    const states = await ctx.runQuery(internal.marketStore.providerStates, {});
    const stateById = new Map(states.map((state) => [state.providerId, state]));
    const holidays = await ctx.runQuery(internal.marketStore.holidays, {
      fromDate: istDateString(now - 3 * 24 * 60 * 60 * 1000),
    });
    const catalogue = await ctx.runQuery(internal.marketStore.catalogueCounts, {});
    const coverage = await ctx.runQuery(internal.marketStore.dataCoverage, {});
    const intervals = availableIntervals(env);
    const features = featureDataModes(
      {
        providerQuotes: coverage.providerQuotes,
        eodQuotes: coverage.eodQuotes,
        cachedCandleSeries: coverage.cachedCandleSeries,
        importedCandleSeries: coverage.importedCandleSeries,
        latestQuoteSessionDate: coverage.latestQuoteSessionDate,
        latestCandleDate: coverage.latestCandleDate,
        candleSources: coverage.candleSources,
      },
      intervals
    );

    return {
      now,
      session: marketSession(now, holidays),
      holidaysConfigured: holidays.length > 0,
      availableIntervals: intervals,
      providers: statuses.map((status) => {
        const state = stateById.get(status.providerId);
        return {
          ...status,
          lastAttemptAt: state?.lastAttemptAt ?? null,
          lastSuccessAt: state?.lastSuccessAt ?? null,
          lastError: state?.lastError ?? null,
          lastErrorAt: state?.lastErrorAt ?? null,
          lastLatencyMs: state?.lastLatencyMs ?? null,
          instrumentsSyncedAt: state?.instrumentsSyncedAt ?? null,
          instrumentCount: state?.instrumentCount ?? null,
          lastDataDate: state?.lastDataDate ?? null,
          rateWindowCount: state?.rateWindowCount ?? 0,
          rateLimitPerMinute: RATE_LIMIT[status.providerId],
          dailyCount: state?.dailyCount ?? 0,
          dailyLimit: DAILY_LIMIT[status.providerId] ?? null,
        };
      }),
      catalogue,
      coverage,
      features,
      hasConfiguredProvider: statuses.some((status) => status.configured),
      providerCount: ALL_PROVIDERS.length,
    };
  },
});

export const testProvider = action({
  args: { providerId: v.string() },
  handler: async (ctx, args): Promise<TestProviderResult> => {
    const userId = await ctx.runQuery(internal.marketStore.currentUserId, {});
    if (!userId) throw new Error("Not authenticated");
    const provider = getProvider(args.providerId);
    if (!provider) throw new Error("Unknown provider");
    const env = readEnv();
    const { configured, missing } = provider.isConfigured(env);
    if (!configured) {
      return {
        providerId: provider.id,
        ok: false,
        message: `Not configured — set ${missing.join(", ")} in the Convex deployment.`,
        latencyMs: 0,
      };
    }
    const quota = await ctx.runMutation(internal.marketStore.consumeProviderQuota, {
      providerId: provider.id,
      limitPerMinute: RATE_LIMIT[provider.id],
      limitPerDay: DAILY_LIMIT[provider.id],
    });
    if (!quota.allowed) {
      return {
        providerId: provider.id,
        ok: false,
        message: `Rate limit reached — retry in ${Math.ceil(quota.retryAfterMs / 1000)}s.`,
        latencyMs: 0,
      };
    }
    const result = await provider.testConnection(env);
    await ctx.runMutation(internal.marketStore.recordProviderResult, {
      providerId: provider.id,
      ok: result.ok,
      latencyMs: result.latencyMs,
      error: result.ok ? undefined : redactError(result.message),
    });
    return { providerId: provider.id, ...result };
  },
});

/* ------------------------------------------------------------------ */
/* Instrument synchronisation                                          */
/* ------------------------------------------------------------------ */

export const syncInstruments = action({
  args: { exchanges: v.optional(v.array(exchangeArg)) },
  handler: async (
    ctx,
    args
  ): Promise<{
    providerId: string;
    total: number;
    inserted: number;
    updated: number;
    exchanges: Array<"NSE" | "BSE">;
  }> => {
    const userId = await ctx.runQuery(internal.marketStore.currentUserId, {});
    if (!userId) throw new Error("Not authenticated");
    const env = readEnv();
    const provider = providerFor(env, "instrumentSync");
    if (!provider?.fetchInstrumentMaster) {
      throw new Error(
        "No provider is configured for instrument synchronisation. Set FYERS_APP_ID, FYERS_SECRET_ID and FYERS_ACCESS_TOKEN, or import a CSV."
      );
    }
    const quota = await ctx.runMutation(internal.marketStore.consumeProviderQuota, {
      providerId: provider.id,
      limitPerMinute: RATE_LIMIT[provider.id],
      limitPerDay: DAILY_LIMIT[provider.id],
    });
    if (!quota.allowed) {
      throw new Error(`Rate limit reached — retry in ${Math.ceil(quota.retryAfterMs / 1000)}s.`);
    }

    const exchanges = args.exchanges ?? ["NSE", "BSE"];
    const startedAt = Date.now();
    try {
      const master = await provider.fetchInstrumentMaster(env, {
        exchanges,
        // Per-exchange cap (NSE has ~2,950 rows, BSE ~2,680).
        limit: 3000,
      });
      if (master.length === 0) {
        throw new Error("Provider returned an empty instrument master — existing data was left untouched.");
      }

      let inserted = 0;
      let updated = 0;
      for (let i = 0; i < master.length; i += 200) {
        const chunk = master.slice(i, i + 200);
        const result = await ctx.runMutation(internal.marketStore.upsertInstrumentMaster, {
          instruments: chunk.map((instrument) => ({
            instrumentId: instrument.instrumentId,
            symbol: instrument.symbol,
            tradingSymbol: instrument.tradingSymbol,
            name: instrument.name,
            exchange: instrument.exchange,
            instrumentType: instrument.instrumentType,
            segment: instrument.segment,
            providerIds: instrument.providerIds,
            isin: instrument.isin,
            tickSize: instrument.tickSize,
            lotSize: instrument.lotSize,
            isActive: instrument.isActive,
            source: instrument.source,
          })),
        });
        inserted += result.inserted;
        updated += result.updated;
      }
      await ctx.runMutation(internal.marketStore.recordInstrumentSync, {
        providerId: provider.id,
        count: master.length,
      });
      await ctx.runMutation(internal.marketStore.recordProviderResult, {
        providerId: provider.id,
        ok: true,
        latencyMs: Date.now() - startedAt,
      });
      return {
        providerId: provider.id,
        total: master.length,
        inserted,
        updated,
        exchanges,
      };
    } catch (error) {
      const message = redactError(error);
      await ctx.runMutation(internal.marketStore.recordProviderResult, {
        providerId: provider.id,
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: message,
      });
      throw new Error(message);
    }
  },
});

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export const importCsv = action({
  args: {
    instrumentId: v.string(),
    interval: intervalArg,
    fileName: v.string(),
    csvText: v.string(),
  },
  handler: async (ctx, args): Promise<CsvImportResult> => {
    const userId = (await ctx.runQuery(internal.marketStore.currentUserId, {})) as
      | Id<"users">
      | null;
    if (!userId) throw new Error("Not authenticated");
    if (args.csvText.length > MAX_CSV_BYTES) {
      throw new Error("CSV is larger than the 5 MB limit");
    }
    const rows = await ctx.runQuery(internal.marketStore.instrumentsByIds, {
      ids: [args.instrumentId],
    });
    if (rows.length === 0) throw new Error("Instrument not found");
    const instrument = rows[0];

    const parsed = parseOhlcvCsv(args.csvText, {
      instrumentId: args.instrumentId,
      interval: args.interval as Interval,
      source: "csv_import",
      mode: "HISTORICAL",
    });

    const capped = parsed.candles.slice(0, MAX_CANDLES);
    await ctx.runMutation(internal.marketStore.createImport, {
      userId,
      instrumentId: args.instrumentId,
      instrumentLabel: `${instrument.symbol} · ${instrument.exchange}`,
      interval: args.interval as Interval,
      fileName: args.fileName.slice(0, 120),
      candles: capped.map((candle) => ({
        ts: candle.ts,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      })),
      totalRows: parsed.summary.totalRows,
      rejectedRows: parsed.summary.rejectedRows,
      duplicatedRows: parsed.summary.duplicatesRemoved,
      rejectionSample: parsed.rejected.slice(0, 20),
      error:
        capped.length === 0
          ? parsed.rejected[0]?.reason ?? "No valid OHLCV rows were found in the file."
          : null,
    });

    return {
      accepted: capped.length,
      rejected: parsed.rejected.slice(0, 20),
      summary: parsed.summary,
    };
  },
});

export const listImports = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("dataImports")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const deleteImport = mutation({
  args: { importId: v.id("dataImports") },
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runMutation(internal.marketStore.deleteImport, {
      userId,
      importId: args.importId,
    });
    return { deleted: true };
  },
});

/** Instrument master rows for the current catalogue, newest first (admin view). */
export const recentInstruments = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(1, args.limit ?? 10), 50);
    const rows = await ctx.db.query("instruments").withIndex("by_symbol").take(limit);
    return rows;
  },
});
