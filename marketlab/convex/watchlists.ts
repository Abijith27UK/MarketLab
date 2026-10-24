import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

/**
 * Lists the signed-in user's watchlists with their items.
 * Returns an empty array when signed out.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const watchlists = await ctx.db
      .query("watchlists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc")
      .collect();
    return await Promise.all(
      watchlists.map(async (wl) => {
        const items = await ctx.db
          .query("watchlistItems")
          .withIndex("by_watchlist", (q) => q.eq("watchlistId", wl._id))
          .order("asc")
          .collect();
        return { ...wl, items };
      })
    );
  },
});

/** Verifies the watchlist belongs to the authenticated user. */
async function requireOwnedWatchlist(
  ctx: {
    db: {
      get: (id: Id<"watchlists">) => Promise<{
        _id: Id<"watchlists">;
        userId: Id<"users">;
        name: string;
      } | null>;
    };
  },
  userId: Id<"users">,
  watchlistId: Id<"watchlists">
) {
  const wl = await ctx.db.get(watchlistId);
  if (!wl) throw new Error("Watchlist not found");
  if (wl.userId !== userId) throw new Error("Not authorized");
  return wl;
}

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    if (name.length > 80) throw new Error("Name is too long");
    const existing = await ctx.db
      .query("watchlists")
      .withIndex("by_user_name", (q) => q.eq("userId", userId).eq("name", name))
      .unique();
    if (existing) throw new Error("A watchlist with this name already exists");
    const count = (
      await ctx.db
        .query("watchlists")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect()
    ).length;
    const now = Date.now();
    return await ctx.db.insert("watchlists", {
      userId,
      name,
      description: args.description?.trim() ?? "",
      position: count,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const rename = mutation({
  args: { id: v.id("watchlists"), name: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireOwnedWatchlist(ctx, userId, args.id);
    const name = args.name.trim();
    if (!name) throw new Error("Name is required");
    await ctx.db.patch(args.id, { name, updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("watchlists") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireOwnedWatchlist(ctx, userId, args.id);
    const items = await ctx.db
      .query("watchlistItems")
      .withIndex("by_watchlist", (q) => q.eq("watchlistId", args.id))
      .collect();
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(args.id);
  },
});

export const addItem = mutation({
  args: {
    watchlistId: v.id("watchlists"),
    instrumentId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await requireOwnedWatchlist(ctx, userId, args.watchlistId);
    const duplicate = await ctx.db
      .query("watchlistItems")
      .withIndex("by_watchlist_instrument", (q) =>
        q.eq("watchlistId", args.watchlistId).eq("instrumentId", args.instrumentId)
      )
      .unique();
    if (duplicate) throw new Error("Instrument already in this watchlist");
    const count = (
      await ctx.db
        .query("watchlistItems")
        .withIndex("by_watchlist", (q) => q.eq("watchlistId", args.watchlistId))
        .collect()
    ).length;
    return await ctx.db.insert("watchlistItems", {
      watchlistId: args.watchlistId,
      userId,
      instrumentId: args.instrumentId,
      position: count,
      addedAt: Date.now(),
    });
  },
});

export const removeItem = mutation({
  args: { id: v.id("watchlistItems") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const item = await ctx.db.get(args.id);
    if (!item) throw new Error("Item not found");
    if (item.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(args.id);
  },
});
