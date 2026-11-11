/**
 * Deterministic long-only backtesting engine.
 *
 * Execution policy (documented, conservative)
 * -------------------------------------------
 * 1. Signals are evaluated on a candle's **close**. The strategy cannot also
 *    trade that close, so orders are executed at the **next candle's open**.
 * 2. Protective exits are intrabar and evaluated on the candle after entry:
 *    stop-loss uses `min(open, stopLevel)` (a gap fills worse), take-profit uses
 *    the target level (never better than the target).
 * 3. If one candle spans both the stop and the target, the stop is assumed to
 *    fill first and the trade is flagged `ambiguousExit`. The favourable outcome
 *    is never chosen without evidence.
 * 4. If the data ends with a position open, it is valued at the last close and
 *    reported as open — no closing trade is fabricated.
 *
 * Look-ahead safety: indicators are computed once over the whole series with
 * causal implementations (`convex/market/indicators.ts`), a decision at index i
 * reads only series values at i and i-1, and execution can only use the open of
 * i+1. Appending future candles therefore cannot change earlier results.
 *
 * Costs: flat + percentage brokerage per side, plus slippage in basis points
 * applied against the trader. These are user assumptions, not Indian statutory
 * charges.
 */

import { sha256Hex } from "../market/hash";
import { ema, macd, rsi, sma, type Series } from "../market/indicators";
import {
  ENGINE_VERSION,
  MAX_BACKTEST_CANDLES,
  MAX_CURVE_POINTS,
  MAX_STORED_TRADES,
  MIN_BACKTEST_CANDLES,
  roundMoney,
  roundRatio,
} from "./config";
import { validateStrategyConfig } from "./validation";
import type {
  BacktestCandle,
  BacktestMetrics,
  BacktestOutput,
  BacktestTrade,
  DatasetInfo,
  EquityPoint,
  ExitReason,
  PricePoint,
  StrategyCondition,
  StrategyConfig,
} from "./types";

interface SeriesCache {
  ma: Map<string, Series>;
  rsi: Map<string, Series>;
  macd: Map<string, { macd: Series; signal: Series }>;
}

function maFor(closes: number[], kind: "SMA" | "EMA", period: number, cache: SeriesCache): Series {
  const key = `${kind}:${period}`;
  const existing = cache.ma.get(key);
  if (existing) return existing;
  const series = kind === "SMA" ? sma(closes, period) : ema(closes, period);
  cache.ma.set(key, series);
  return series;
}

function rsiFor(closes: number[], period: number, cache: SeriesCache): Series {
  const key = String(period);
  const existing = cache.rsi.get(key);
  if (existing) return existing;
  const series = rsi(closes, period);
  cache.rsi.set(key, series);
  return series;
}

function macdFor(
  closes: number[],
  fast: number,
  slow: number,
  signalPeriod: number,
  cache: SeriesCache
): { macd: Series; signal: Series } {
  const key = `${fast}:${slow}:${signalPeriod}`;
  const existing = cache.macd.get(key);
  if (existing) return existing;
  const result = macd(closes, fast, slow, signalPeriod);
  const value = { macd: result.macd, signal: result.signal };
  cache.macd.set(key, value);
  return value;
}

function defined(series: Series, index: number): number | null {
  const value = series[index];
  return value === undefined || value === null || !Number.isFinite(value) ? null : value;
}

/** Evaluates one condition at `index` using only that candle and earlier ones. */
export function evaluateCondition(
  condition: StrategyCondition,
  index: number,
  closes: number[],
  cache: SeriesCache
): boolean {
  const close = closes[index];
  if (!Number.isFinite(close)) return false;

  switch (condition.type) {
    case "PRICE_ABOVE_MA":
    case "PRICE_BELOW_MA":
    case "PRICE_CROSS_ABOVE_MA":
    case "PRICE_CROSS_BELOW_MA": {
      if (condition.maKind === null || condition.period === null) return false;
      const series = maFor(closes, condition.maKind, condition.period, cache);
      const current = defined(series, index);
      if (current === null) return false;
      if (condition.type === "PRICE_ABOVE_MA") return close > current;
      if (condition.type === "PRICE_BELOW_MA") return close < current;
      const previous = index > 0 ? defined(series, index - 1) : null;
      if (previous === null) return false;
      if (condition.type === "PRICE_CROSS_ABOVE_MA") {
        return closes[index - 1] <= previous && close > current;
      }
      return closes[index - 1] >= previous && close < current;
    }
    case "FAST_MA_ABOVE_SLOW_MA":
    case "FAST_MA_BELOW_SLOW_MA": {
      if (condition.maKind === null || condition.fast === null || condition.slow === null) {
        return false;
      }
      const fastSeries = maFor(closes, condition.maKind, condition.fast, cache);
      const slowSeries = maFor(closes, condition.maKind, condition.slow, cache);
      const fastValue = defined(fastSeries, index);
      const slowValue = defined(slowSeries, index);
      if (fastValue === null || slowValue === null) return false;
      return condition.type === "FAST_MA_ABOVE_SLOW_MA"
        ? fastValue > slowValue
        : fastValue < slowValue;
    }
    case "RSI_ABOVE":
    case "RSI_BELOW": {
      if (condition.period === null || condition.threshold === null) return false;
      const value = defined(rsiFor(closes, condition.period, cache), index);
      if (value === null) return false;
      return condition.type === "RSI_ABOVE"
        ? value > condition.threshold
        : value < condition.threshold;
    }
    case "MACD_CROSS_ABOVE":
    case "MACD_CROSS_BELOW": {
      if (
        condition.fast === null ||
        condition.slow === null ||
        condition.signal === null ||
        index < 1
      ) {
        return false;
      }
      const { macd: macdLine, signal } = macdFor(
        closes,
        condition.fast,
        condition.slow,
        condition.signal,
        cache
      );
      const currentMacd = defined(macdLine, index);
      const currentSignal = defined(signal, index);
      const previousMacd = defined(macdLine, index - 1);
      const previousSignal = defined(signal, index - 1);
      if (
        currentMacd === null ||
        currentSignal === null ||
        previousMacd === null ||
        previousSignal === null
      ) {
        return false;
      }
      return condition.type === "MACD_CROSS_ABOVE"
        ? previousMacd <= previousSignal && currentMacd > currentSignal
        : previousMacd >= previousSignal && currentMacd < currentSignal;
    }
    default:
      return false;
  }
}

/** AND requires every condition; OR requires one. An empty set is never true. */
export function evaluateRuleSet(
  conditions: StrategyCondition[],
  combinator: "AND" | "OR",
  index: number,
  closes: number[],
  cache: SeriesCache
): boolean {
  if (conditions.length === 0) return false;
  if (combinator === "AND") {
    return conditions.every((condition) => evaluateCondition(condition, index, closes, cache));
  }
  return conditions.some((condition) => evaluateCondition(condition, index, closes, cache));
}

/** Rejects candle series the engine cannot reason about safely. */
export function validateCandles(candles: BacktestCandle[]): void {
  if (candles.length > MAX_BACKTEST_CANDLES) {
    throw new Error(
      `The dataset has ${candles.length} candles; a single run is limited to ${MAX_BACKTEST_CANDLES}. Narrow the date range.`
    );
  }
  if (candles.length < MIN_BACKTEST_CANDLES) {
    throw new Error(
      `The dataset has only ${candles.length} candles; at least ${MIN_BACKTEST_CANDLES} are needed to warm up indicators.`
    );
  }
  let previousTs = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];
    if (!Number.isFinite(candle.ts) || candle.ts <= 0) {
      throw new Error(`Candle ${i + 1} has an invalid timestamp.`);
    }
    if (candle.ts === previousTs) {
      throw new Error(`Candle ${i + 1} duplicates the timestamp of the previous candle.`);
    }
    if (candle.ts < previousTs) {
      throw new Error("Candles must be sorted oldest to newest.");
    }
    previousTs = candle.ts;
    for (const [name, value] of [
      ["open", candle.open],
      ["high", candle.high],
      ["low", candle.low],
      ["close", candle.close],
    ] as const) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Candle ${i + 1} has an invalid ${name} price.`);
      }
    }
    if (candle.high < candle.low) throw new Error(`Candle ${i + 1} has high below low.`);
    if (candle.high < Math.max(candle.open, candle.close)) {
      throw new Error(`Candle ${i + 1} has a high below its open or close.`);
    }
    if (candle.low > Math.min(candle.open, candle.close)) {
      throw new Error(`Candle ${i + 1} has a low above its open or close.`);
    }
  }
  const span = candles[candles.length - 1].ts - candles[0].ts;
  if (span <= 0) throw new Error("Candles span no time at all.");
}

function countGaps(candles: BacktestCandle[], interval: StrategyConfig["interval"]): number {
  if (candles.length < 2) return 0;
  if (interval === "1w" || interval === "1M") return 0;
  const step: Record<string, number> = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "1d": 24 * 60 * 60_000,
  };
  const unit = step[interval];
  if (!unit) return 0;
  let gaps = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const missing = Math.round((candles[i].ts - candles[i - 1].ts) / unit) - 1;
    if (missing > 0) gaps += missing;
  }
  return gaps;
}

function sampleCurve<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const sampled = points.filter((_, index) => index % step === 0);
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

function compactCandles(candles: BacktestCandle[]): unknown[] {
  return candles.map((candle) => [
    candle.ts,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.volume,
  ]);
}

interface OpenPosition {
  quantity: number;
  entryPrice: number;
  entryIndex: number;
  entryTs: number;
  entryCosts: number;
  entryValue: number;
}

export interface RunBacktestInput {
  candles: BacktestCandle[];
  config: StrategyConfig;
  dataset: DatasetInfo;
}

export function runBacktest({ candles, config, dataset }: RunBacktestInput): BacktestOutput {
  const configErrors = validateStrategyConfig(config);
  if (configErrors.length > 0) {
    throw new Error(`Invalid strategy: ${configErrors.join(" ")}`);
  }
  validateCandles(candles);

  const closes = candles.map((candle) => candle.close);
  const cache: SeriesCache = { ma: new Map(), rsi: new Map(), macd: new Map() };
  const slippage = config.costs.slippageBps / 10_000;
  const warnings: string[] = [];
  const trades: BacktestTrade[] = [];

  let cash = roundMoney(config.initialCapital);
  let position: OpenPosition | null = null;
  let pending: "ENTER" | "EXIT" | null = null;
  let signalsEvaluated = 0;
  let skippedEntries = 0;
  let ambiguousExits = 0;
  let totalBrokerage = 0;
  let totalSlippage = 0;
  let candlesHeld = 0;
  let openPositionAtEnd = false;

  const equityCurve: EquityPoint[] = [];
  const priceCurve: PricePoint[] = [];

  const gaps = countGaps(candles, config.interval);
  if (gaps > 0) {
    warnings.push(
      `${gaps} missing ${config.interval} bucket(s) were not filled — the engine only trades candles that exist.`
    );
  }

  const brokerageFor = (turnover: number) =>
    roundMoney(config.costs.brokerageFlat + (turnover * config.costs.brokeragePct) / 100);

  const closePosition = (index: number, basePrice: number, reason: ExitReason, ambiguous: boolean) => {
    if (!position) return;
    const candle = candles[index];
    const rawPrice = reason === "take_profit" ? basePrice : basePrice;
    const price = roundMoney(Math.max(0.01, rawPrice * (1 - slippage)));
    const proceeds = roundMoney(price * position.quantity);
    const brokerage = brokerageFor(proceeds);
    totalBrokerage = roundMoney(totalBrokerage + brokerage);
    totalSlippage = roundMoney(
      totalSlippage + Math.abs(basePrice - price) * position.quantity
    );
    cash = roundMoney(cash + proceeds - brokerage);
    const costs = roundMoney(position.entryCosts + brokerage);
    const grossPnl = roundMoney((price - position.entryPrice) * position.quantity);
    const netPnl = roundMoney(grossPnl - costs);
    trades.push({
      entryIndex: position.entryIndex,
      exitIndex: index,
      entryTs: position.entryTs,
      exitTs: candle.ts,
      entryPrice: position.entryPrice,
      exitPrice: price,
      quantity: position.quantity,
      grossPnl,
      costs,
      netPnl,
      returnPct: position.entryValue > 0 ? roundMoney((netPnl / position.entryValue) * 100) : 0,
      exitReason: reason,
      ambiguousExit: ambiguous,
    });
    if (ambiguous) ambiguousExits += 1;
    position = null;
    pending = null;
  };

  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i];

    // 1. Execute the order signalled by the previous candle at this open.
    if (pending === "ENTER" && position === null) {
      const slippagePrice = roundMoney(Math.max(0.01, candle.open * (1 + slippage)));
      const equityBefore = cash;
      const capValue = (equityBefore * config.sizing.maxPositionValuePct) / 100;

      let desired: number;
      if (config.sizing.kind === "FIXED_QUANTITY") {
        desired = config.sizing.quantity ?? 0;
      } else {
        const budget = (equityBefore * (config.sizing.percentOfEquity ?? 0)) / 100;
        desired = Math.floor(Math.min(budget, capValue) / slippagePrice);
      }
      if (config.sizing.kind === "FIXED_QUANTITY") {
        desired = Math.min(desired, Math.floor(capValue / slippagePrice));
      }
      // Never spend cash the account does not have (brokerage included).
      const perShareCost = slippagePrice * (1 + config.costs.brokeragePct / 100);
      const affordable = Math.floor(
        Math.max(0, (cash - config.costs.brokerageFlat) / Math.max(perShareCost, 0.01))
      );
      const quantity = Math.max(0, Math.min(desired, affordable));

      if (quantity <= 0) {
        skippedEntries += 1;
      } else {
        const turnover = roundMoney(slippagePrice * quantity);
        const brokerage = brokerageFor(turnover);
        totalBrokerage = roundMoney(totalBrokerage + brokerage);
        totalSlippage = roundMoney(
          totalSlippage + Math.abs(slippagePrice - candle.open) * quantity
        );
        cash = roundMoney(cash - turnover - brokerage);
        position = {
          quantity,
          entryPrice: slippagePrice,
          entryIndex: i,
          entryTs: candle.ts,
          entryCosts: brokerage,
          entryValue: turnover,
        };
      }
      pending = null;
    } else if (pending === "EXIT" && position !== null) {
      closePosition(i, candle.open, "exit_signal", false);
    } else {
      pending = null;
    }

    // 2. Protective exits on the same candle (after an open execution).
    if (position !== null) {
      const slLevel =
        config.stopLossPct === null
          ? null
          : position.entryPrice * (1 - config.stopLossPct / 100);
      const tpLevel =
        config.takeProfitPct === null
          ? null
          : position.entryPrice * (1 + config.takeProfitPct / 100);
      const hitStop = slLevel !== null && candle.low <= slLevel;
      const hitTarget = tpLevel !== null && candle.high >= tpLevel;

      if (hitStop) {
        // Both levels inside one candle: assume the stop filled first.
        const base = Math.min(candle.open, slLevel as number);
        closePosition(i, base, "stop_loss", hitTarget);
      } else if (hitTarget) {
        closePosition(i, tpLevel as number, "take_profit", false);
      }
    }

    // 3. Mark to market at the close.
    const equity = roundMoney(cash + (position ? position.quantity * candle.close : 0));
    if (position) candlesHeld += 1;
    equityCurve.push({ ts: candle.ts, equity, drawdownPct: 0 });
    priceCurve.push({ ts: candle.ts, close: candle.close });

    // 4. Evaluate this candle's close to schedule the next order.
    signalsEvaluated += 1;
    if (position !== null) {
      const wantsExit = evaluateRuleSet(
        config.exit.conditions,
        config.exit.combinator,
        i,
        closes,
        cache
      );
      if (wantsExit) pending = "EXIT";
    } else {
      const wantsEntry = evaluateRuleSet(
        config.entry.conditions,
        config.entry.combinator,
        i,
        closes,
        cache
      );
      if (wantsEntry) pending = "ENTER";
    }
  }

  if (position !== null) {
    openPositionAtEnd = true;
    warnings.push(
      "The data ended with the position still open; it is valued at the last close and no closing trade was invented."
    );
  }
  if (skippedEntries > 0) {
    warnings.push(
      `${skippedEntries} entry signal(s) were not executed because available cash could not fund one share after costs.`
    );
  }
  if (ambiguousExits > 0) {
    warnings.push(
      `${ambiguousExits} trade(s) had the stop-loss and take-profit both inside one candle; the stop-loss was assumed to fill first.`
    );
  }
  if (dataset.mode === "SAMPLE") {
    warnings.push(
      "Dataset is the deterministic SAMPLE series — not Indian market history. Results describe simulated candles only."
    );
  }

  // Drawdown on the full curve, then downsample for storage/display.
  let peak = equityCurve[0]?.equity ?? config.initialCapital;
  let maxDrawdownPct = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    const drawdown = peak > 0 ? ((point.equity - peak) / peak) * 100 : 0;
    point.drawdownPct = roundMoney(drawdown);
    maxDrawdownPct = Math.min(maxDrawdownPct, point.drawdownPct);
  }

  const finalEquity = equityCurve[equityCurve.length - 1]?.equity ?? roundMoney(config.initialCapital);
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossWin = roundMoney(wins.reduce((sum, trade) => sum + trade.netPnl, 0));
  const grossLoss = roundMoney(losses.reduce((sum, trade) => sum + trade.netPnl, 0));

  const metrics: BacktestMetrics = {
    initialCapital: roundMoney(config.initialCapital),
    finalEquity,
    netPnl: roundMoney(finalEquity - config.initialCapital),
    returnPct:
      config.initialCapital > 0
        ? roundMoney(((finalEquity - config.initialCapital) / config.initialCapital) * 100)
        : 0,
    maxDrawdownPct: roundMoney(maxDrawdownPct),
    tradeCount: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRatePct: trades.length > 0 ? roundMoney((wins.length / trades.length) * 100) : null,
    averageWin: wins.length > 0 ? roundMoney(grossWin / wins.length) : null,
    averageLoss: losses.length > 0 ? roundMoney(grossLoss / losses.length) : null,
    profitFactor: losses.length > 0 && grossLoss !== 0 ? roundRatio(grossWin / Math.abs(grossLoss), 2) : null,
    exposurePct: candles.length > 0 ? roundMoney((candlesHeld / candles.length) * 100) : 0,
    totalBrokerage: roundMoney(totalBrokerage),
    totalSlippage: roundMoney(totalSlippage),
    totalCosts: roundMoney(totalBrokerage + totalSlippage),
  };

  const inputHash = sha256Hex(
    JSON.stringify({
      engine: ENGINE_VERSION,
      config: { ...config, instrumentId: config.instrumentId },
      dataset: { hash: dataset.hash, mode: dataset.mode, source: dataset.source },
      candles: compactCandles(candles),
    })
  );

  return {
    metrics,
    trades: trades.slice(0, MAX_STORED_TRADES).map((trade) => ({ ...trade })),
    equityCurve: sampleCurve(equityCurve, MAX_CURVE_POINTS),
    priceCurve: sampleCurve(priceCurve, MAX_CURVE_POINTS),
    warnings,
    candlesUsed: candles.length,
    signalsEvaluated,
    openPositionAtEnd,
    inputHash,
    engineVersion: ENGINE_VERSION,
  };
}
