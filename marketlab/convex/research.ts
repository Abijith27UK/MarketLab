/**
 * Company research for the instrument page.
 *
 * Three responsibilities are kept separate on purpose:
 *  - quotes come from the user's selected market provider (TejHQ / NSE MCP);
 *  - company facts come from Tapetide when `TAPETIDE_API_TOKEN` is configured;
 *  - news comes from Tapetide, or from GNews when the owner configured it.
 *
 * Research never writes to the quote cache and never changes the selected quote
 * source. When no research token exists, the action returns `configured: false`
 * with a reason and still reports price-history statistics computed from stored
 * candles — nothing is fabricated to fill the gap.
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { tapetideRequest } from "./market/providers/tapetide";
import { TAPETIDE_DAILY_LIMIT, TAPETIDE_RATE_LIMIT_PER_MINUTE } from "./market/providers/tapetide";
import { fetchGNewsArticles, GNEWS_FREE_TIER_DELAY_NOTICE, gnewsConfigured } from "./market/research/gnews";
import { tapetideMcp } from "./market/research/tapetideMcp";
import {
  normalizeTapetideActions,
  normalizeTapetideFinancials,
  normalizeTapetideNews,
  normalizeTapetideProfile,
  normalizeTapetideShareholding,
} from "./market/research/tapetideNormalize";
import {
  normalizeNews,
  priceStatistics,
  type PriceStatistics,
  type ResearchProvenance,
} from "./market/research/normalize";
import { redactError } from "./market/normalize";
import type { ResearchResult, ResearchSection } from "../src/lib/researchClient";

const HOUR = 60 * 60 * 1000;

/** Cache lifetimes, kept well inside the provider's own update cadence. */
const TTL: Record<ResearchSection, number> = {
  profile: 18 * HOUR,
  financials: 18 * HOUR,
  shareholding: 24 * HOUR,
  news: 20 * 60 * 1000,
  events: 6 * HOUR,
};

/**
 * Admin-only GNews smoke test (one request, no key returned).
 *
 *   npx convex run research:probeGNews
 *
 * Kept internal so a page load can never spend the owner's news quota.
 */
export const probeGNews = internalAction({
  args: { company: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const env = readEnv();
    if (!gnewsConfigured(env)) return { configured: false as const };
    const name = args.company ?? "ITC Limited";
    try {
      const { articles, delayed } = await fetchGNewsArticles(env, { name, symbol: "ITC" }, 5);
      const feed = normalizeNews(
        { articles },
        { symbol: "ITC", name },
        { source: "gnews", asOf: null, fetchedAt: Date.now(), reportDate: null }
      );
      return {
        configured: true as const,
        delayed,
        rawCount: articles.length,
        keptCount: feed.items.length,
        filteredIrrelevant: feed.filteredIrrelevant,
        samples: feed.items.slice(0, 2).map((item) => ({
          headline: item.headline,
          publisher: item.publisher,
          publishedAt: item.publishedAt,
          hasUrl: Boolean(item.url),
        })),
      };
    } catch (error) {
      return { configured: true as const, error: redactError(error) };
    }
  },
});

/**
 * Admin-only Tapetide smoke test: quota status plus the top-level shape of a
 * profile and quote response. No token or full payload is returned.
 *
 *   npx convex run research:probeTapetide
 */
export const probeTapetide = internalAction({
  args: { symbol: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const env = readEnv();
    const symbol = args.symbol ?? "ITC";
    if (!(env.TAPETIDE_API_TOKEN ?? "").trim()) return { configured: false as const };
    const describe = (value: unknown) => {
      if (value === null) return { kind: "null" as const };
      if (Array.isArray(value)) return { kind: "array" as const, length: value.length };
      if (typeof value === "object") return { kind: "object" as const, keys: Object.keys(value).slice(0, 24) };
      return { kind: typeof value, value: String(value).slice(0, 40) };
    };
    const out: Record<string, unknown> = { configured: true as const, symbol };
    try {
      const usage = await tapetideRequest<Record<string, unknown>>(env, "/me/usage");
      out.usage = describe(usage.data);
    } catch (error) {
      out.usageError = redactError(error);
    }
    for (const [label, path] of [
      ["profile", `/stocks/${encodeURIComponent(symbol)}`],
      ["quote", `/stocks/${encodeURIComponent(symbol)}/quote`],
    ] as const) {
      try {
        const { data, meta } = await tapetideRequest<Record<string, unknown>>(env, path);
        out[label] = { data: describe(data), meta: describe(meta) };
      } catch (error) {
        out[`${label}Error`] = redactError(error);
      }
    }
    return out;
  },
});

function readEnv(): Record<string, string | undefined> {
  return (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;
}

const EMPTY_STATS: PriceStatistics = {
  high52w: null,
  low52w: null,
  coverageDays: null,
  fullYear: false,
  averageVolume: null,
  averageVolumeWindows: null,
};

const NOT_CONFIGURED_REASON =
  "Company research is not configured on this deployment. An optional Tapetide research token (TAPETIDE_API_TOKEN) enables the company profile, financial statements, shareholding and company news. Prices, charts and technical indicators do not need it.";

export const getResearch = action({
  args: {
    instrumentId: v.string(),
    sections: v.optional(v.array(v.string())),
    refresh: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ResearchResult> => {
    const now = Date.now();
    const rows = await ctx.runQuery(internal.marketStore.instrumentsByIds, {
      ids: [args.instrumentId],
    } satisfies { ids: string[] });
    if (rows.length === 0) throw new Error("Instrument not found");
    const row = rows[0];

    const requested = new Set<ResearchSection>(
      (args.sections as ResearchSection[] | undefined) ?? ["profile", "financials"]
    );
    const env = readEnv();
    const configured = Boolean((env.TAPETIDE_API_TOKEN ?? "").trim());

    const result: ResearchResult = {
      configured,
      reason: null,
      instrumentId: args.instrumentId,
      symbol: row.symbol,
      profile: null,
      financials: null,
      shareholding: [],
      news: null,
      events: [],
      priceStats: EMPTY_STATS,
      ratios: null,
      errors: {},
      newsProvider: null,
      gnewsDelayed: false,
      fetchedAt: now,
    };

    /* Price history statistics: stored candles only, never a provider call. */
    const userId = await ctx.runQuery(internal.marketStore.currentUserId, {} satisfies {});
    if (userId) {
      const dataset = await ctx.runQuery(internal.marketStore.latestDataset, {
        instrumentId: args.instrumentId,
        interval: "1d",
        ownerId: userId,
        fromMs: now - 400 * 24 * HOUR,
        toMs: now,
        limit: 420,
      });
      if (dataset && dataset.candles.length > 0) {
        result.priceStats = priceStatistics(
          dataset.candles.map((candle) => ({
            ts: candle.ts,
            high: candle.high,
            low: candle.low,
            volume: candle.volume,
          })),
          now
        );
      }
    }

    if (row.instrumentType !== "EQUITY") {
      result.reason =
        "Company research (profile, statements, shareholding) applies to equities. Indices and ETFs have no company financials.";
      return result;
    }

    if (!configured) {
      result.reason = NOT_CONFIGURED_REASON;
      if (requested.has("news") && gnewsConfigured(env)) {
        result.errors.news =
          "News needs a company identifier from the research provider; configure TAPETIDE_API_TOKEN.";
      }
      return result;
    }

    const symbol = row.providerIds?.tapetide ?? row.symbol;
    const instrumentId = args.instrumentId;

    /** Reads one cached payload; returns it only while its TTL has not lapsed. */
    const readCache = async (kind: string) => {
      if (args.refresh) return null;
      const cached = await ctx.runQuery(internal.researchStore.cachedResearch, {
        instrumentId,
        kind,
      });
      if (!cached || cached.expiresAt <= now) return null;
      return cached;
    };

    const saveCache = async (
      kind: string,
      source: string,
      payload: unknown,
      provenance: ResearchProvenance,
      ttlMs: number
    ) => {
      await ctx.runMutation(internal.researchStore.putResearchCache, {
        instrumentId,
        kind,
        source,
        payload: JSON.stringify(payload ?? null),
        asOf: provenance.asOf,
        reportDate: provenance.reportDate,
        ttlMs,
      });
    };

    const quotaAvailable = async (label: string): Promise<boolean> => {
      const quota = await ctx.runMutation(internal.marketStore.consumeProviderQuota, {
        providerId: "tapetide",
        limitPerMinute: TAPETIDE_RATE_LIMIT_PER_MINUTE,
        limitPerDay: TAPETIDE_DAILY_LIMIT,
      });
      if (!quota.allowed) {
        result.errors[
          label as ResearchSection
        ] = `Tapetide quota reached (${TAPETIDE_DAILY_LIMIT} successful requests per IST day). Cached research is shown where available. Retry in ${Math.ceil(
          quota.retryAfterMs / 1000
        )}s.`;
        return false;
      }
      return true;
    };

    const baseProvenance = (asOf: string | null = null): ResearchProvenance => ({
      source: "tapetide",
      asOf,
      fetchedAt: now,
      reportDate: null,
    });

    /* ---------------------------------------------------------- profile */
    if (requested.has("profile")) {
      const cached = await readCache("profile");
      if (cached) {
        const parsed = JSON.parse(cached.payload) as { data: unknown };
        const normalized = normalizeTapetideProfile(parsed.data, {
          source: "tapetide",
          asOf: cached.asOf,
          fetchedAt: cached.fetchedAt,
          reportDate: cached.reportDate,
        });
        result.profile = normalized?.profile ?? null;
        result.ratios = normalized?.ratios ?? null;
      } else if (await quotaAvailable("profile")) {
        try {
          const payload = await tapetideMcp.profile(env, symbol);
          const normalized = normalizeTapetideProfile(payload, baseProvenance());
          if (!normalized) {
            throw new Error("Tapetide returned no company profile for this symbol.");
          }
          result.profile = normalized.profile;
          result.ratios = normalized.ratios;
          await saveCache(
            "profile",
            "tapetide",
            { data: payload },
            normalized.profile.provenance,
            TTL.profile
          );
        } catch (error) {
          result.errors.profile = redactError(error);
        }
      }
    }

    /* ------------------------------------------------------- financials */
    if (requested.has("financials")) {
      const cached = await readCache("financials");
      if (cached) {
        const parsed = JSON.parse(cached.payload) as { data: unknown };
        result.financials = normalizeTapetideFinancials(parsed.data, {
          source: "tapetide",
          asOf: cached.asOf,
          fetchedAt: cached.fetchedAt,
          reportDate: cached.reportDate,
        });
      } else if (await quotaAvailable("financials")) {
        try {
          const payload = await tapetideMcp.financials(env, symbol);
          result.financials = normalizeTapetideFinancials(payload, baseProvenance());
          if (!result.financials) {
            result.errors.financials =
              "The provider returned no usable statement periods for this company.";
          }
          await saveCache(
            "financials",
            "tapetide",
            { data: payload },
            baseProvenance(),
            TTL.financials
          );
        } catch (error) {
          result.errors.financials = redactError(error);
        }
      }
    }

    /* ----------------------------------------------------- shareholding */
    if (requested.has("shareholding")) {
      const cached = await readCache("shareholding");
      if (cached) {
        const parsed = JSON.parse(cached.payload) as { data: unknown };
        result.shareholding = normalizeTapetideShareholding(parsed.data, {
          source: "tapetide",
          asOf: cached.asOf,
          fetchedAt: cached.fetchedAt,
          reportDate: cached.reportDate,
        });
      } else if (await quotaAvailable("shareholding")) {
        try {
          const payload = await tapetideMcp.shareholding(env, symbol);
          result.shareholding = normalizeTapetideShareholding(payload, baseProvenance());
          if (result.shareholding.length === 0) {
            result.errors.shareholding =
              "The provider returned no shareholding periods for this company.";
          }
          await saveCache(
            "shareholding",
            "tapetide",
            { data: payload },
            baseProvenance(),
            TTL.shareholding
          );
        } catch (error) {
          result.errors.shareholding = redactError(error);
        }
      }
    }

    /* ------------------------------------------------------------- news */
    if (requested.has("news")) {
      const cached = await readCache("news");
      const match = { symbol, name: result.profile?.name ?? row.name ?? null };
      if (cached) {
        const parsed = JSON.parse(cached.payload) as { data: unknown };
        result.news =
          cached.source === "gnews"
            ? normalizeNews(parsed.data, match, {
                source: "gnews",
                asOf: cached.asOf,
                fetchedAt: cached.fetchedAt,
                reportDate: cached.reportDate,
              })
            : normalizeTapetideNews(parsed.data, {
                source: "tapetide",
                asOf: cached.asOf,
                fetchedAt: cached.fetchedAt,
                reportDate: cached.reportDate,
              });
        result.newsProvider = cached.source === "gnews" ? "gnews" : "tapetide";
      } else if (await quotaAvailable("news")) {
        let tapetideError: string | null = null;
        if (configured) {
          try {
            const payload = await tapetideMcp.news(env, symbol);
            result.news = normalizeTapetideNews(payload, baseProvenance());
            result.newsProvider = "tapetide";
            await saveCache("news", "tapetide", { data: payload }, baseProvenance(), TTL.news);
          } catch (error) {
            tapetideError = redactError(error);
          }
        }

        if (!result.news && gnewsConfigured(env)) {
          try {
            const { articles, delayed } = await fetchGNewsArticles(env, {
              name: match.name,
              symbol,
            });
            const provenance: ResearchProvenance = {
              source: "gnews",
              asOf: null,
              fetchedAt: now,
              reportDate: null,
            };
            result.news = normalizeNews({ articles }, match, provenance);
            result.newsProvider = "gnews";
            result.gnewsDelayed = delayed;
            if (delayed) result.errors.news = GNEWS_FREE_TIER_DELAY_NOTICE;
            await saveCache("news", "gnews", { data: { articles } }, provenance, TTL.news);
          } catch (error) {
            result.errors.news = redactError(error);
          }
        } else if (!result.news) {
          result.errors.news =
            tapetideError ??
            "No news provider is configured. Company news needs Tapetide or a GNews API key.";
        }
      }
    }

    /* ----------------------------------------------------- events */
    if (requested.has("events")) {
      const cached = await readCache("events");
      if (cached) {
        const parsed = JSON.parse(cached.payload) as { data: unknown };
        result.events = normalizeTapetideActions(parsed.data, {
          source: "tapetide",
          asOf: cached.asOf,
          fetchedAt: cached.fetchedAt,
          reportDate: cached.reportDate,
        });
      } else if (await quotaAvailable("events")) {
        try {
          const payload = await tapetideMcp.actions(env, symbol);
          result.events = normalizeTapetideActions(payload, baseProvenance());
          if (result.events.length === 0) {
            result.errors.events =
              "The provider returned no corporate actions for this company.";
          }
          await saveCache("events", "tapetide", { data: payload }, baseProvenance(), TTL.events);
        } catch (error) {
          result.errors.events = redactError(error);
        }
      }
    }

    result.fetchedAt = now;
    return result;
  },
});


