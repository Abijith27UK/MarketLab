import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Per-user chart preferences (timeframe, chart type, indicator toggles).
 * Owner is always the authenticated user — the instrument id is the only
 * client-supplied key, and it identifies public market data, not user data.
 */

const intervalArg = v.union(
  v.literal("1m"),
  v.literal("5m"),
  v.literal("15m"),
  v.literal("1h"),
  v.literal("1d"),
  v.literal("1w"),
  v.literal("1M")
);

const indicatorValidator = v.object({
  name: v.union(
    v.literal("SMA"),
    v.literal("EMA"),
    v.literal("RSI"),
    v.literal("MACD"),
    v.literal("BOLLINGER"),
    v.literal("VWAP")
  ),
  enabled: v.boolean(),
  period: v.optional(v.number()),
  fast: v.optional(v.number()),
  slow: v.optional(v.number()),
  signal: v.optional(v.number()),
  multiplier: v.optional(v.number()),
});

export const get = query({
  args: { instrumentId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("chartPreferences")
      .withIndex("by_user_instrument", (q) =>
        q.eq("userId", userId).eq("instrumentId", args.instrumentId)
      )
      .unique();
  },
});

export const save = mutation({
  args: {
    instrumentId: v.string(),
    interval: intervalArg,
    chartType: v.union(v.literal("candlestick"), v.literal("line"), v.literal("bar")),
    indicators: v.array(indicatorValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    if (args.indicators.length > 10) throw new Error("Too many indicators");

    const now = Date.now();
    const existing = await ctx.db
      .query("chartPreferences")
      .withIndex("by_user_instrument", (q) =>
        q.eq("userId", userId).eq("instrumentId", args.instrumentId)
      )
      .unique();

    const record = {
      userId,
      instrumentId: args.instrumentId,
      interval: args.interval,
      chartType: args.chartType,
      indicators: args.indicators,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, record);
      return existing._id;
    }
    return await ctx.db.insert("chartPreferences", record);
  },
});
