/**
 * Technical indicators.
 *
 * Every function returns a series aligned with the input (same length) using
 * `null` for warm-up periods, so a plotted indicator can never read a future
 * observation: value at index i only depends on inputs at indices <= i.
 */

import { istDateString } from "./time";

export type Series = (number | null)[];

function ensureFinite(values: number[]): void {
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("Indicator input must be finite numbers");
    }
  }
}

export function sma(values: number[], period: number): Series {
  if (period <= 0) throw new Error("Period must be positive");
  ensureFinite(values);
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential moving average seeded with the SMA of the first `period` values.
 * Values before the seed are `null`.
 */
export function ema(values: number[], period: number): Series {
  if (period <= 0) throw new Error("Period must be positive");
  ensureFinite(values);
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const multiplier = 2 / (period + 1);
  let previous = 0;
  for (let i = 0; i < period; i += 1) previous += values[i];
  previous /= period;
  out[period - 1] = previous;
  for (let i = period; i < values.length; i += 1) {
    previous = (values[i] - previous) * multiplier + previous;
    out[i] = previous;
  }
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): Series {
  if (period <= 0) throw new Error("Period must be positive");
  ensureFinite(values);
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  ensureFinite(values);
  if (fast >= slow) throw new Error("MACD fast period must be shorter than slow period");
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine: Series = values.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || s === null ? null : f - s;
  });

  // The signal line is an EMA of the defined MACD values only.
  const firstDefined = macdLine.findIndex((value) => value !== null);
  const signal: Series = new Array(values.length).fill(null);
  if (firstDefined === -1) {
    return {
      macd: macdLine,
      signal,
      histogram: new Array(values.length).fill(null),
    };
  }
  const compact = macdLine.slice(firstDefined).map((value) => value as number);
  const compactSignal = ema(compact, signalPeriod);
  for (let i = 0; i < compactSignal.length; i += 1) {
    signal[firstDefined + i] = compactSignal[i];
  }
  const histogram: Series = values.map((_, i) =>
    macdLine[i] === null || signal[i] === null
      ? null
      : (macdLine[i] as number) - (signal[i] as number)
  );
  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bollinger(values: number[], period = 20, multiplier = 2): BollingerResult {
  ensureFinite(values);
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    const mean = middle[i];
    if (mean === null) continue;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) {
      variance += (values[j] - mean) ** 2;
    }
    const deviation = Math.sqrt(variance / period);
    upper[i] = mean + multiplier * deviation;
    lower[i] = mean - multiplier * deviation;
  }
  return { upper, middle, lower };
}

export interface VwapCandle {
  ts: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/**
 * Volume weighted average price. The cumulative sums reset at each IST trading
 * date when `resetPerSession` is true, which matches how VWAP is quoted for
 * Indian equities. Candles without volume are skipped and reported as `null`.
 */
export function vwap(candles: VwapCandle[], resetPerSession = true): Series {
  const out: Series = [];
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  let currentSession: string | null = null;

  for (const candle of candles) {
    const session = resetPerSession ? istDateString(candle.ts) : "all";
    if (session !== currentSession) {
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
      currentSession = session;
    }
    if (!candle.volume || candle.volume <= 0) {
      out.push(null);
      continue;
    }
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
    out.push(cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null);
  }
  return out;
}

export function latestDefined(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i] !== null) return series[i] as number;
  }
  return null;
}

export function pctChange(from: number | null, to: number | null): number | null {
  if (from === null || to === null || from === 0) return null;
  return ((to - from) / from) * 100;
}
