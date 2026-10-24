import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Convex Auth built-in tables (accounts, sessions, users)
  ...authTables,

  // Per-user profile and preferences. Owner derived from auth, not client input.
  userProfiles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    theme: v.union(v.literal("light"), v.literal("dark"), v.literal("system")),
    currency: v.string(),
    timezone: v.string(),
    defaultTradingMode: v.union(v.literal("paper"), v.literal("live")),
    defaultOrderSettings: v.object({
      productType: v.string(),
      duration: v.string(),
      autoSquareOff: v.boolean(),
    }),
    notificationPreferences: v.object({
      emailNotifications: v.boolean(),
      priceAlerts: v.boolean(),
      weeklyDigest: v.boolean(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Watchlists owned by a user
  watchlists: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.string(),
    position: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"]),

  // Watchlist items: a watchlist contains instrument symbols (denormalized owner for fast auth checks)
  watchlistItems: defineTable({
    watchlistId: v.id("watchlists"),
    userId: v.id("users"),
    instrumentId: v.string(),
    position: v.number(),
    addedAt: v.number(),
  })
    .index("by_watchlist", ["watchlistId"])
    .index("by_user", ["userId"])
    .index("by_watchlist_instrument", ["watchlistId", "instrumentId"]),

  // Demonstration instrument catalogue (NOT live market data)
  instruments: defineTable({
    symbol: v.string(),
    name: v.string(),
    exchange: v.union(v.literal("NSE"), v.literal("BSE")),
    instrumentType: v.union(v.literal("EQUITY"), v.literal("ETF"), v.literal("INDEX")),
    sector: v.string(),
    dataSource: v.string(),
    isSampleData: v.boolean(),
    lastUpdated: v.number(),
  })
    .index("by_symbol", ["symbol"])
    .index("by_exchange", ["exchange"]),

  // Per-user simulated paper trading account (no execution engine in this phase)
  paperAccounts: defineTable({
    userId: v.id("users"),
    startingCapital: v.number(),
    availableCash: v.number(),
    currency: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Paper order records — table exists as the persistence foundation for Phase 2.
  // No engine writes to it in Phase 1; nothing is fabricated.
  paperOrders: defineTable({
    userId: v.id("users"),
    accountId: v.id("paperAccounts"),
    instrumentId: v.string(),
    side: v.union(v.literal("BUY"), v.literal("SELL")),
    orderType: v.union(v.literal("MARKET"), v.literal("LIMIT"), v.literal("STOP_LOSS")),
    quantity: v.number(),
    price: v.optional(v.number()),
    triggerPrice: v.optional(v.number()),
    status: v.union(
      v.literal("PENDING"),
      v.literal("FILLED"),
      v.literal("CANCELLED"),
      v.literal("REJECTED")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_account", ["accountId"]),
});
