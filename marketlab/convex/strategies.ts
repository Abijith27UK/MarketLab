import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { validateStrategyDraft } from "./backtestCore/validation";
import type { StrategyConfig, StrategyDraft, StrategyCondition } from "./backtestCore/types";

/**
 * Saved strategies, owned by the authenticated user.
 *
 * Rules arrive as structured data and are validated here before storage; no
 * function accepts executable code, and no function trusts a client user id.
 */

const MAX_STRATEGIES_PER_USER = 50;

const conditionArg = v.object({
  type: v.string(),
  maKind: v.union(v.literal("SMA"), v.literal("EMA"), v.null()),
  period: v.union(v.number(), v.null()),
  fast: v.union(v.number(), v.null()),
  slow: v.union(v.number(), v.null()),
  signal: v.union(v.number(), v.null()),
  threshold: v.union(v.number(), v.null()),
});

const ruleSetArg = v.object({
  combinator: v.union(v.literal("AND"), v.literal("OR")),
  conditions: v.array(conditionArg),
});

const sizingArg = v.object({
  kind: v.union(v.literal("FIXED_QUANTITY"), v.literal("PERCENT_OF_EQUITY")),
  quantity: v.union(v.number(), v.null()),
  percentOfEquity: v.union(v.number(), v.null()),
  maxPositionValuePct: v.number(),
});

const costsArg = v.object({
  brokerageFlat: v.number(),
  brokeragePct: v.number(),
  slippageBps: v.number(),
});

const intervalArg = v.union(
  v.literal("1m"),
  v.literal("5m"),
  v.literal("15m"),
  v.literal("1h"),
  v.literal("1d"),
  v.literal("1w"),
  v.literal("1M")
);

const strategyFields = {
  name: v.string(),
  description: v.string(),
  instrumentId: v.string(),
  interval: intervalArg,
  fromMs: v.number(),
  toMs: v.number(),
  initialCapital: v.number(),
  datasetMode: v.union(v.literal("AUTO"), v.literal("REAL_ONLY"), v.literal("SAMPLE")),
  sizing: sizingArg,
  entry: ruleSetArg,
  exit: ruleSetArg,
  stopLossPct: v.union(v.number(), v.null()),
  takeProfitPct: v.union(v.number(), v.null()),
  costs: costsArg,
};

/**
 * Wire shape of a condition. `type` is a plain string here because Convex
 * stores it as `v.string()`; `validateCondition` rejects anything outside the
 * supported union before a strategy is saved or simulated.
 */
type RawCondition = {
  type: string;
  maKind: "SMA" | "EMA" | null;
  period: number | null;
  fast: number | null;
  slow: number | null;
  signal: number | null;
  threshold: number | null;
};

type RawRuleSet = { combinator: "AND" | "OR"; conditions: RawCondition[] };

type StrategyFields = {
  name: string;
  description: string;
  instrumentId: string;
  interval: StrategyConfig["interval"];
  fromMs: number;
  toMs: number;
  initialCapital: number;
  datasetMode: StrategyConfig["datasetMode"];
  sizing: StrategyConfig["sizing"];
  entry: RawRuleSet;
  exit: RawRuleSet;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  costs: StrategyConfig["costs"];
};

/** Converts stored/argument fields into the engine's configuration shape. */
export function toConfig(fields: StrategyFields): StrategyConfig {
  return {
    instrumentId: fields.instrumentId,
    interval: fields.interval,
    fromMs: fields.fromMs,
    toMs: fields.toMs,
    initialCapital: fields.initialCapital,
    datasetMode: fields.datasetMode,
    sizing: {
      kind: fields.sizing.kind,
      quantity: fields.sizing.quantity,
      percentOfEquity: fields.sizing.percentOfEquity,
      maxPositionValuePct: fields.sizing.maxPositionValuePct,
    },
    entry: {
      combinator: fields.entry.combinator,
      conditions: fields.entry.conditions as unknown as StrategyCondition[],
    },
    exit: {
      combinator: fields.exit.combinator,
      conditions: fields.exit.conditions as unknown as StrategyCondition[],
    },
    stopLossPct: fields.stopLossPct,
    takeProfitPct: fields.takeProfitPct,
    costs: fields.costs,
  };
}

/** Strategy document → engine configuration (shared with the run mutation). */
export function configFromDoc(doc: Doc<"strategies">): StrategyConfig {
  return toConfig({
    name: doc.name,
    description: doc.description,
    instrumentId: doc.instrumentId,
    interval: doc.interval,
    fromMs: doc.fromMs,
    toMs: doc.toMs,
    initialCapital: doc.initialCapital,
    datasetMode: doc.datasetMode,
    sizing: doc.sizing,
    entry: doc.entry,
    exit: doc.exit,
    stopLossPct: doc.stopLossPct,
    takeProfitPct: doc.takeProfitPct,
    costs: doc.costs,
  });
}

function draftFromFields(fields: StrategyFields): StrategyDraft {
  return {
    name: fields.name,
    description: fields.description,
    config: toConfig(fields),
  };
}

async function assertValid(fields: StrategyFields): Promise<void> {
  const errors = validateStrategyDraft(draftFromFields(fields));
  if (errors.length > 0) throw new Error(errors.join(" "));
}

async function requireOwned(
  ctx: { db: { get: (id: Id<"strategies">) => Promise<Doc<"strategies"> | null> } },
  strategyId: Id<"strategies">,
  userId: Id<"users">
): Promise<Doc<"strategies">> {
  const strategy = await ctx.db.get(strategyId);
  // "Not found" for another user's id: do not leak that it exists.
  if (!strategy || strategy.userId !== userId) throw new Error("Strategy not found");
  return strategy;
}

/** All of the signed-in user's strategies, most recently edited first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("strategies")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_STRATEGIES_PER_USER);
  },
});

export const get = query({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return null;
    return strategy;
  },
});

export const create = mutation({
  args: { ...strategyFields },
  handler: async (ctx, args): Promise<Id<"strategies">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await assertValid(args);

    const existing = await ctx.db
      .query("strategies")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (existing.length >= MAX_STRATEGIES_PER_USER) {
      throw new Error(`You can keep at most ${MAX_STRATEGIES_PER_USER} strategies.`);
    }
    const name = args.name.trim();
    if (existing.some((strategy) => strategy.name === name)) {
      throw new Error("You already have a strategy with that name.");
    }

    const now = Date.now();
    return await ctx.db.insert("strategies", {
      userId,
      name,
      description: args.description.trim(),
      instrumentId: args.instrumentId,
      interval: args.interval,
      fromMs: args.fromMs,
      toMs: args.toMs,
      initialCapital: args.initialCapital,
      datasetMode: args.datasetMode,
      sizing: args.sizing,
      entry: args.entry,
      exit: args.exit,
      stopLossPct: args.stopLossPct,
      takeProfitPct: args.takeProfitPct,
      costs: args.costs,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: { strategyId: v.id("strategies"), ...strategyFields },
  handler: async (ctx, args): Promise<Id<"strategies">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const strategy = await requireOwned(ctx, args.strategyId, userId);
    await assertValid(args);

    const name = args.name.trim();
    const siblings = await ctx.db
      .query("strategies")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (siblings.some((other) => other._id !== strategy._id && other.name === name)) {
      throw new Error("You already have a strategy with that name.");
    }

    await ctx.db.patch(strategy._id, {
      name,
      description: args.description.trim(),
      instrumentId: args.instrumentId,
      interval: args.interval,
      fromMs: args.fromMs,
      toMs: args.toMs,
      initialCapital: args.initialCapital,
      datasetMode: args.datasetMode,
      sizing: args.sizing,
      entry: args.entry,
      exit: args.exit,
      stopLossPct: args.stopLossPct,
      takeProfitPct: args.takeProfitPct,
      costs: args.costs,
      version: strategy.version + 1,
      updatedAt: Date.now(),
    });
    return strategy._id;
  },
});

export const duplicate = mutation({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args): Promise<Id<"strategies">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const strategy = await requireOwned(ctx, args.strategyId, userId);

    let name = `${strategy.name} (copy)`.slice(0, 80);
    const existing = await ctx.db
      .query("strategies")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (existing.length >= MAX_STRATEGIES_PER_USER) {
      throw new Error(`You can keep at most ${MAX_STRATEGIES_PER_USER} strategies.`);
    }
    let suffix = 0;
    while (existing.some((other) => other.name === name)) {
      suffix += 1;
      name = `${strategy.name} (copy ${suffix + 1})`.slice(0, 80);
    }

    const now = Date.now();
    return await ctx.db.insert("strategies", {
      userId,
      name,
      description: strategy.description,
      instrumentId: strategy.instrumentId,
      interval: strategy.interval,
      fromMs: strategy.fromMs,
      toMs: strategy.toMs,
      initialCapital: strategy.initialCapital,
      datasetMode: strategy.datasetMode,
      sizing: strategy.sizing,
      entry: strategy.entry,
      exit: strategy.exit,
      stopLossPct: strategy.stopLossPct,
      takeProfitPct: strategy.takeProfitPct,
      costs: strategy.costs,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Deletes a strategy and the runs that belong to it. */
export const remove = mutation({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args): Promise<{ deleted: boolean; runsDeleted: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const strategy = await requireOwned(ctx, args.strategyId, userId);

    const runs = await ctx.db
      .query("backtestRuns")
      .withIndex("by_strategy", (q) => q.eq("strategyId", strategy._id))
      .collect();
    for (const run of runs) {
      if (run.userId === userId) await ctx.db.delete(run._id);
    }
    await ctx.db.delete(strategy._id);
    return { deleted: true, runsDeleted: runs.length };
  },
});
