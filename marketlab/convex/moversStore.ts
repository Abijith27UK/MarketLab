import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Cache for the fixed-source NSE market-mover ranking.
 *
 * One row per key. The key is built from the provider that is allowed to serve
 * movers (`nsemcp`), the tool, the ranking universe and the requested limit —
 * never from the user's quote-source preference, so switching TejHQ ↔ NSE MCP
 * cannot return a different ranking.
 */

export const cachedMovers = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("marketMoversCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
  },
});

export const saveMovers = internalMutation({
  args: {
    key: v.string(),
    source: v.string(),
    universe: v.string(),
    segment: v.string(),
    tool: v.string(),
    sessionDate: v.union(v.string(), v.null()),
    quoteTimestamp: v.union(v.number(), v.null()),
    payload: v.string(),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("marketMoversCache")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }
    return await ctx.db.insert("marketMoversCache", args);
  },
});
