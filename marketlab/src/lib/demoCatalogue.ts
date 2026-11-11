/**
 * Deterministic demo catalogue used when the Convex backend is unavailable.
 *
 * Values come from the same tested sample generator the backend uses
 * (`convex/market/sample.ts`), so prices are reproducible and every value is
 * labelled SAMPLE. Nothing here is market data, and nothing here is ever merged
 * with provider quotes: the dashboard either runs on provider/server quotes or
 * on this set, never a mixture.
 */

import { sampleCandles, sampleQuote } from "@quant/sample";
import type { NormalizedCandle, NormalizedQuote } from "@quant/types";
import type { Exchange, InstrumentType, Interval } from "./marketClient";

export interface DemoInstrument {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: Exchange;
  instrumentType: InstrumentType;
  sector: string;
}

const ID_SEPARATOR = ":";

/** Canonical internal id: `EXCHANGE:SYMBOL:TYPE`. */
export const instrumentIdFor = (
  exchange: Exchange,
  symbol: string,
  instrumentType: InstrumentType
): string => [exchange, symbol, instrumentType].join(ID_SEPARATOR);

const ID_PATTERN = /^(NSE|BSE):[A-Z0-9&.\- ]{1,32}:(EQUITY|ETF|INDEX|OTHER)$/;

export interface ParsedInstrumentId {
  exchange: Exchange;
  symbol: string;
  instrumentType: InstrumentType;
}

/** Rejects anything that is not a well-formed instrument id. */
export function parseInstrumentId(id: string): ParsedInstrumentId | null {
  if (typeof id !== "string" || id.length > 96 || !ID_PATTERN.test(id)) return null;
  const [exchange, symbol, instrumentType] = id.split(ID_SEPARATOR);
  return {
    exchange: exchange as Exchange,
    symbol,
    instrumentType: instrumentType as InstrumentType,
  };
}

export const isWellFormedInstrumentId = (id: string): boolean => parseInstrumentId(id) !== null;

const equity = (
  symbol: string,
  name: string,
  sector: string,
  exchange: Exchange = "NSE"
): DemoInstrument => ({
  instrumentId: instrumentIdFor(exchange, symbol, "EQUITY"),
  symbol,
  name,
  exchange,
  instrumentType: "EQUITY",
  sector,
});

const index = (exchange: Exchange, symbol: string, name: string): DemoInstrument => ({
  instrumentId: instrumentIdFor(exchange, symbol, "INDEX"),
  symbol,
  name,
  exchange,
  instrumentType: "INDEX",
  sector: "Index",
});

/**
 * Mirrors the 15 seeded catalogue instruments (Phase 1) so ids stay stable
 * between demo mode and a connected backend, plus BANK NIFTY for the index row.
 */
export const DEMO_INSTRUMENTS: DemoInstrument[] = [
  equity("RELIANCE", "Reliance Industries", "Oil & Gas"),
  equity("TCS", "Tata Consultancy Services", "Information Technology"),
  equity("HDFCBANK", "HDFC Bank", "Financials"),
  equity("INFY", "Infosys", "Information Technology"),
  equity("SBIN", "State Bank of India", "Financials"),
  equity("TATAMOTORS", "Tata Motors", "Automobiles"),
  equity("ITC", "ITC", "Consumer Goods"),
  equity("ICICIBANK", "ICICI Bank", "Financials"),
  equity("BHARTIARTL", "Bharti Airtel", "Telecom"),
  equity("LT", "Larsen & Toubro", "Infrastructure"),
  {
    instrumentId: instrumentIdFor("NSE", "NIFTYBEES", "ETF"),
    symbol: "NIFTYBEES",
    name: "Nifty 50 ETF",
    exchange: "NSE",
    instrumentType: "ETF",
    sector: "Index Fund",
  },
  equity("RELIANCE", "Reliance Industries", "Oil & Gas", "BSE"),
  equity("TCS", "Tata Consultancy Services", "Information Technology", "BSE"),
  index("NSE", "NIFTY 50", "Nifty 50 Index"),
  index("NSE", "BANKNIFTY", "Nifty Bank Index"),
  index("BSE", "SENSEX", "BSE Sensex Index"),
];

export const DEMO_INDICES = DEMO_INSTRUMENTS.filter(
  (instrument) => instrument.instrumentType === "INDEX"
);

/** Top stocks shown on the dashboard: the ten seeded NSE equities. */
export const DEMO_TOP_STOCKS = DEMO_INSTRUMENTS.filter(
  (instrument) => instrument.instrumentType === "EQUITY" && instrument.exchange === "NSE"
);

export function demoInstrumentById(id: string): DemoInstrument | null {
  return DEMO_INSTRUMENTS.find((instrument) => instrument.instrumentId === id) ?? null;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Quantised "now" so a page re-render cannot change a sample value.
 * Sample output is stable inside each 6-hour bucket.
 */
export const sampleBucket = (nowMs: number): number => Math.floor(nowMs / SIX_HOURS_MS);

const quoteCache = new Map<string, NormalizedQuote>();
const candleCache = new Map<string, NormalizedCandle[]>();

/** Deterministic SAMPLE quote for an instrument. */
export function demoQuote(instrument: DemoInstrument, nowMs: number): NormalizedQuote {
  const key = `${instrument.instrumentId}|${sampleBucket(nowMs)}`;
  const cached = quoteCache.get(key);
  if (cached) return cached;

  const quote = sampleQuote(
    {
      instrumentId: instrument.instrumentId,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      name: instrument.name,
    },
    nowMs
  );
  quoteCache.set(key, quote);
  return quote;
}

/** Range used for a given interval so charts have enough warm-up bars. */
export function rangeForInterval(interval: Interval, nowMs: number): { fromMs: number; toMs: number } {
  const intraday = interval === "1m" || interval === "5m" || interval === "15m" || interval === "1h";
  return {
    fromMs: intraday ? nowMs - 6 * DAY_MS : nowMs - 730 * DAY_MS,
    toMs: nowMs,
  };
}

/** Deterministic SAMPLE candles for an instrument and interval. */
export function demoCandles(
  instrument: DemoInstrument,
  interval: Interval,
  nowMs: number
): NormalizedCandle[] {
  const bucket = sampleBucket(nowMs);
  const key = `${instrument.instrumentId}|${interval}|${bucket}`;
  const cached = candleCache.get(key);
  if (cached) return cached;

  const { fromMs, toMs } = rangeForInterval(interval, nowMs);
  const candles = sampleCandles({
    symbol: instrument.symbol,
    interval,
    fromMs,
    toMs,
  }).map((candle) => ({ ...candle, instrumentId: instrument.instrumentId }));

  candleCache.set(key, candles);
  return candles;
}

/** Last N daily closes — used for card sparklines. */
export function demoSparkline(
  instrument: DemoInstrument,
  nowMs: number,
  points = 24
): number[] {
  const candles = demoCandles(instrument, "1d", nowMs);
  return candles.slice(-points).map((candle) => candle.close);
}
