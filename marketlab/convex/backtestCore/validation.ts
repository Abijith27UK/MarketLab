/**
 * Strategy validation.
 *
 * Runs on the server before anything is stored or simulated, and the same
 * function powers the UI's inline errors. Validation is strict on purpose: an
 * unsupported rule must be refused, never silently ignored or approximated.
 */

import {
  MAX_BROKERAGE_FLAT,
  MAX_BROKERAGE_PCT,
  MAX_CONDITIONS_PER_SIDE,
  MAX_INITIAL_CAPITAL,
  MAX_PERIOD,
  MAX_QUANTITY,
  MAX_SLIPPAGE_BPS,
  MAX_STOP_LOSS_PCT,
  MAX_TAKE_PROFIT_PCT,
  MIN_INITIAL_CAPITAL,
  MIN_PERIOD,
} from "./config";
import {
  BACKTEST_INTERVALS,
  DATASET_MODES,
  type StrategyCondition,
  type StrategyConfig,
  type StrategyDraft,
} from "./types";

const INSTRUMENT_ID_PATTERN = /^[A-Z0-9]{2,12}:[A-Z0-9&.\- ]{1,40}:(EQUITY|ETF)$/;

/** Equity/ETF only: the engine is long-only cash equity. */
export function validateInstrumentId(instrumentId: string): string | null {
  if (!INSTRUMENT_ID_PATTERN.test(instrumentId)) {
    return "Instrument must be a canonical equity or ETF id such as NSE:RELIANCE:EQUITY.";
  }
  return null;
}

function isInt(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isNum(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function validateCondition(condition: StrategyCondition): string | null {
  switch (condition.type) {
    case "PRICE_ABOVE_MA":
    case "PRICE_BELOW_MA":
    case "PRICE_CROSS_ABOVE_MA":
    case "PRICE_CROSS_BELOW_MA": {
      if (condition.maKind !== "SMA" && condition.maKind !== "EMA") {
        return "Choose SMA or EMA for this condition.";
      }
      if (!isInt(condition.period, MIN_PERIOD, MAX_PERIOD)) {
        return `Moving-average period must be a whole number between ${MIN_PERIOD} and ${MAX_PERIOD}.`;
      }
      return null;
    }
    case "FAST_MA_ABOVE_SLOW_MA":
    case "FAST_MA_BELOW_SLOW_MA": {
      if (condition.maKind !== "SMA" && condition.maKind !== "EMA") {
        return "Choose SMA or EMA for this condition.";
      }
      if (!isInt(condition.fast, MIN_PERIOD, MAX_PERIOD) || !isInt(condition.slow, MIN_PERIOD, MAX_PERIOD)) {
        return `Both moving-average periods must be whole numbers between ${MIN_PERIOD} and ${MAX_PERIOD}.`;
      }
      if ((condition.fast as number) >= (condition.slow as number)) {
        return "The fast moving-average period must be shorter than the slow period.";
      }
      return null;
    }
    case "RSI_ABOVE":
    case "RSI_BELOW": {
      if (!isInt(condition.period, MIN_PERIOD, MAX_PERIOD)) {
        return `RSI period must be a whole number between ${MIN_PERIOD} and ${MAX_PERIOD}.`;
      }
      if (!isNum(condition.threshold, 1, 99)) {
        return "RSI threshold must be between 1 and 99.";
      }
      return null;
    }
    case "MACD_CROSS_ABOVE":
    case "MACD_CROSS_BELOW": {
      if (
        !isInt(condition.fast, MIN_PERIOD, MAX_PERIOD) ||
        !isInt(condition.slow, MIN_PERIOD, MAX_PERIOD) ||
        !isInt(condition.signal, 2, 100)
      ) {
        return `MACD periods must be whole numbers (fast/slow ${MIN_PERIOD}–${MAX_PERIOD}, signal 2–100).`;
      }
      if ((condition.fast as number) >= (condition.slow as number)) {
        return "The MACD fast period must be shorter than the slow period.";
      }
      return null;
    }
    default:
      return "Unsupported condition type.";
  }
}

export function validateRuleSet(
  label: string,
  conditions: StrategyCondition[],
  options: { allowEmpty: boolean }
): string[] {
  const errors: string[] = [];
  if (conditions.length === 0) {
    if (!options.allowEmpty) errors.push(`${label}: add at least one condition.`);
    return errors;
  }
  if (conditions.length > MAX_CONDITIONS_PER_SIDE) {
    errors.push(`${label}: at most ${MAX_CONDITIONS_PER_SIDE} conditions are supported.`);
  }
  conditions.forEach((condition, index) => {
    const problem = validateCondition(condition);
    if (problem) errors.push(`${label}, condition ${index + 1}: ${problem}`);
  });
  return errors;
}

export function validateStrategyConfig(config: StrategyConfig): string[] {
  const errors: string[] = [];

  const instrumentProblem = validateInstrumentId(config.instrumentId);
  if (instrumentProblem) errors.push(instrumentProblem);

  if (!BACKTEST_INTERVALS.includes(config.interval)) {
    errors.push("Choose a supported candle interval.");
  }

  if (!Number.isFinite(config.fromMs) || !Number.isFinite(config.toMs)) {
    errors.push("Start and end dates are required.");
  } else if (config.fromMs >= config.toMs) {
    errors.push("The start date must be before the end date.");
  }

  if (!isNum(config.initialCapital, MIN_INITIAL_CAPITAL, MAX_INITIAL_CAPITAL)) {
    errors.push(
      `Initial capital must be between ₹${MIN_INITIAL_CAPITAL.toLocaleString("en-IN")} and ₹${MAX_INITIAL_CAPITAL.toLocaleString("en-IN")}.`
    );
  }

  if (!DATASET_MODES.includes(config.datasetMode)) {
    errors.push("Choose a dataset mode (auto, real only, or sample).");
  }

  if (config.sizing.kind === "FIXED_QUANTITY") {
    if (!isInt(config.sizing.quantity, 1, MAX_QUANTITY)) {
      errors.push("Fixed-quantity sizing needs a whole-share quantity of at least 1.");
    }
  } else if (config.sizing.kind === "PERCENT_OF_EQUITY") {
    if (!isNum(config.sizing.percentOfEquity, 1, 100)) {
      errors.push("Percent-of-equity sizing must be between 1% and 100%.");
    }
  } else {
    errors.push("Unsupported position-sizing method.");
  }

  if (!isNum(config.sizing.maxPositionValuePct, 1, 100)) {
    errors.push("Maximum position value must be between 1% and 100% of equity.");
  }

  errors.push(...validateRuleSet("Entry rules", config.entry.conditions, { allowEmpty: false }));

  const exitErrors = validateRuleSet("Exit rules", config.exit.conditions, { allowEmpty: true });
  errors.push(...exitErrors);

  if (config.stopLossPct !== null && !isNum(config.stopLossPct, 0.1, MAX_STOP_LOSS_PCT)) {
    errors.push(`Stop-loss must be between 0.1% and ${MAX_STOP_LOSS_PCT}%, or disabled.`);
  }
  if (config.takeProfitPct !== null && !isNum(config.takeProfitPct, 0.1, MAX_TAKE_PROFIT_PCT)) {
    errors.push(`Take-profit must be between 0.1% and ${MAX_TAKE_PROFIT_PCT}%, or disabled.`);
  }

  if (
    config.exit.conditions.length === 0 &&
    config.stopLossPct === null &&
    config.takeProfitPct === null
  ) {
    errors.push(
      "Add an exit condition, a stop-loss or a take-profit — otherwise a position could never be closed."
    );
  }

  if (
    !isNum(config.costs.brokerageFlat, 0, MAX_BROKERAGE_FLAT) ||
    !isNum(config.costs.brokeragePct, 0, MAX_BROKERAGE_PCT) ||
    !isNum(config.costs.slippageBps, 0, MAX_SLIPPAGE_BPS)
  ) {
    errors.push(
      `Costs must be within: flat brokerage ₹0–₹${MAX_BROKERAGE_FLAT}, percentage 0–${MAX_BROKERAGE_PCT}%, slippage 0–${MAX_SLIPPAGE_BPS} bps.`
    );
  }

  return errors;
}

export function validateStrategyDraft(draft: StrategyDraft): string[] {
  const errors: string[] = [];
  const name = draft.name.trim();
  if (name.length < 3 || name.length > 80) {
    errors.push("Strategy name must be 3–80 characters.");
  }
  if (draft.description.length > 500) {
    errors.push("Description must be 500 characters or fewer.");
  }
  errors.push(...validateStrategyConfig(draft.config));
  return errors;
}

/** Human-readable one-liner for a condition, used in saved-run snapshots. */
export function describeCondition(condition: StrategyCondition): string {
  switch (condition.type) {
    case "PRICE_ABOVE_MA":
      return `Close above ${condition.maKind}(${condition.period})`;
    case "PRICE_BELOW_MA":
      return `Close below ${condition.maKind}(${condition.period})`;
    case "PRICE_CROSS_ABOVE_MA":
      return `Close crosses above ${condition.maKind}(${condition.period})`;
    case "PRICE_CROSS_BELOW_MA":
      return `Close crosses below ${condition.maKind}(${condition.period})`;
    case "FAST_MA_ABOVE_SLOW_MA":
      return `${condition.maKind}(${condition.fast}) above ${condition.maKind}(${condition.slow})`;
    case "FAST_MA_BELOW_SLOW_MA":
      return `${condition.maKind}(${condition.fast}) below ${condition.maKind}(${condition.slow})`;
    case "RSI_ABOVE":
      return `RSI(${condition.period}) above ${condition.threshold}`;
    case "RSI_BELOW":
      return `RSI(${condition.period}) below ${condition.threshold}`;
    case "MACD_CROSS_ABOVE":
      return `MACD(${condition.fast},${condition.slow},${condition.signal}) crosses above signal`;
    case "MACD_CROSS_BELOW":
      return `MACD(${condition.fast},${condition.slow},${condition.signal}) crosses below signal`;
    default:
      return "Unknown condition";
  }
}
