/**
 * Shared, provider-neutral market-data types.
 *
 * This module is pure TypeScript (no Convex or Node imports) so it can be used
 * by the Convex backend, the React frontend and unit tests alike.
 */

export type ProviderId = "fyers" | "breeze" | "tapetide" | "tejhq" | "nsemcp";

export type Exchange = "NSE" | "BSE";

export type InstrumentType = "EQUITY" | "ETF" | "INDEX" | "OTHER";

/**
 * How fresh a value is, from the user's point of view.
 * Every number surfaced in the UI carries one of these labels.
 */
export type DataMode = "LIVE" | "DELAYED" | "CACHED" | "HISTORICAL" | "SAMPLE";

export const DATA_MODES: DataMode[] = [
  "LIVE",
  "DELAYED",
  "CACHED",
  "HISTORICAL",
  "SAMPLE",
];

export type Interval = "1m" | "5m" | "15m" | "1h" | "1d" | "1w" | "1M";

export const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "1d", "1w", "1M"];

export const INTERVAL_LABEL: Record<Interval, string> = {
  "1m": "1 min",
  "5m": "5 min",
  "15m": "15 min",
  "1h": "1 hour",
  "1d": "1 day",
  "1w": "1 week",
  "1M": "1 month",
};

export const INTERVAL_MS: Record<Interval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
  "1M": 30 * 24 * 60 * 60_000,
};

export type CapabilityName =
  | "instruments"
  | "instrumentSync"
  | "quotes"
  | "candles"
  | "streaming"
  | "fundamentals"
  | "marketStatus";

export const CAPABILITY_NAMES: CapabilityName[] = [
  "instruments",
  "instrumentSync",
  "quotes",
  "candles",
  "streaming",
  "fundamentals",
  "marketStatus",
];

export interface CapabilityDescriptor {
  supported: boolean;
  /** Intervals this provider can actually serve, when capability is `candles`. */
  intervals?: Interval[];
  /** Short, factual note shown in the provider status page. */
  note?: string;
}

export type ProviderCapabilities = Record<CapabilityName, CapabilityDescriptor>;

export interface ProviderEnv {
  [key: string]: string | undefined;
}

/** Authentication model required by a provider. */
export type AuthMode =
  /** App-level credentials held only on the server. */
  | "server_app_token"
  /** Requires an interactive per-user broker login; app key alone is not enough. */
  | "per_user_session"
  /** A single personal API token. */
  | "api_token"
  /** No credentials at all (keyless public endpoints). */
  | "none";

export interface NormalizedInstrument {
  /** Stable internal id: `${exchange}:${symbol}:${instrumentType}`. */
  instrumentId: string;
  symbol: string;
  /** Provider trading symbol, e.g. `NSE:SBIN-EQ` for FYERS. */
  tradingSymbol: string;
  name: string;
  exchange: Exchange;
  instrumentType: InstrumentType;
  /** Market segment code, e.g. `CM` (cash market). */
  segment: string;
  /** Provider-specific identifiers, kept separate and never merged blindly. */
  providerIds: Partial<Record<ProviderId, string>>;
  isin: string | null;
  tickSize: number | null;
  lotSize: number | null;
  isActive: boolean;
  source: ProviderId | "sample";
  isSampleData: boolean;
}

/** Where a candle series came from. Imports are a separate, user-owned source. */
export type CandleSource = ProviderId | "sample" | "csv_import";

export interface NormalizedCandle {
  instrumentId: string;
  interval: Interval;
  /** Candle open time as a true UTC epoch millisecond value. */
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: CandleSource;
  mode: DataMode;
  /**
   * `adjusted` when the provider states prices are split/bonus adjusted,
   * `raw` when explicitly unadjusted, `unknown` otherwise.
   */
  adjusted: "adjusted" | "raw" | "unknown";
}

export interface NormalizedQuote {
  instrumentId: string;
  symbol: string;
  exchange: Exchange;
  lastPrice: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  /** Provider-reported quote timestamp, UTC ms. */
  quoteTime: number | null;
  source: ProviderId | "sample";
  mode: DataMode;
  /**
   * True when the price is the close of a completed session (EOD-only source).
   * Such a price is displayable and usable for valuation, never executable.
   */
  eod?: boolean;
}

export interface Fundamentals {
  symbol: string;
  source: ProviderId;
  mode: DataMode;
  fetchedAt: number;
  asOf: string | null;
  peTtm: number | null;
  /** Market capitalisation in INR crore, as documented by the provider. */
  marketCapCrore: number | null;
  high52w: number | null;
  low52w: number | null;
  /** Statement sections that were actually returned (labels only). */
  sections: { name: string; periodCount: number }[];
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  /** Redacted diagnostics, safe to show in the UI. */
  detail?: string;
}

export interface CandleRequest {
  instrument: NormalizedInstrument;
  interval: Interval;
  fromMs: number;
  toMs: number;
}

export interface ProviderConfigStatus {
  providerId: ProviderId;
  label: string;
  docsUrl: string;
  authMode: AuthMode;
  configured: boolean;
  /** Names only — values are never read back out of the deployment. */
  requiredEnv: string[];
  missingEnv: string[];
  capabilities: ProviderCapabilities;
  notes: string[];
}

export interface MarketDataProvider {
  id: ProviderId;
  label: string;
  docsUrl: string;
  authMode: AuthMode;
  capabilities: ProviderCapabilities;
  /** Environment variable names this adapter reads. */
  requiredEnv: string[];
  /** Documents licensing / redistribution caveats surfaced in the UI. */
  notes: string[];
  isConfigured(env: ProviderEnv): { configured: boolean; missing: string[] };
  fetchQuotes?(
    env: ProviderEnv,
    instruments: NormalizedInstrument[]
  ): Promise<NormalizedQuote[]>;
  fetchCandles?(env: ProviderEnv, req: CandleRequest): Promise<NormalizedCandle[]>;
  fetchInstrumentMaster?(
    env: ProviderEnv,
    options: { exchanges: Exchange[]; limit: number }
  ): Promise<NormalizedInstrument[]>;
  fetchFundamentals?(env: ProviderEnv, instrument: NormalizedInstrument): Promise<Fundamentals>;
  testConnection(env: ProviderEnv): Promise<TestConnectionResult>;
}

/** Builds the internal instrument id used everywhere in the app. */
export function makeInstrumentId(
  exchange: Exchange,
  symbol: string,
  instrumentType: InstrumentType = "EQUITY"
): string {
  return `${exchange}:${symbol}:${instrumentType}`;
}

export function isProviderId(value: string): value is ProviderId {
  return (
    value === "fyers" ||
    value === "breeze" ||
    value === "tapetide" ||
    value === "tejhq" ||
    value === "nsemcp"
  );
}
