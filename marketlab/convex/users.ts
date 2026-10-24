import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const themeValidator = v.union(
  v.literal("light"),
  v.literal("dark"),
  v.literal("system")
);

const tradingModeValidator = v.union(v.literal("paper"), v.literal("live"));

const orderSettingsValidator = v.object({
  productType: v.string(),
  duration: v.string(),
  autoSquareOff: v.boolean(),
});

const notificationPreferencesValidator = v.object({
  emailNotifications: v.boolean(),
  priceAlerts: v.boolean(),
  weeklyDigest: v.boolean(),
});

/**
 * Returns the authenticated user's profile, or null when signed out.
 * Owner is derived from the session identity — never from client input.
 */
export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) return null;
    const user = await ctx.db.get(userId);
    return {
      ...profile,
      email: user?.email ?? null,
    };
  },
});

/**
 * Creates the profile document for the signed-in user if it does not exist.
 * Idempotent; owner always comes from the authenticated session.
 */
export const ensureProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return existing._id;
    const user = await ctx.db.get(userId);
    const now = Date.now();
    return await ctx.db.insert("userProfiles", {
      userId,
      name: user?.name ?? user?.email?.split("@")[0] ?? "User",
      theme: "dark",
      currency: "INR",
      timezone: "Asia/Kolkata",
      defaultTradingMode: "paper",
      defaultOrderSettings: {
        productType: "delivery",
        duration: "DAY",
        autoSquareOff: true,
      },
      notificationPreferences: {
        emailNotifications: false,
        priceAlerts: true,
        weeklyDigest: false,
      },
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Updates the signed-in user's own profile. Only provided fields are patched.
 */
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    theme: v.optional(themeValidator),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
    defaultTradingMode: v.optional(tradingModeValidator),
    defaultOrderSettings: v.optional(orderSettingsValidator),
    notificationPreferences: v.optional(notificationPreferencesValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!profile) throw new Error("Profile not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.theme !== undefined) updates.theme = args.theme;
    if (args.currency !== undefined) updates.currency = args.currency;
    if (args.timezone !== undefined) updates.timezone = args.timezone;
    if (args.defaultTradingMode !== undefined)
      updates.defaultTradingMode = args.defaultTradingMode;
    if (args.defaultOrderSettings !== undefined)
      updates.defaultOrderSettings = args.defaultOrderSettings;
    if (args.notificationPreferences !== undefined)
      updates.notificationPreferences = args.notificationPreferences;

    await ctx.db.patch(profile._id, updates);
    return profile._id;
  },
});
