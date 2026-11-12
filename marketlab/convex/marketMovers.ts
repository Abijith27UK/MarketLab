/**
 * Market Movers — official NSE MCP rankings, fixed source.
 *
 * This is the ONLY service allowed to produce the dashboard's gainers/losers.
 * It deliberately does not read the user's quote-source preference: Market
 * Movers stays on the official NSE MCP ranking whether the rest of the app is
 * showing TejHQ or NSE MCP data.
 *
 * Verified live on 2026-11-12 against https://mcp.nseindia.in/cmmkt/mcp:
 *   nse_get_market_movers { indexName: "", limit: 20 }
 *   → { segment: "allSec", gainersUpdatedAt, losersUpdatedAt, gainers[], losers[] }
 *
 * No local quote sample, no TejHQ ranking, no fabricated row. When the official
 * service is unavailable the widget says so (optionally showing the last ranking
 * with an explicit CACHED label) rather than substituting ten random quotes.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { MarketMoverRow, MarketMoversResult } from "../src/lib/marketClient";
import { fetchMarketMovers } from "./market/providers/nsemcp";
import { makeInstrumentId } from "./market/types";
import { istDateString, marketSession } from "./market/time";
import { redactError } from "./market/normalize";

/** Fixed provider. Never replaced by the global quote-source selector. */
export const MARKET_MOVERS_SOURCE = "nsemcp" as const;
/** Ranked universe requested from NSE: all securities, then EQ-series only. */
export const MARKET_MOVERS_UNIVERSE = "allSec";
/** Rows requested per direction; the widget shows at most MARKET_MOVERS_ROWS. */
const FETCH_LIMIT = 20;
export const MARKET_MOVERS_ROWS = 10;
const CACHE_TTL_OPEN_MS = 60_000;
const CACHE_TTL_CLOSED_MS = 15 * 60_000;
/** Fixed cache key — provider, tool, universe and limit, nothing user-specific. */
export const MARKET_MOVERS_CACHE_KEY = `nsemcp:market-movers:${MARKET_MOVERS_UNIVERSE}:eq:${FETCH_LIMIT}:v1`;

interface CachedRanking {
  gainers: MarketMoverRow[];
  losers: MarketMoverRow[];
  segment: string;
  universeLabel: string;
  tool: string;
  sessionDate: string | null;
  quoteTimestamp: number | null;
  sessionMismatch: boolean;
}

function unavailable(reason: string, retrievedAt: number): MarketMoversResult {
  return {
    available: false,
    source: MARKET_MOVERS_SOURCE,
    sourceLabel: "NSE MCP",
    tool: null,
    universe: "All NSE equities (EQ series)",
    segment: MARKET_MOVERS_UNIVERSE,
    gainers: [],
    losers: [],
    mode: "DELAYED",
    quoteTimestamp: null,
    sessionDate: null,
    retrievedAt,
    cacheExpiresAt: null,
    fromCache: false,
    stale: false,
    warning: null,
    reason,
  };
}

export const getMarketMovers = action({
  args: { refresh: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<MarketMoversResult> => {
    const now = Date.now();
    const env = (typeof process !== "undefined" ? process.env : {}) as Record<
      string,
      string | undefined
    >;

    const cached = await ctx.runQuery(internal.moversStore.cachedMovers, {
      key: MARKET_MOVERS_CACHE_KEY,
    });
    const useCache = cached !== null && cached.expiresAt > now && !args.refresh;

    if (useCache && cached) {
      const ranking = JSON.parse(cached.payload) as CachedRanking;
      return {
        available: true,
        source: MARKET_MOVERS_SOURCE,
        sourceLabel: "NSE MCP",
        tool: cached.tool,
        universe: ranking.universeLabel,
        segment: cached.segment,
        gainers: ranking.gainers,
        losers: ranking.losers,
        mode: "DELAYED",
        quoteTimestamp: cached.quoteTimestamp,
        sessionDate: cached.sessionDate,
        retrievedAt: cached.fetchedAt,
        cacheExpiresAt: cached.expiresAt,
        fromCache: true,
        stale: false,
        warning: null,
        reason: null,
      };
    }

    const holidays = await ctx.runQuery(internal.marketStore.holidays, {
      fromDate: istDateString(now - 3 * 24 * 60 * 60 * 1000),
    });
    const session = marketSession(now, holidays);

    const quota = await ctx.runMutation(internal.marketStore.consumeProviderQuota, {
      providerId: "nsemcp",
      limitPerMinute: 12,
      limitPerDay: undefined,
    });
    if (!quota.allowed) {
      const reason = `NSE market-mover request limit reached — retry in ${Math.ceil(
        quota.retryAfterMs / 1000
      )}s.`;
      if (cached) {
        const ranking = JSON.parse(cached.payload) as CachedRanking;
        return {
          available: true,
          source: MARKET_MOVERS_SOURCE,
          sourceLabel: "NSE MCP",
          tool: cached.tool,
          universe: ranking.universeLabel,
          segment: cached.segment,
          gainers: ranking.gainers,
          losers: ranking.losers,
          mode: "CACHED",
          quoteTimestamp: cached.quoteTimestamp,
          sessionDate: cached.sessionDate,
          retrievedAt: cached.fetchedAt,
          cacheExpiresAt: cached.expiresAt,
          fromCache: true,
          stale: true,
          warning: reason,
          reason: null,
        };
      }
      return unavailable(reason, now);
    }

    try {
      const ranking = await fetchMarketMovers(env, { limit: FETCH_LIMIT });
      const symbols = [
        ...new Set([...ranking.gainers, ...ranking.losers].map((row) => row.symbol)),
      ];
      const catalogue = await ctx.runQuery(internal.marketStore.instrumentsBySymbols, {
        symbols,
      });
      const bySymbol = new Map(catalogue.map((row) => [row.symbol.toUpperCase(), row]));

      const toRow = (mover: {
        symbol: string;
        series: string;
        lastPrice: number;
        previousClose: number | null;
        change: number | null;
        changePercent: number;
        quoteTime: number | null;
      }): MarketMoverRow => {
        const instrumentId = makeInstrumentId("NSE", mover.symbol, "EQUITY");
        const row = bySymbol.get(mover.symbol);
        return {
          symbol: mover.symbol,
          name: row?.name ?? null,
          instrumentId: row?.instrumentId ?? instrumentId,
          inCatalogue: Boolean(row),
          series: mover.series,
          lastPrice: mover.lastPrice,
          previousClose: mover.previousClose,
          change: mover.change,
          changePercent: mover.changePercent,
          quoteTime: mover.quoteTime,
        };
      };

      const gainers = ranking.gainers.slice(0, MARKET_MOVERS_ROWS).map(toRow);
      const losers = ranking.losers.slice(0, MARKET_MOVERS_ROWS).map(toRow);
      const quoteTimestamp = Math.max(
        ranking.gainersUpdatedAt ?? 0,
        ranking.losersUpdatedAt ?? 0
      ) || null;
      const cacheExpiresAt =
        now + (session.status === "OPEN" ? CACHE_TTL_OPEN_MS : CACHE_TTL_CLOSED_MS);

      const payload: CachedRanking = {
        gainers,
        losers,
        segment: ranking.segment,
        universeLabel: ranking.universeLabel,
        tool: ranking.tool,
        sessionDate: ranking.sessionDate,
        quoteTimestamp,
        sessionMismatch: ranking.sessionMismatch,
      };

      await ctx.runMutation(internal.moversStore.saveMovers, {
        key: MARKET_MOVERS_CACHE_KEY,
        source: MARKET_MOVERS_SOURCE,
        universe: ranking.universeLabel,
        segment: ranking.segment,
        tool: ranking.tool,
        sessionDate: ranking.sessionDate,
        quoteTimestamp,
        payload: JSON.stringify(payload),
        fetchedAt: now,
        expiresAt: cacheExpiresAt,
      });

      if (ranking.sessionMismatch) {
        return {
          ...unavailable(
            "NSE returned Gainers and Losers from different trading sessions, so they cannot be shown together.",
            now
          ),
          warning:
            "Gainers and Losers were crawled on different IST dates. Refresh once NSE has published a consistent ranking.",
        };
      }
      if (gainers.length === 0 && losers.length === 0) {
        return unavailable("NSE returned no eligible EQ-series rows for this session.", now);
      }

      return {
        available: true,
        source: MARKET_MOVERS_SOURCE,
        sourceLabel: "NSE MCP",
        tool: ranking.tool,
        universe: ranking.universeLabel,
        segment: ranking.segment,
        gainers,
        losers,
        mode: "DELAYED",
        quoteTimestamp,
        sessionDate: ranking.sessionDate,
        retrievedAt: now,
        cacheExpiresAt,
        fromCache: false,
        stale: false,
        warning: null,
        reason: null,
      };
    } catch (error) {
      const message = redactError(error);
      if (cached) {
        const ranking = JSON.parse(cached.payload) as CachedRanking;
        return {
          available: true,
          source: MARKET_MOVERS_SOURCE,
          sourceLabel: "NSE MCP",
          tool: cached.tool,
          universe: ranking.universeLabel,
          segment: cached.segment,
          gainers: ranking.gainers,
          losers: ranking.losers,
          mode: "CACHED",
          quoteTimestamp: cached.quoteTimestamp,
          sessionDate: cached.sessionDate,
          retrievedAt: cached.fetchedAt,
          cacheExpiresAt: cached.expiresAt,
          fromCache: true,
          stale: true,
          warning: `NSE market movers could not be refreshed (${message}). Showing the last ranking retrieved at ${new Date(
            cached.fetchedAt
          ).toISOString()}.`,
          reason: null,
        };
      }
      return unavailable(`Unable to retrieve NSE market movers: ${message}`, now);
    }
  },
});
