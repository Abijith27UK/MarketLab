import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/**
 * Cache for research payloads (profile, financials, shareholding, news, events).
 *
 * Rows hold the raw provider payload as JSON so a normalization change can be
 * re-applied without another provider request. `fetchedAt` is MarketLab's
 * retrieval time; the provider's own `asOf` / report dates travel inside the
 * payload and are never replaced by it.
 */

const nullableString = v.union(v.string(), v.null());

export const cachedResearch = internalQuery({
  args: { instrumentId: v.string(), kind: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("researchCache")
      .withIndex("by_instrument_kind", (q) =>
        q.eq("instrumentId", args.instrumentId).eq("kind", args.kind)
      )
      .first();
  },
});

export const putResearchCache = internalMutation({
  args: {
    instrumentId: v.string(),
    kind: v.string(),
    source: v.string(),
    payload: v.string(),
    asOf: nullableString,
    reportDate: nullableString,
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("researchCache")
      .withIndex("by_instrument_kind", (q) =>
        q.eq("instrumentId", args.instrumentId).eq("kind", args.kind)
      )
      .first();
    const record = {
      instrumentId: args.instrumentId,
      kind: args.kind,
      source: args.source,
      payload: args.payload,
      asOf: args.asOf,
      reportDate: args.reportDate,
      fetchedAt: now,
      expiresAt: now + args.ttlMs,
    };
    if (existing) {
      await ctx.db.patch(existing._id, record);
      return existing._id;
    }
    return await ctx.db.insert("researchCache", record);
  },
});

/** Clears one instrument's cached research (used by an explicit refresh). */
export const clearResearch = internalMutation({
  args: { instrumentId: v.string(), kind: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("researchCache")
      .withIndex("by_instrument_kind", (q) => q.eq("instrumentId", args.instrumentId))
      .collect();
    let removed = 0;
    for (const row of rows) {
      if (args.kind && row.kind !== args.kind) continue;
      await ctx.db.delete(row._id);
      removed += 1;
    }
    return removed;
  },
});
