/**
 * Backtest limits and the engine version.
 *
 * The simulation is deterministic and synchronous: one run is a bounded loop
 * over a bounded candle series inside a single Convex mutation. These limits are
 * what keep that promise, and they are enforced server-side, not in the UI.
 */

/** Bumped whenever execution, sizing or metric semantics change. */
export const ENGINE_VERSION = "backtest-1.0.0";

/** Hard cap on candles a single run may read. */
export const MAX_BACKTEST_CANDLES = 5000;

/** A run needs enough history to warm every indicator up. */
export const MIN_BACKTEST_CANDLES = 40;

/** Stored equity/price curve points (downsampled; metrics use every candle). */
export const MAX_CURVE_POINTS = 400;

/** Stored trade rows. Metrics are always computed from the full trade list. */
export const MAX_STORED_TRADES = 500;

/** Condition and parameter limits (complexity budget). */
export const MAX_CONDITIONS_PER_SIDE = 6;
export const MIN_PERIOD = 2;
export const MAX_PERIOD = 200;

/** Capital and position limits. */
export const MIN_INITIAL_CAPITAL = 10_000;
export const MAX_INITIAL_CAPITAL = 10_000_000;
export const MAX_QUANTITY = 100_000;
export const MAX_STOP_LOSS_PCT = 50;
export const MAX_TAKE_PROFIT_PCT = 500;

/** Cost bounds. These are user assumptions, not Indian statutory rates. */
export const MAX_BROKERAGE_FLAT = 1_000;
export const MAX_BROKERAGE_PCT = 5;
export const MAX_SLIPPAGE_BPS = 200;

/** Runs returned per strategy history request. */
export const MAX_RUN_HISTORY = 20;

/** Rupee rounding, shared with the paper engine's convention. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100)) / 100;
}

export function roundRatio(value: number, decimals = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * factor)) / factor;
}
