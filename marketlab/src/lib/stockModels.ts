import type { DataMode, InstrumentRow, Quote } from "./marketClient";
import { demoQuote, demoSparkline, type DemoInstrument } from "./demoCatalogue";

/** Normalised shape the stock card and index card render. */
export interface StockCardModel {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string;
  instrumentType?: string;
  lastPrice: number | null;
  change: number | null;
  changePercent: number | null;
  /** Freshness label decided by the data source — never inferred from "request succeeded". */
  mode: DataMode;
  source: string;
  quoteTime: number | null;
  /** Closing prices for the mini chart; empty means "no series available". */
  sparkline: number[];
  /** True when the row itself comes from the seeded sample catalogue. */
  sampleCatalogue?: boolean;
}

/** Builds a card model from the deterministic demo dataset. */
export function modelFromDemo(
  instrument: DemoInstrument,
  nowMs: number,
  sparklinePoints = 24
): StockCardModel {
  const quote = demoQuote(instrument, nowMs);
  return {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    instrumentType: instrument.instrumentType,
    lastPrice: quote.lastPrice,
    change: quote.change,
    changePercent: quote.changePercent,
    mode: "SAMPLE",
    source: "sample",
    quoteTime: quote.quoteTime,
    sparkline: demoSparkline(instrument, nowMs, sparklinePoints),
    sampleCatalogue: true,
  };
}

/** Builds a card model from a server quote, keeping the server's freshness label. */
export function modelFromQuote(
  instrument: Pick<
    InstrumentRow,
    "instrumentId" | "symbol" | "name" | "exchange" | "instrumentType" | "isSampleData"
  > & { instrumentId: string },
  quote: Quote | null,
  sparkline: number[] = []
): StockCardModel {
  return {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    name: instrument.name,
    exchange: instrument.exchange,
    instrumentType: instrument.instrumentType,
    lastPrice: quote?.lastPrice ?? null,
    change: quote?.change ?? null,
    changePercent: quote?.changePercent ?? null,
    mode: quote?.mode ?? "SAMPLE",
    source: quote?.source ?? "none",
    quoteTime: quote?.quoteTime ?? null,
    sparkline: quote ? sparkline : [],
    sampleCatalogue: instrument.isSampleData,
  };
}

/** `NSE:RELIANCE:EQUITY` from a catalogue row, tolerating pre-built ids. */
export const instrumentIdOf = (row: {
  instrumentId?: string;
  exchange: string;
  symbol: string;
  instrumentType: string;
}): string => row.instrumentId ?? `${row.exchange}:${row.symbol}:${row.instrumentType}`;
