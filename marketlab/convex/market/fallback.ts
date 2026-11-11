/**
 * The single place that decides what a candle request shows when no genuine
 * provider data is available.
 *
 * Everything produced here is labelled `SAMPLE` and names its reason. There is
 * deliberately no code path that relabels sample candles as `HISTORICAL` or a
 * provider source, so a failed provider request can never be presented as real
 * market history.
 */

import { findGaps } from "./normalize";
import { sampleCandles, sampleQuote } from "./sample";
import type { DataMode, Interval, NormalizedCandle, NormalizedInstrument } from "./types";

export interface SampleCandleResult {
  instrumentId: string;
  symbol: string;
  interval: Interval;
  candles: NormalizedCandle[];
  mode: "SAMPLE";
  source: "sample";
  adjusted: NormalizedCandle["adjusted"];
  fetchedAt: number;
  note: string | null;
  warning: string | null;
  quality: {
    rowCount: number;
    gaps: number;
    gapSamples: number[];
    firstTs: number | null;
    lastTs: number | null;
    fromCache: boolean;
  };
}

/** Builds a deterministic SAMPLE candle series with an explicit quality report. */
export function sampleCandleFallback(input: {
  instrument: Pick<NormalizedInstrument, "instrumentId" | "symbol">;
  interval: Interval;
  fromMs: number;
  toMs: number;
  nowMs: number;
  maxCandles: number;
}): SampleCandleResult {
  const candles: NormalizedCandle[] = sampleCandles({
    symbol: input.instrument.symbol,
    interval: input.interval,
    fromMs: input.fromMs,
    toMs: input.toMs,
  })
    .slice(-input.maxCandles)
    .map((candle) => ({
      ...candle,
      instrumentId: input.instrument.instrumentId,
      source: "sample" as const,
      mode: "SAMPLE" as const,
    }));

  const gaps = findGaps(candles, input.interval);
  return {
    instrumentId: input.instrument.instrumentId,
    symbol: input.instrument.symbol,
    interval: input.interval,
    candles,
    mode: "SAMPLE",
    source: "sample",
    adjusted: "unknown",
    fetchedAt: input.nowMs,
    note: null,
    warning: null,
    quality: {
      rowCount: candles.length,
      gaps: gaps.count,
      gapSamples: gaps.firstFew,
      firstTs: candles[0]?.ts ?? null,
      lastTs: candles[candles.length - 1]?.ts ?? null,
      fromCache: false,
    },
  };
}

/**
 * Warning shown when a configured provider failed or returned nothing. The
 * redacted provider message is preserved so the user knows why the chart is
 * synthetic instead of guessing.
 */
export function providerFallbackWarning(providerLabel: string, message: string): string {
  const detail = message.trim() || "no response";
  return `${providerLabel} did not return candles (${detail}). Showing labelled sample data — this is not market history.`;
}

/** The price fields the screener filters on, whatever their source. */
export interface ScreenerQuote {
  lastPrice: number;
  changePercent: number | null;
  volume: number | null;
  mode: DataMode;
  source: string;
  fetchedAt: number;
}

/**
 * Deterministic demo price for an instrument with no stored quote. Always
 * labelled SAMPLE, so a screen can never imply a real market reading it did not
 * have.
 */
export function sampleScreenerQuote(
  instrument: { instrumentId: string; symbol: string; exchange: "NSE" | "BSE"; name: string },
  nowMs: number
): ScreenerQuote {
  const sample = sampleQuote(instrument, nowMs);
  return {
    lastPrice: sample.lastPrice,
    changePercent: sample.changePercent,
    volume: sample.volume,
    mode: "SAMPLE",
    source: "sample",
    fetchedAt: nowMs,
  };
}

/** Note shown when sample candles are served without any provider being tried. */
export function noProviderNote(input: {
  signedIn: boolean;
  providerLabel: string | null;
  interval: Interval;
}): string {
  if (!input.signedIn) {
    return "Sign in and configure a provider to load real candles — this series is sample data.";
  }
  if (input.providerLabel) {
    return `${input.providerLabel} returned no candles for this range — showing sample data.`;
  }
  return `No configured provider serves ${input.interval} candles — showing sample data.`;
}
