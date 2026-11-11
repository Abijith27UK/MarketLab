import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { sampleCandles } from "./market/sample";
import { sha256Hex } from "./market/hash";
import { isGenuineDatasetCandidate } from "./market/provenance";
import { runBacktest } from "./backtestCore/engine";
import { validateStrategyConfig } from "./backtestCore/validation";
import { MAX_BACKTEST_CANDLES, MAX_RUN_HISTORY, MIN_BACKTEST_CANDLES } from "./backtestCore/config";
import { configFromDoc } from "./strategies";
import { findGaps } from "./market/normalize";
import { isEndOfDaySource } from "./market/provenance";
import type { BacktestPrepareResult } from "../src/lib/marketClient";
import type {
  BacktestCandle,
  DatasetInfo,
  StrategyConfig,
  StrategyCondition,
} from "./backtestCore/types";

/**
 * Backtest runs.
 *
 * A run is a bounded, synchronous simulation in one mutation: it reads at most
 * `MAX_BACKTEST_CANDLES` candles, never touches the network, and stores the
 * result it computed server-side. Client-supplied metrics are never accepted.
 */

const MIN_COVERAGE_RATIO = 0.5;

/**
 * Loads provider candles for a strategy before a REAL_ONLY run.
 *
 * `run` is a mutation and cannot fetch, so the browser calls this action first.
 * It fetches only the strategy's own instrument and interval, stores them in the
 * normal cache (so repeated runs reuse them), and reports exactly what arrived.
 * The action never fabricates candles and never widens the requested range.
 */
export const prepareData = action({
  args: { strategyId: v.id("strategies") },
  handler: async (ctx, args): Promise<BacktestPrepareResult> => {
    const strategy = await ctx.runQuery(api.strategies.get, { strategyId: args.strategyId });
    if (!strategy) throw new Error("Strategy not found");

    const config = configFromDoc(strategy);
    const errors = validateStrategyConfig(config);
    if (errors.length > 0) throw new Error(`This strategy is no longer valid: ${errors.join(" ")}`);

    const result = await ctx.runAction(api.marketData.getCandles, {
      instrumentId: config.instrumentId,
      interval: config.interval,
      fromMs: config.fromMs,
      toMs: config.toMs,
    });

    const real = result.source !== "sample" && result.mode !== "SAMPLE";
    return {
      instrumentId: config.instrumentId,
      interval: config.interval,
      mode: result.mode,
      source: result.source,
      eod: isEndOfDaySource(result.source),
      rowCount: result.candles.length,
      firstTs: result.quality.firstTs,
      lastTs: result.quality.lastTs,
      fromCache: result.quality.fromCache,
      ready: real && result.candles.length >= MIN_BACKTEST_CANDLES,
      note: result.note ?? null,
      warning: result.warning ?? null,
    };
  },
});

function toCandle(row: Doc<"candles">): BacktestCandle {
  return {
    ts: row.ts,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  };
}

function hashCandles(candles: BacktestCandle[]): string {
  return sha256Hex(
    JSON.stringify(
      candles.map((c) => [c.ts, c.open, c.high, c.low, c.close, c.volume])
    )
  ).slice(0, 16);
}

async function findInstrument(
  ctx: QueryCtx | MutationCtx,
  instrumentId: string
): Promise<Doc<"instruments"> | null> {
  const direct = await ctx.db
    .query("instruments")
    .withIndex("by_instrument_id", (q) => q.eq("instrumentId", instrumentId))
    .first();
  if (direct) return direct;
  const [exchange, symbol, type] = instrumentId.split(":");
  if (!exchange || !symbol) return null;
  if (exchange !== "NSE" && exchange !== "BSE") return null;
  const rows = await ctx.db
    .query("instruments")
    .withIndex("by_exchange_symbol", (q) => q.eq("exchange", exchange).eq("symbol", symbol))
    .collect();
  return rows.find((row) => row.instrumentType === type) ?? rows[0] ?? null;
}

interface ResolvedDataset {
  candles: BacktestCandle[];
  dataset: DatasetInfo;
  coverageWarnings: string[];
}

function sampleDataset(
  config: StrategyConfig,
  symbol: string,
  note: string
): ResolvedDataset {
  const candles: BacktestCandle[] = sampleCandles({
    symbol,
    interval: config.interval,
    fromMs: config.fromMs,
    toMs: config.toMs,
  }).map((candle) => ({
    ts: candle.ts,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));

  const gapInfo = findGaps(candles as any, config.interval);
  const dataset: DatasetInfo = {
    kind: "sample",
    source: "sample",
    mode: "SAMPLE",
    datasetId: null,
    hash: hashCandles(candles),
    rowCount: candles.length,
    firstTs: candles[0]?.ts ?? null,
    lastTs: candles[candles.length - 1]?.ts ?? null,
    gaps: gapInfo.count,
    label: `SAMPLE · deterministic series for ${symbol} (${config.interval}) — ${note}`,
  };

  if (candles.length < MIN_BACKTEST_CANDLES) {
    throw new Error(
      `Only ${candles.length} sample candles fall in the selected range; at least ${MIN_BACKTEST_CANDLES} are needed. Widen the date range.`
    );
  }
  return { candles, dataset, coverageWarnings: [] };
}

async function candlesFromDataset(
  ctx: MutationCtx,
  dataset: Doc<"candleDatasets">,
  config: StrategyConfig
): Promise<BacktestCandle[]> {
  const rows = await ctx.db
    .query("candles")
    .withIndex("by_dataset_ts", (q) =>
      q.eq("datasetId", dataset._id).gte("ts", config.fromMs).lte("ts", config.toMs)
    )
    .take(MAX_BACKTEST_CANDLES + 1);
  if (rows.length > MAX_BACKTEST_CANDLES) {
    throw new Error(
      `This range contains more than ${MAX_BACKTEST_CANDLES} candles, which is the per-run limit. Narrow the dates or use a coarser interval.`
    );
  }
  return rows.map(toCandle);
}

async function resolveDataset(
  ctx: MutationCtx,
  userId: Id<"users">,
  config: StrategyConfig,
  symbol: string
): Promise<ResolvedDataset> {
  if (config.datasetMode === "SAMPLE") {
    return sampleDataset(config, symbol, "sample mode selected");
  }

  const now = Date.now();
  const candidates = (
    await ctx.db
      .query("candleDatasets")
      .withIndex("by_instrument_interval", (q) =>
        q.eq("instrumentId", config.instrumentId).eq("interval", config.interval)
      )
      .collect()
  )
    .filter((dataset) => dataset.expiresAt === null || dataset.expiresAt > now)
    .filter((dataset) => isGenuineDatasetCandidate(dataset, userId))
    .sort((a, b) => {
      // User-validated imports win over provider caches, then newest first.
      if (a.kind !== b.kind) return a.kind === "import" ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

  let best: { dataset: Doc<"candleDatasets">; candles: BacktestCandle[] } | null = null;
  for (const candidate of candidates) {
    const candles = await candlesFromDataset(ctx, candidate, config);
    if (candles.length < MIN_BACKTEST_CANDLES) continue;
    if (!best || candles.length > best.candles.length) best = { dataset: candidate, candles };
    if (candidate.kind === "import" && candles.length >= MIN_BACKTEST_CANDLES) break;
  }

  if (!best) {
    if (config.datasetMode === "REAL_ONLY") {
      throw new Error(
        `No genuine candle dataset covers ${symbol} at ${config.interval} for this range. Import a validated CSV on the instrument page or configure a market-data provider, then run again. The engine did not substitute sample candles because this strategy requires real data.`
      );
    }
    return sampleDataset(
      config,
      symbol,
      "no genuine dataset covers this instrument, interval and range"
    );
  }

  const { dataset, candles } = best;
  const coverageWarnings: string[] = [];
  const firstTs = candles[0]?.ts ?? null;
  const lastTs = candles[candles.length - 1]?.ts ?? null;
  const requested = Math.max(1, config.toMs - config.fromMs);
  const covered =
    firstTs !== null && lastTs !== null ? Math.min(lastTs, config.toMs) - Math.max(firstTs, config.fromMs) : 0;
  if (covered / requested < MIN_COVERAGE_RATIO) {
    coverageWarnings.push(
      `The chosen dataset covers only ${Math.round((covered / requested) * 100)}% of the requested range; results describe the candles that exist, not the missing periods.`
    );
  }
  if (dataset.kind === "import") {
    coverageWarnings.push(
      `Dataset is a private CSV import (${dataset.name}). Its accuracy is the importer's responsibility, and it is not exchange-verified data.`
    );
  }

  const gapInfo = findGaps(candles as any, config.interval);
  if (gapInfo.count > 0) {
    coverageWarnings.push(
      `Detected ${gapInfo.count} missing interval${gapInfo.count === 1 ? "" : "s"} in the dataset. Results are computed only over candles that exist.`
    );
  }

  const info: DatasetInfo = {
    kind: dataset.kind,
    source: dataset.source,
    mode: "HISTORICAL",
    datasetId: dataset._id,
    hash: hashCandles(candles),
    rowCount: candles.length,
    firstTs,
    lastTs,
    gaps: gapInfo.count,
    label:
      dataset.kind === "import"
        ? `CSV import · ${dataset.name} · ${candles.length} candles · private to your account`
        : `${dataset.source} cached candles · ${candles.length} candles · provider-sourced history`,
  };
  return { candles, dataset: info, coverageWarnings };
}

/**
 * Runs a saved strategy and stores the result.
 *
 * Returns the new run id; the UI reads the stored run back through
 * `listForStrategy`/`get`, so nothing displayed is a client-side calculation.
 */
export const run = mutation({
  args: { strategyId: v.id("strategies") },
  handler: async (
    ctx,
    args
  ): Promise<{
    runId: Id<"backtestRuns">;
    dataMode: string;
    label: string;
    warnings: string[];
    tradeCount: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) throw new Error("Strategy not found");

    const config = configFromDoc(strategy);
    const errors = validateStrategyConfig(config);
    if (errors.length > 0) {
      throw new Error(`This strategy is no longer valid: ${errors.join(" ")}`);
    }

    const instrument = await findInstrument(ctx, config.instrumentId);
    if (!instrument) throw new Error("Instrument not found");
    if (instrument.instrumentType !== "EQUITY" && instrument.instrumentType !== "ETF") {
      throw new Error("Backtests support equity and ETF instruments only.");
    }

    const resolved = await resolveDataset(ctx, userId, config, instrument.symbol);
    const output = runBacktest({
      candles: resolved.candles,
      config,
      dataset: resolved.dataset,
    });

    const now = Date.now();
    const warnings = [...resolved.coverageWarnings, ...output.warnings];
    const labels = resolved.dataset.mode === "SAMPLE" ? ["SAMPLE"] : ["HISTORICAL", resolved.dataset.source];

    const runId = await ctx.db.insert("backtestRuns", {
      userId,
      strategyId: strategy._id,
      strategyVersion: strategy.version,
      strategyName: strategy.name,
      configSnapshot: JSON.stringify(config),
      instrumentId: config.instrumentId,
      interval: config.interval,
      fromMs: config.fromMs,
      toMs: config.toMs,
      datasetMode: config.datasetMode,
      datasetKind: resolved.dataset.kind,
      datasetSource: resolved.dataset.source,
      datasetLabel: resolved.dataset.label,
      datasetId: resolved.dataset.datasetId,
      datasetHash: resolved.dataset.hash,
      datasetRowCount: resolved.dataset.rowCount,
      datasetFirstTs: resolved.dataset.firstTs,
      datasetLastTs: resolved.dataset.lastTs,
      datasetGaps: resolved.dataset.gaps,
      dataMode: resolved.dataset.mode,
      metrics: output.metrics,
      equityCurve: output.equityCurve,
      priceCurve: output.priceCurve,
      trades: output.trades,
      labels,
      warnings,
      truncatedTrades: output.metrics.tradeCount > output.trades.length,
      openPositionAtEnd: output.openPositionAtEnd,
      candlesUsed: output.candlesUsed,
      signalsEvaluated: output.signalsEvaluated,
      engineVersion: output.engineVersion,
      inputHash: output.inputHash,
      status: "COMPLETED",
      createdAt: now,
      completedAt: Date.now(),
    });

    // Keep the history bounded: newest MAX_RUN_HISTORY runs per strategy.
    const history = await ctx.db
      .query("backtestRuns")
      .withIndex("by_strategy_created", (q) => q.eq("strategyId", strategy._id))
      .order("desc")
      .take(MAX_RUN_HISTORY + 20);
    for (const stale of history.slice(MAX_RUN_HISTORY)) {
      if (stale.userId === userId) await ctx.db.delete(stale._id);
    }

    return {
      runId,
      dataMode: resolved.dataset.mode,
      label: resolved.dataset.label,
      warnings,
      tradeCount: output.metrics.tradeCount,
    };
  },
});

/** Stored runs for one strategy, newest first. */
export const listForStrategy = query({
  args: { strategyId: v.id("strategies"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const strategy = await ctx.db.get(args.strategyId);
    if (!strategy || strategy.userId !== userId) return [];
    const limit = Math.min(Math.max(1, args.limit ?? MAX_RUN_HISTORY), MAX_RUN_HISTORY);
    return await ctx.db
      .query("backtestRuns")
      .withIndex("by_strategy_created", (q) => q.eq("strategyId", strategy._id))
      .order("desc")
      .take(limit);
  },
});

export const get = query({
  args: { runId: v.id("backtestRuns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== userId) return null;
    return run;
  },
});

export const remove = mutation({
  args: { runId: v.id("backtestRuns") },
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== userId) throw new Error("Run not found");
    await ctx.db.delete(run._id);
    return { deleted: true };
  },
});

/** Recent runs across all of the user's strategies (dashboard-style list). */
export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const limit = Math.min(Math.max(1, args.limit ?? 10), 50);
    return await ctx.db
      .query("backtestRuns")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

/** Exposed for the UI's condition descriptions when previewing a saved run. */
export type StoredCondition = StrategyCondition;
