import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  DEFAULT_STARTING_CAPITAL,
  MAX_STARTING_CAPITAL,
  MIN_STARTING_CAPITAL,
  PAPER_CURRENCY,
  roundMoney,
} from "./paperCore/config";

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
      currency: PAPER_CURRENCY,
      status: "active",
      createdAt: now,
      updatedAt: now,
      realizedPnl: 0,
      startingCapitalLocked: false,
      lastOrderAt: null,
    });
  },
});

/**
 * Updates paper account settings for the signed-in user.
 *
 * Cash balance is intentionally not client-writable — only the validated order
 * engine in `convex/paper.ts` moves money. Starting capital becomes immutable
 * once the first simulated order exists, otherwise past performance could be
 * rewritten after the fact.
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
      if (
        !Number.isFinite(args.startingCapital) ||
        args.startingCapital < MIN_STARTING_CAPITAL ||
        args.startingCapital > MAX_STARTING_CAPITAL
      ) {
        throw new Error(
          `Starting capital must be between ₹${MIN_STARTING_CAPITAL.toLocaleString("en-IN")} and ₹${MAX_STARTING_CAPITAL.toLocaleString("en-IN")}.`
        );
      }
      const anyOrder = await ctx.db
        .query("paperOrders")
        .withIndex("by_account_created", (q) => q.eq("accountId", account._id))
        .first();
      if (anyOrder || (account.startingCapitalLocked ?? false)) {
        throw new Error(
          "Starting capital is locked after the first order. It can only be changed before trading starts."
        );
      }
      const capital = roundMoney(args.startingCapital);
      updates.startingCapital = capital;
      // Nothing has traded yet, so cash equals the baseline.
      updates.availableCash = capital;
    }
    if (args.status !== undefined) updates.status = args.status;
    if (args.currency !== undefined) {
      if (args.currency !== PAPER_CURRENCY) {
        throw new Error(`Paper accounts are INR only — ${PAPER_CURRENCY} is the supported currency.`);
      }
      updates.currency = PAPER_CURRENCY;
    }
    await ctx.db.patch(account._id, updates);
    return account._id;
  },
});
