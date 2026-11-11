/**
 * Paper-trading configuration and money rules.
 *
 * This module is pure TypeScript so the Convex backend, the React frontend and
 * the unit tests all share exactly one set of constants. Nothing here reaches a
 * broker: the whole feature is a simulation stored in Convex.
 *
 * Rounding policy
 * ---------------
 * Cash, prices and cost basis are stored as rupees rounded to 2 decimals
 * (`roundMoney`), which is the smallest INR unit an exchange order can use.
 * Quantities are whole shares. Derived ratios (average cost per share) keep 4
 * decimals so a partial sell can reproduce the same cost basis it removed.
 */

/** Default virtual capital for a newly created paper account (₹1,00,000). */
export const DEFAULT_STARTING_CAPITAL = 100_000;

/** The user may choose their own starting capital, within these bounds. */
export const MIN_STARTING_CAPITAL = 1_000;
export const MAX_STARTING_CAPITAL = 50_000_000;

/** Whole shares per order. Guards against absurd inputs, not against big trades. */
export const MAX_ORDER_QUANTITY = 100_000;

/** Orders and ledger rows returned per history request. */
export const MAX_HISTORY_ROWS = 100;

/**
 * A stored quote is still usable for a fill while it is this fresh. Older values
 * are labelled `CACHED` instead of being presented as a current price.
 */
export const MAX_FILL_QUOTE_AGE_MS = 5 * 60_000;

/**
 * Demo switch: with no provider configured the simulation fills against the
 * deterministic sample series, and every such fill is stored with mode SAMPLE.
 * Set to false to require a provider quote for every fill (orders are then
 * rejected with "no eligible price").
 */
export const SAMPLE_FILLS_ENABLED = true;

/** Instruments the simulation can trade. Indices and derivatives are rejected. */
export const SUPPORTED_INSTRUMENT_TYPES = ["EQUITY", "ETF"] as const;

/** Account currency; fixed for this phase. */
export const PAPER_CURRENCY = "INR";

/** Rounds a rupee amount to 2 decimals, halving away from zero on ties. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 100)) / 100;
}

/** Rounds a per-share ratio (average cost) to 4 decimals. */
export function roundRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const sign = value < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(value) * 10_000)) / 10_000;
}

export function isSupportedInstrumentType(type: string): boolean {
  return (SUPPORTED_INSTRUMENT_TYPES as readonly string[]).includes(type);
}
