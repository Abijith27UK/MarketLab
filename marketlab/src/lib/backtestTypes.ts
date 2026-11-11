import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import type {
  ConditionType,
  StrategyCondition,
  StrategyConfig,
} from "@backtest/types";

/**
 * UI types derived from the official generated Convex API plus the defaults and
 * small helpers the Strategies page needs. Strategy rules themselves live in
 * `convex/backtestCore` and are shared with the backend, so the browser and the
 * server validate the same thing.
 */

export type StrategyRow = FunctionReturnType<typeof api.strategies.list>[number];
export type BacktestRunRow = FunctionReturnType<typeof api.backtests.listForStrategy>[number];
export type RunMetrics = BacktestRunRow["metrics"];
export type RunTrade = BacktestRunRow["trades"][number];
export type RunEquityPoint = BacktestRunRow["equityCurve"][number];
export type RunPricePoint = BacktestRunRow["priceCurve"][number];

/** Create/update mutation arguments without the strategy id. */
export type StrategyPayload = Omit<FunctionArgs<typeof api.strategies.create>, "strategyId">;

export const EXIT_REASON_LABEL: Record<RunTrade["exitReason"], string> = {
  exit_signal: "Exit signal",
  stop_loss: "Stop-loss",
  take_profit: "Take-profit",
  end_of_data: "End of data",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date input value (YYYY-MM-DD) for an epoch-ms timestamp. */
export function dateInputValue(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parses a date input value as UTC midnight. */
export function dateInputToMs(value: string): number {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** A condition with every field present and sensible defaults for its type. */
export function defaultCondition(type: ConditionType): StrategyCondition {
  const base: StrategyCondition = {
    type,
    maKind: null,
    period: null,
    fast: null,
    slow: null,
    signal: null,
    threshold: null,
  };
  switch (type) {
    case "PRICE_ABOVE_MA":
    case "PRICE_BELOW_MA":
    case "PRICE_CROSS_ABOVE_MA":
    case "PRICE_CROSS_BELOW_MA":
      return { ...base, maKind: "SMA", period: 20 };
    case "FAST_MA_ABOVE_SLOW_MA":
    case "FAST_MA_BELOW_SLOW_MA":
      return { ...base, maKind: "SMA", fast: 20, slow: 50 };
    case "RSI_ABOVE":
      return { ...base, period: 14, threshold: 70 };
    case "RSI_BELOW":
      return { ...base, period: 14, threshold: 30 };
    case "MACD_CROSS_ABOVE":
    case "MACD_CROSS_BELOW":
      return { ...base, fast: 12, slow: 26, signal: 9 };
    default:
      return base;
  }
}

/** A complete, valid starting strategy for the builder. */
export function defaultStrategyConfig(instrumentId: string, nowMs = Date.now()): StrategyConfig {
  return {
    instrumentId,
    interval: "1d",
    fromMs: nowMs - 730 * DAY_MS,
    toMs: nowMs,
    initialCapital: 100_000,
    datasetMode: "AUTO",
    sizing: {
      kind: "PERCENT_OF_EQUITY",
      quantity: null,
      percentOfEquity: 25,
      maxPositionValuePct: 50,
    },
    entry: {
      combinator: "AND",
      conditions: [
        { type: "PRICE_CROSS_ABOVE_MA", maKind: "SMA", period: 20, fast: null, slow: null, signal: null, threshold: null },
      ],
    },
    exit: {
      combinator: "AND",
      conditions: [
        { type: "PRICE_CROSS_BELOW_MA", maKind: "SMA", period: 20, fast: null, slow: null, signal: null, threshold: null },
      ],
    },
    stopLossPct: 8,
    takeProfitPct: null,
    costs: { brokerageFlat: 20, brokeragePct: 0.05, slippageBps: 5 },
  };
}

/** Converts a stored strategy document back into builder fields. */
export function configFromRow(row: StrategyRow): StrategyConfig {
  return {
    instrumentId: row.instrumentId,
    interval: row.interval,
    fromMs: row.fromMs,
    toMs: row.toMs,
    initialCapital: row.initialCapital,
    datasetMode: row.datasetMode,
    sizing: {
      kind: row.sizing.kind,
      quantity: row.sizing.quantity,
      percentOfEquity: row.sizing.percentOfEquity,
      maxPositionValuePct: row.sizing.maxPositionValuePct,
    },
    entry: {
      combinator: row.entry.combinator,
      conditions: row.entry.conditions as unknown as StrategyCondition[],
    },
    exit: {
      combinator: row.exit.combinator,
      conditions: row.exit.conditions as unknown as StrategyCondition[],
    },
    stopLossPct: row.stopLossPct,
    takeProfitPct: row.takeProfitPct,
    costs: {
      brokerageFlat: row.costs.brokerageFlat,
      brokeragePct: row.costs.brokeragePct,
      slippageBps: row.costs.slippageBps,
    },
  };
}

/** Builds the create/update payload from builder state. */
export function payloadFromDraft(
  name: string,
  description: string,
  config: StrategyConfig
): StrategyPayload {
  return {
    name,
    description,
    instrumentId: config.instrumentId,
    interval: config.interval,
    fromMs: config.fromMs,
    toMs: config.toMs,
    initialCapital: config.initialCapital,
    datasetMode: config.datasetMode,
    sizing: config.sizing,
    entry: config.entry as unknown as StrategyPayload["entry"],
    exit: config.exit as unknown as StrategyPayload["exit"],
    stopLossPct: config.stopLossPct,
    takeProfitPct: config.takeProfitPct,
    costs: config.costs,
  };
}
