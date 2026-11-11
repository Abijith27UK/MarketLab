import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { planAlertEvaluation } from "./alertsCore";

/**
 * Price threshold alerts.
 *
 * Evaluation is explicit: nothing runs in the background and no message is
 * delivered. The owner (or the Alerts page's "Check now" button) triggers an
 * evaluation, which reads the same eligible quotes the rest of the app uses and
 * records the exact price, source and freshness label for every alert it saw.
 *
 * A SAMPLE quote can satisfy a threshold, but the resulting trigger is stored
 * and displayed as SAMPLE — never as a real market event. A request failure
 * leaves the alert untouched rather than inventing a price.
 */

const MAX_ALERTS_PER_USER = 25;
const MAX_NOTE_LENGTH = 160;

export interface AlertEvaluationSummary {
  evaluated: number;
  triggered: number;
  skippedNoPrice: number;
  /** Alerts whose only price was stale or historical: recorded, never fired. */
  skippedStale: number;
  /** Alerts whose only price was an end-of-day close: recorded, never fired. */
  skippedEod: number;
  sampleEvaluated: number;
  triggeredSample: number;
  asOf: number;
  note: string | null;
}

/** Internal read used by the evaluation action (owner is passed by the action). */
export const activeForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("priceAlerts")
      .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", "ACTIVE"))
      .take(MAX_ALERTS_PER_USER);
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("priceAlerts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

function normalizeThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Threshold must be a positive price");
  }
  return Math.round(value * 100) / 100;
}

export const create = mutation({
  args: {
    instrumentId: v.string(),
    direction: v.union(v.literal("ABOVE"), v.literal("BELOW")),
    threshold: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Canonical id first, then the legacy `EXCHANGE:SYMBOL:TYPE` form, matching
    // the resolver the paper engine and backtests use.
    let instrument = await ctx.db
      .query("instruments")
      .withIndex("by_instrument_id", (q) => q.eq("instrumentId", args.instrumentId))
      .first();
    if (!instrument) {
      const [exchange, symbol, type] = args.instrumentId.split(":");
      if (exchange === "NSE" || exchange === "BSE") {
        const rows = await ctx.db
          .query("instruments")
          .withIndex("by_exchange_symbol", (q) => q.eq("exchange", exchange).eq("symbol", symbol))
          .collect();
        instrument = rows.find((row) => row.instrumentType === type) ?? rows[0] ?? null;
      }
    }
    if (!instrument) throw new Error("Instrument not found");
    if (instrument.instrumentType !== "EQUITY" && instrument.instrumentType !== "ETF") {
      throw new Error("Alerts support equity and ETF instruments only.");
    }

    const threshold = normalizeThreshold(args.threshold);
    const note = (args.note ?? "").trim().slice(0, MAX_NOTE_LENGTH);

    const existing = await ctx.db
      .query("priceAlerts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(200);
    const activeCount = existing.filter((alert) => alert.status !== "TRIGGERED").length;
    if (activeCount >= MAX_ALERTS_PER_USER) {
      throw new Error(
        `You already have ${MAX_ALERTS_PER_USER} alerts. Delete one before creating another.`
      );
    }
    const duplicate = existing.find(
      (alert) =>
        alert.instrumentId === args.instrumentId &&
        alert.direction === args.direction &&
        Math.abs(alert.threshold - threshold) < 0.005 &&
        alert.status === "ACTIVE"
    );
    if (duplicate) throw new Error("An identical active alert already exists.");

    const now = Date.now();
    const instrumentId = instrument.instrumentId ?? args.instrumentId;
    return await ctx.db.insert("priceAlerts", {
      userId,
      instrumentId,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      direction: args.direction,
      threshold,
      status: "ACTIVE",
      note,
      lastEvaluatedAt: null,
      lastPrice: null,
      lastMode: null,
      lastSource: null,
      triggeredAt: null,
      triggerPrice: null,
      triggerMode: null,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Updates an alert's threshold, direction or note.
 *
 * A triggered alert cannot be edited in place: its stored trigger price and
 * label describe a past evaluation, so it must be re-armed first. The caller is
 * authenticated and the record's owner is checked here, not in the UI.
 */
export const update = mutation({
  args: {
    alertId: v.id("priceAlerts"),
    threshold: v.number(),
    direction: v.optional(v.union(v.literal("ABOVE"), v.literal("BELOW"))),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const alert = await ctx.db.get(args.alertId);
    if (!alert) throw new Error("Alert not found");
    if (alert.userId !== userId) throw new Error("Not authorized");
    if (alert.status === "TRIGGERED") {
      throw new Error("Re-arm this alert before changing it — its trigger record is history.");
    }
    const threshold = normalizeThreshold(args.threshold);
    const note = (args.note ?? alert.note).trim().slice(0, MAX_NOTE_LENGTH);
    await ctx.db.patch(alert._id, {
      threshold,
      direction: args.direction ?? alert.direction,
      note,
      updatedAt: Date.now(),
    });
    return alert._id;
  },
});

export const setStatus = mutation({
  args: {
    alertId: v.id("priceAlerts"),
    status: v.union(v.literal("ACTIVE"), v.literal("PAUSED")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const alert = await ctx.db.get(args.alertId);
    if (!alert) throw new Error("Alert not found");
    if (alert.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(alert._id, { status: args.status, updatedAt: Date.now() });
    return args.status;
  },
});

/** Puts a triggered alert back into service (and clears its trigger record). */
export const rearm = mutation({
  args: { alertId: v.id("priceAlerts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const alert = await ctx.db.get(args.alertId);
    if (!alert) throw new Error("Alert not found");
    if (alert.userId !== userId) throw new Error("Not authorized");
    await ctx.db.patch(alert._id, {
      status: "ACTIVE",
      triggeredAt: null,
      triggerPrice: null,
      triggerMode: null,
      updatedAt: Date.now(),
    });
    return "ACTIVE";
  },
});

export const remove = mutation({
  args: { alertId: v.id("priceAlerts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const alert = await ctx.db.get(args.alertId);
    if (!alert) throw new Error("Alert not found");
    if (alert.userId !== userId) throw new Error("Not authorized");
    await ctx.db.delete(alert._id);
    return true;
  },
});

/**
 * Applies an evaluation produced by the action. Prices come from the market-data
 * layer, never from the browser; ownership is re-checked for every row.
 */
export const applyEvaluation = internalMutation({
  args: {
    userId: v.id("users"),
    nowMs: v.number(),
    observations: v.array(
      v.object({
        alertId: v.id("priceAlerts"),
        price: v.number(),
        mode: v.union(
          v.literal("LIVE"),
          v.literal("DELAYED"),
          v.literal("CACHED"),
          v.literal("HISTORICAL"),
          v.literal("SAMPLE")
        ),
        source: v.string(),
        crossed: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    let triggered = 0;
    for (const observation of args.observations) {
      const alert = await ctx.db.get(observation.alertId);
      if (!alert || alert.userId !== args.userId || alert.status !== "ACTIVE") continue;
      const patch: Partial<Doc<"priceAlerts">> = {
        lastEvaluatedAt: args.nowMs,
        lastPrice: observation.price,
        lastMode: observation.mode,
        lastSource: observation.source,
        updatedAt: args.nowMs,
      };
      if (observation.crossed) {
        patch.status = "TRIGGERED";
        patch.triggeredAt = args.nowMs;
        patch.triggerPrice = observation.price;
        patch.triggerMode = observation.mode;
        triggered += 1;
      }
      await ctx.db.patch(alert._id, patch);
    }
    return triggered;
  },
});

/**
 * Evaluates the caller's active alerts against the current eligible quotes.
 *
 * Returns counts only; the UI reads the updated rows back from `list` so the
 * displayed state is always the persisted one.
 */
export const evaluate = action({
  args: {},
  handler: async (ctx): Promise<AlertEvaluationSummary> => {
    const userId = await ctx.runQuery(internal.marketStore.currentUserId, {});
    if (!userId) throw new Error("Not authenticated");

    const alerts = await ctx.runQuery(internal.alerts.activeForUser, { userId });
    const asOf = Date.now();
    if (alerts.length === 0) {
      return {
        evaluated: 0,
        triggered: 0,
        skippedNoPrice: 0,
        skippedStale: 0,
        skippedEod: 0,
        sampleEvaluated: 0,
        triggeredSample: 0,
        asOf,
        note: "No active alerts to evaluate.",
      };
    }

    const ids = Array.from(new Set(alerts.map((alert) => alert.instrumentId)));
    const result = await ctx.runAction(api.marketData.getQuotes, {
      instrumentIds: ids,
      forceRefresh: true,
    });

    const byId = new Map(result.quotes.map((quote) => [quote.instrumentId, quote]));
    const plan = planAlertEvaluation(
      alerts.map((alert) => ({
        _id: alert._id,
        instrumentId: alert.instrumentId,
        direction: alert.direction,
        threshold: alert.threshold,
        status: alert.status,
      })),
      byId
    );

    const triggered = await ctx.runMutation(internal.alerts.applyEvaluation, {
      userId,
      nowMs: asOf,
      observations: plan.observations,
    });

    return {
      evaluated: plan.observations.length,
      triggered,
      skippedNoPrice: plan.skippedNoPrice,
      skippedStale: plan.skippedStale,
      skippedEod: plan.skippedEod,
      sampleEvaluated: plan.sampleEvaluated,
      triggeredSample: plan.sampleCrossed,
      asOf,
      note: result.warning ?? result.note ?? null,
    };
  },
});
