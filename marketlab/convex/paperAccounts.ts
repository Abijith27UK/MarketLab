import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const DEFAULT_STARTING_CAPITAL = 100_000;

/**
 * Returns the signed-in user's paper trading account, or null.
 * Owner derived from session identity — never from client input.
 */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db
      .query("paperAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
  },
});

/**
 * Creates the user's simulated paper account if missing (idempotent).
 * No trades or profits are fabricated — only starting capital is recorded.
 */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("paperAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return existing._id;
    const now = Date.now();
    return await ctx.db.insert("paperAccounts", {
      userId,
      startingCapital: DEFAULT_STARTING_CAPITAL,
      availableCash: DEFAULT_STARTING_CAPITAL,
      currency: "INR",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Updates paper account settings for the signed-in user.
 * Cash balance is intentionally not client-writable; it will only be
 * changed by the trading engine in a later phase.
 */
export const updateSettings = mutation({
  args: {
    startingCapital: v.optional(v.number()),
    status: v.optional(v.union(v.literal("active"), v.literal("disabled"))),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const account = await ctx.db
      .query("paperAccounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!account) throw new Error("Paper account not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.startingCapital !== undefined) {
      if (args.startingCapital < 0) throw new Error("Starting capital must be >= 0");
      updates.startingCapital = args.startingCapital;
    }
    if (args.status !== undefined) updates.status = args.status;
    if (args.currency !== undefined) updates.currency = args.currency;
    await ctx.db.patch(account._id, updates);
    return account._id;
  },
});
