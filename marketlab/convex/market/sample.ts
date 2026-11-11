/**
 * Deterministic sample market data for offline development.
 *
 * Everything produced here is labelled `SAMPLE`. It is a mathematical series,
 * not exchange data, and it is never blended with provider data or labelled
 * live. The same symbol and timestamp always produce the same value so charts
 * and tests are reproducible.
 */

import type { Interval, NormalizedCandle, NormalizedQuote } from "./types";
import { INTERVAL_MS } from "./types";
import { SESSION, istDateString, istDateToUtcMs, toIstParts } from "./time";

/** Reference date used as day 0 of the sample price series. */
const ANCHOR_DATE = "2018-01-01";
const ANCHOR_MS = istDateToUtcMs(ANCHOR_DATE);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Known base prices so the sample catalogue reads plausibly. */
const BASE_PRICES: Record<string, number> = {
  RELIANCE: 2845,
  TCS: 3892,
  HDFCBANK: 1624,
  INFY: 1580,
  SBIN: 812,
  TATAMOTORS: 940,
  ITC: 438,
  ICICIBANK: 1180,
  BHARTIARTL: 1495,
  LT: 3620,
  NIFTYBEES: 268,
  "NIFTY 50": 24500,
  BANKNIFTY: 52400,
  SENSEX: 80250,
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function basePrice(symbol: string): number {
  return BASE_PRICES[symbol] ?? 100 + (hashString(symbol) % 3000);
}

function isWeekend(date: string): boolean {
  const parts = toIstParts(istDateToUtcMs(date));
  return parts.weekday === 0 || parts.weekday === 6;
}

function dayIndex(date: string): number {
  return Math.round((istDateToUtcMs(date) - ANCHOR_MS) / DAY_MS);
}

/** Smooth, deterministic pseudo-series value in roughly ±25%. */
function levelAt(symbol: string, index: number): number {
  const phase = (hashString(symbol) % 1000) / 1000;
  const wave =
    0.18 * Math.sin(index / 23 + phase * 6.28) +
    0.09 * Math.sin(index / 7.3 + phase * 2.1) +
    0.04 * Math.sin(index / 2.7 + phase * 11.3);
  const drift = 0.00018 * index;
  return basePrice(symbol) * (1 + wave + drift);
}

/** Deterministic noise in [-1, 1) for a symbol/day/minute triple. */
function noise(symbol: string, a: number, b: number): number {
  const x = Math.sin(hashString(symbol) * 0.0001 + a * 12.9898 + b * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

interface DailyBar {
  date: string;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function dailyBar(symbol: string, date: string): DailyBar {
  const index = dayIndex(date);
  const close = levelAt(symbol, index);
  const previousClose = levelAt(symbol, index - 1);
  const open = previousClose + (close - previousClose) * 0.35 + noise(symbol, index, 1) * close * 0.002;
  const spread = Math.abs(close - open) + close * (0.004 + Math.abs(noise(symbol, index, 2)) * 0.012);
  const high = Math.max(open, close) + spread * (0.3 + Math.abs(noise(symbol, index, 3)) * 0.5);
  const low = Math.min(open, close) - spread * (0.3 + Math.abs(noise(symbol, index, 4)) * 0.5);
  const volume = Math.round(
    (500_000 + Math.abs(noise(symbol, index, 5)) * 4_000_000) * (close > 5000 ? 0.3 : 1)
  );
  return {
    date,
    ts: istDateToUtcMs(date),
    open: round2(open),
    high: round2(high),
    low: round2(Math.max(low, 1)),
    close: round2(close),
    volume,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function tradingDaysBetween(fromMs: number, toMs: number): string[] {
  const days: string[] = [];
  const start = Math.max(istDateToUtcMs(ANCHOR_DATE), fromMs - DAY_MS);
  for (let cursor = start; cursor <= toMs; cursor += DAY_MS) {
    const date = istDateString(cursor);
    if (!isWeekend(date)) days.push(date);
  }
  return days;
}

function intradayCandles(
  symbol: string,
  interval: Interval,
  fromMs: number,
  toMs: number
): NormalizedCandle[] {
  const stepMinutes =
    interval === "1m" ? 1 : interval === "5m" ? 5 : interval === "15m" ? 15 : 60;
  const stepMs = stepMinutes * 60_000;
  const candles: NormalizedCandle[] = [];

  for (const date of tradingDaysBetween(fromMs, toMs)) {
    const bar = dailyBar(symbol, date);
    const sessionStart = bar.ts + SESSION.open * 60_000;
    const sessionEnd = bar.ts + SESSION.close * 60_000;
    const totalBuckets = Math.floor((sessionEnd - sessionStart) / stepMs);
    let previousClose = bar.open;

    for (let bucket = 0; bucket < totalBuckets; bucket += 1) {
      const ts = sessionStart + bucket * stepMs;
      if (ts < fromMs || ts > toMs) continue;
      const progress = totalBuckets === 1 ? 1 : bucket / (totalBuckets - 1);
      const trend = bar.open + (bar.close - bar.open) * progress;
      const jitter = noise(symbol, dayIndex(date), bucket + 1000) * bar.close * 0.0015;
      const close = round2(Math.max(1, trend + jitter));
      const open = round2(previousClose);
      const wick = bar.close * 0.0012;
      const high = round2(Math.max(open, close) + Math.abs(noise(symbol, bucket, 7)) * wick);
      const low = round2(Math.max(1, Math.min(open, close) - Math.abs(noise(symbol, bucket, 8)) * wick));
      const volume = Math.round(bar.volume / totalBuckets * (0.4 + Math.abs(noise(symbol, bucket, 9))));
      previousClose = close;
      candles.push({
        instrumentId: "",
        interval,
        ts,
        open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close,
        volume,
        source: "sample",
        mode: "SAMPLE",
        adjusted: "unknown",
      });
    }
  }
  return candles;
}

export interface SampleCandleRequest {
  symbol: string;
  interval: Interval;
  fromMs: number;
  toMs: number;
}

/**
 * Sample OHLCV series for a symbol. Daily and coarser intervals use one bar per
 * trading day; intraday intervals are generated inside 09:15–15:30 IST buckets.
 */
export function sampleCandles({ symbol, interval, fromMs, toMs }: SampleCandleRequest): NormalizedCandle[] {
  if (interval === "1m" || interval === "5m" || interval === "15m" || interval === "1h") {
    return intradayCandles(symbol, interval, fromMs, toMs);
  }

  const step = interval === "1w" ? 7 : interval === "1M" ? 30 : 1;
  const days = tradingDaysBetween(fromMs, toMs);
  const selected = step === 1 ? days : days.filter((_, index) => index % step === 0);
  return selected.map((date) => {
    const bar = dailyBar(symbol, date);
    return {
      instrumentId: "",
      interval,
      ts: bar.ts,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      source: "sample" as const,
      mode: "SAMPLE" as const,
      adjusted: "unknown" as const,
    };
  });
}

/** Last completed sample bar, used to derive a sample quote. */
export function lastSampleBar(symbol: string, nowMs: number): DailyBar {
  const days = tradingDaysBetween(nowMs - 10 * DAY_MS, nowMs).filter(
    (date) => istDateToUtcMs(date) + SESSION.close * 60_000 <= nowMs
  );
  const date = days.length > 0 ? days[days.length - 1] : istDateString(nowMs - DAY_MS);
  return dailyBar(symbol, date);
}

export function sampleQuote(
  instrument: { instrumentId: string; symbol: string; exchange: "NSE" | "BSE"; name: string },
  nowMs: number
): NormalizedQuote {
  const bar = lastSampleBar(instrument.symbol, nowMs);
  const previous = dailyBar(instrument.symbol, istDateString(bar.ts - DAY_MS));
  const change = round2(bar.close - previous.close);
  return {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    lastPrice: bar.close,
    change,
    changePercent: round2((change / previous.close) * 100),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    previousClose: previous.close,
    volume: bar.volume,
    bid: round2(bar.close - 0.05),
    ask: round2(bar.close + 0.05),
    quoteTime: bar.ts + SESSION.close * 60_000,
    source: "sample",
    mode: "SAMPLE",
  };
}

/** Converts sample bars to the interval step for charting helpers. */
export function sampleIntervalStep(interval: Interval): number {
  return INTERVAL_MS[interval];
}
