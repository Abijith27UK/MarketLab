/**
 * Strategy and backtest types.
 *
 * Pure TypeScript shared by the Convex backend, the Strategies UI and the unit
 * tests. A strategy is structured data — never user-supplied code — so the
 * engine can only ever evaluate the rules implemented here.
 */

export type BacktestInterval = "1m" | "5m" | "15m" | "1h" | "1d" | "1w" | "1M";

/** Candle intervals the engine accepts, finest to coarsest. */
export const BACKTEST_INTERVALS: BacktestInterval[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "1d",
  "1w",
  "1M",
];

export type Combinator = "AND" | "OR";

export type MovingAverageKind = "SMA" | "EMA";

export type ConditionType =
  | "PRICE_ABOVE_MA"
  | "PRICE_BELOW_MA"
  | "PRICE_CROSS_ABOVE_MA"
  | "PRICE_CROSS_BELOW_MA"
  | "FAST_MA_ABOVE_SLOW_MA"
  | "FAST_MA_BELOW_SLOW_MA"
  | "RSI_ABOVE"
  | "RSI_BELOW"
  | "MACD_CROSS_ABOVE"
  | "MACD_CROSS_BELOW";

export const CONDITION_TYPES: ConditionType[] = [
  "PRICE_ABOVE_MA",
  "PRICE_BELOW_MA",
  "PRICE_CROSS_ABOVE_MA",
  "PRICE_CROSS_BELOW_MA",
  "FAST_MA_ABOVE_SLOW_MA",
  "FAST_MA_BELOW_SLOW_MA",
  "RSI_ABOVE",
  "RSI_BELOW",
  "MACD_CROSS_ABOVE",
  "MACD_CROSS_BELOW",
];

export const CONDITION_LABEL: Record<ConditionType, string> = {
  PRICE_ABOVE_MA: "Close above moving average",
  PRICE_BELOW_MA: "Close below moving average",
  PRICE_CROSS_ABOVE_MA: "Close crosses above moving average",
  PRICE_CROSS_BELOW_MA: "Close crosses below moving average",
  FAST_MA_ABOVE_SLOW_MA: "Fast moving average above slow",
  FAST_MA_BELOW_SLOW_MA: "Fast moving average below slow",
  RSI_ABOVE: "RSI above threshold",
  RSI_BELOW: "RSI below threshold",
  MACD_CROSS_ABOVE: "MACD crosses above signal",
  MACD_CROSS_BELOW: "MACD crosses below signal",
};

/**
 * One condition. Fields are optional because different condition types need
 * different parameters; `validateCondition` rejects a condition that omits the
 * parameters its type requires.
 */
export interface StrategyCondition {
  type: ConditionType;
  /** Moving-average kind for the MA-based conditions. */
  maKind: MovingAverageKind | null;
  /** Period for single-MA and RSI conditions. */
  period: number | null;
  /** Fast period for fast/slow MA and MACD. */
  fast: number | null;
  /** Slow period for fast/slow MA and MACD. */
  slow: number | null;
  /** MACD signal period. */
  signal: number | null;
  /** RSI threshold. */
  threshold: number | null;
}

export interface RuleSet {
  combinator: Combinator;
  conditions: StrategyCondition[];
}

export type SizingKind = "FIXED_QUANTITY" | "PERCENT_OF_EQUITY";

export interface SizingConfig {
  kind: SizingKind;
  /** Whole shares for FIXED_QUANTITY. */
  quantity: number | null;
  /** Percent of current equity for PERCENT_OF_EQUITY. */
  percentOfEquity: number | null;
  /** Hard cap on a position's value as a percent of equity. */
  maxPositionValuePct: number;
}

export interface CostConfig {
  /** Flat brokerage per executed side, in rupees. */
  brokerageFlat: number;
  /** Brokerage as a percent of turnover, per executed side. */
  brokeragePct: number;
  /** Slippage applied against the trader, in basis points. */
  slippageBps: number;
}

/**
 * How the run picks its candle series.
 * - `AUTO`: use a genuine dataset when one exists, otherwise the sample series
 *   (clearly labelled, never silently presented as real history).
 * - `REAL_ONLY`: refuse to run without genuine data.
 * - `SAMPLE`: always use the deterministic sample series for this instrument.
 */
export type DatasetMode = "AUTO" | "REAL_ONLY" | "SAMPLE";

export const DATASET_MODES: DatasetMode[] = ["AUTO", "REAL_ONLY", "SAMPLE"];

export interface StrategyConfig {
  instrumentId: string;
  interval: BacktestInterval;
  fromMs: number;
  toMs: number;
  initialCapital: number;
  datasetMode: DatasetMode;
  sizing: SizingConfig;
  entry: RuleSet;
  exit: RuleSet;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  costs: CostConfig;
}

/** Strategy record as the UI edits it (server adds identity and timestamps). */
export interface StrategyDraft {
  name: string;
  description: string;
  config: StrategyConfig;
}

/* ------------------------------------------------------------------ */
/* Candle input                                                        */
/* ------------------------------------------------------------------ */

/** Minimal candle shape the engine consumes (already validated and sorted). */
export interface BacktestCandle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export type DatasetKind = "sample" | "import" | "cache";

export interface DatasetInfo {
  kind: DatasetKind;
  /** `sample`, a provider id, or `csv_import`. */
  source: string;
  mode: "SAMPLE" | "HISTORICAL";
  datasetId: string | null;
  /** Short content hash so a stored run can be traced to its exact input. */
  hash: string;
  rowCount: number;
  firstTs: number | null;
  lastTs: number | null;
  gaps: number;
  /** Plain-language provenance line shown with the result. */
  label: string;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export type ExitReason = "exit_signal" | "stop_loss" | "take_profit" | "end_of_data";

export interface BacktestTrade {
  entryIndex: number;
  exitIndex: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  returnPct: number;
  exitReason: ExitReason;
  /** True when stop-loss and take-profit could both have been hit in one candle. */
  ambiguousExit: boolean;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  drawdownPct: number;
}

export interface PricePoint {
  ts: number;
  close: number;
}

export interface BacktestMetrics {
  initialCapital: number;
  finalEquity: number;
  netPnl: number;
  returnPct: number;
  maxDrawdownPct: number;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
  /** Null when there are no closed trades — never a fabricated 0%. */
  winRatePct: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  /** Null when there are no losing trades (undefined, not infinite). */
  profitFactor: number | null;
  exposurePct: number;
  totalBrokerage: number;
  totalSlippage: number;
  totalCosts: number;
}

export interface BacktestOutput {
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  priceCurve: PricePoint[];
  warnings: string[];
  candlesUsed: number;
  signalsEvaluated: number;
  /** True when the data ended with a position still open (valued at last close). */
  openPositionAtEnd: boolean;
  /** Deterministic hash over the candle series and the strategy config. */
  inputHash: string;
  engineVersion: string;
}
