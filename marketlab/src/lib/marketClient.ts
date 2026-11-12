import { makeFunctionReference } from "convex/server";

/**
 * Typed client bindings for the Phase 2 market-data API.
 *
 * These use `makeFunctionReference` with explicit argument/return types instead
 * of the generated `api` object. The shapes here mirror the server handlers in
 * `convex/marketData.ts`, `convex/screener.ts` and `convex/chartPreferences.ts`,
 * so the UI is type-checked even before the Convex deployment is connected.
 */

export type DataMode = "LIVE" | "DELAYED" | "CACHED" | "HISTORICAL" | "SAMPLE";

export type Interval = "1m" | "5m" | "15m" | "1h" | "1d" | "1w" | "1M";

export const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "1d", "1w", "1M"];

export const INTERVAL_LABEL: Record<Interval, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1h": "1h",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
};

export type Exchange = "NSE" | "BSE";
export type InstrumentType = "EQUITY" | "ETF" | "INDEX" | "OTHER";
export type ChartType = "candlestick" | "line" | "bar";

export interface MarketSessionInfo {
  status: "OPEN" | "PRE_OPEN" | "CLOSED" | "WEEKEND" | "HOLIDAY";
  label: string;
  istDate: string;
  istTime: string;
  holidayKnown: boolean;
}

export interface Quote {
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
  quoteTime: number | null;
  source: string;
  mode: DataMode;
  /** True when this is a completed session's close (EOD-only provider). */
  eod?: boolean;
}

export interface QuotesResult {
  quotes: Quote[];
  mode: DataMode;
  source: string;
  /** Retrieval time — when MarketLab asked the provider. Never quote age. */
  asOf: number;
  /** Newest provider quote timestamp in the batch; null when none was reported. */
  quoteAsOf: number | null;
  /** When the backend received these values (same as `asOf`, explicit name). */
  retrievedAt: number;
  /** Provider that served the batch, or null when it fell back to SAMPLE. */
  quoteProvider: string | null;
  session: MarketSessionInfo;
  note: string | null;
  warning: string | null;
}

export interface Candle {
  instrumentId: string;
  interval: Interval;
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: string;
  mode: DataMode;
  adjusted: "adjusted" | "raw" | "unknown";
}

export interface CandleQuality {
  rowCount: number;
  gaps: number;
  gapSamples: number[];
  firstTs: number | null;
  lastTs: number | null;
  fromCache: boolean;
}

/** Historical chart-history providers (daily bars only). */
export type ChartSource = "tejhq" | "nsemcp";

export interface CandleResult {
  instrumentId: string;
  symbol: string;
  interval: Interval;
  candles: Candle[];
  mode: DataMode;
  source: string;
  adjusted: "adjusted" | "raw" | "unknown";
  fetchedAt: number;
  note: string | null;
  warning: string | null;
  quality: CandleQuality;
}

export interface InstrumentRow {
  _id: string;
  symbol: string;
  name: string;
  exchange: Exchange;
  instrumentType: InstrumentType;
  sector: string;
  dataSource: string;
  isSampleData: boolean;
  lastUpdated: number;
  instrumentId?: string;
  tradingSymbol?: string;
  segment?: string;
  isin?: string;
  tickSize?: number | null;
  lotSize?: number | null;
  isActive?: boolean;
  providerIds?: {
    fyers?: string;
    breeze?: string;
    tapetide?: string;
    tejhq?: string;
    nsemcp?: string;
  };
}

export interface SearchResult {
  items: InstrumentRow[];
  nextCursor: string | null;
  isDone: boolean;
  mode: "search" | "browse";
}

export interface DashboardIndicesResult {
  items: InstrumentRow[];
}

export interface FeaturedInstrumentsResult {
  items: InstrumentRow[];
  /** Requested symbols the catalogue does not contain. */
  missing: string[];
}

/** One row of the official NSE market-mover ranking. */
export interface MarketMoverRow {
  symbol: string;
  /** Catalogue name when the symbol exists locally, otherwise null. */
  name: string | null;
  instrumentId: string;
  inCatalogue: boolean;
  series: string;
  lastPrice: number;
  previousClose: number | null;
  change: number | null;
  /** Strictly > 0 in Gainers, strictly < 0 in Losers. */
  changePercent: number;
  /** Provider crawl time for this direction, UTC ms. */
  quoteTime: number | null;
}

/** Fixed-source market movers payload (always NSE MCP). */
export interface MarketMoversResult {
  available: boolean;
  source: "nsemcp";
  sourceLabel: string;
  tool: string | null;
  universe: string;
  segment: string;
  gainers: MarketMoverRow[];
  losers: MarketMoverRow[];
  mode: DataMode;
  quoteTimestamp: number | null;
  sessionDate: string | null;
  retrievedAt: number;
  cacheExpiresAt: number | null;
  fromCache: boolean;
  /** True when the ranking could not be refreshed and the last copy is shown. */
  stale: boolean;
  warning: string | null;
  reason: string | null;
}

export interface CatalogueStats {
  total: number;
  sample: number;
  provider: number;
  lastUpdated: number | null;
}

export interface SessionStatusResult extends MarketSessionInfo {
  now: number;
  holidaysConfigured: boolean;
  holidayCount: number;
}

export interface CapabilityDescriptor {
  supported: boolean;
  intervals?: Interval[];
  note?: string;
}

export interface ProviderStatus {
  providerId: string;
  label: string;
  docsUrl: string;
  authMode: "server_app_token" | "per_user_session" | "api_token" | "none";
  configured: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  capabilities: Record<string, CapabilityDescriptor>;
  notes: string[];
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  lastLatencyMs: number | null;
  instrumentsSyncedAt: number | null;
  instrumentCount: number | null;
  /** IST date (YYYY-MM-DD) of the newest session this provider returned. */
  lastDataDate: string | null;
  rateWindowCount: number;
  rateLimitPerMinute: number;
  dailyCount: number;
  dailyLimit: number | null;
}

export interface ProviderOverview {
  now: number;
  session: MarketSessionInfo;
  holidaysConfigured: boolean;
  availableIntervals: Interval[];
  providers: ProviderStatus[];
  catalogue: { total: number; sample: number; provider: number; lastUpdated: number | null };
  coverage: DataCoverage;
  features: FeatureAvailability[];
  /** The user's selected informational quote source (TejHQ when unset). */
  preferredQuoteProvider: "tejhq" | "nsemcp" | string;
  /** The user's selected historical chart source (TejHQ when unset). */
  preferredChartSource?: "tejhq" | "nsemcp" | string;
  /** Which providers can currently serve daily chart history. */
  chartSources?: { tejhq: boolean; nsemcp: boolean };
  /** True only when NSE_MCP_POC_ENABLED is set on the deployment. */
  nseMcpEnabled: boolean;
  hasConfiguredProvider: boolean;
  providerCount: number;
}

export type FeatureMode = DataMode | "UNAVAILABLE";

export interface DataCoverage {
  instruments: number;
  providerQuotes: number;
  sampleQuotes: number;
  eodQuotes: number;
  cachedCandleSeries: number;
  importedCandleSeries: number;
  candleSources: string[];
  latestProviderQuoteAt: number | null;
  latestQuoteSessionDate: string | null;
  latestCandleTs: number | null;
  latestCandleDate: string | null;
}

export interface FeatureAvailability {
  key: string;
  label: string;
  mode: FeatureMode;
  detail: string;
}

export interface TestProviderResult {
  providerId: string;
  ok: boolean;
  message: string;
  latencyMs: number;
}

export interface FundamentalsRecord {
  instrumentId: string;
  symbol: string;
  source: string;
  mode: DataMode;
  fetchedAt: number;
  asOf: string | null;
  peTtm: number | null;
  marketCapCrore: number | null;
  high52w: number | null;
  low52w: number | null;
  sections: { name: string; periodCount: number }[];
}

export interface FundamentalsResult {
  fundamentals: FundamentalsRecord | null;
  note: string | null;
}

export interface CsvImportResult {
  accepted: number;
  rejected: { line: number; reason: string }[];
  summary: {
    totalRows: number;
    acceptedRows: number;
    rejectedRows: number;
    duplicatesRemoved: number;
    firstTs: number | null;
    lastTs: number | null;
  };
}

export interface ImportRecord {
  _id: string;
  instrumentId: string;
  instrumentLabel: string;
  interval: Interval;
  fileName: string;
  status: "completed" | "failed";
  totalRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicatedRows: number;
  firstTs: number | null;
  lastTs: number | null;
  rejectionSample: { line: number; reason: string }[];
  error: string | null;
  createdAt: number;
}

export interface ScreenerFilters {
  search?: string;
  exchange?: Exchange | "ALL";
  instrumentType?: InstrumentType | "ALL";
  minPrice?: number;
  maxPrice?: number;
  minChangePercent?: number;
  maxChangePercent?: number;
  minVolume?: number;
  minPe?: number;
  maxPe?: number;
  minMarketCapCrore?: number;
  maxMarketCapCrore?: number;
  technical?: {
    indicator: "RSI" | "PRICE_VS_SMA";
    period: number;
    interval: Interval;
    min?: number;
    max?: number;
  };
  /** Drop rows that would be priced from SAMPLE data. */
  excludeSample?: boolean;
  limit?: number;
}

export interface ScreenerRow {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: Exchange;
  instrumentType: InstrumentType;
  isSampleData: boolean;
  lastPrice: number | null;
  changePercent: number | null;
  volume: number | null;
  peTtm: number | null;
  marketCapCrore: number | null;
  technicalValue: number | null;
  technicalNote: string | null;
  technicalMode: DataMode | null;
  technicalSource: string | null;
  mode: DataMode;
  source: string;
  /** End-of-day close rather than an intraday quote. */
  eod: boolean;
  /** IST session date of the stored quote. */
  quoteDate: string | null;
  quoteFetchedAt: number | null;
  hasQuote: boolean;
}

export interface ScreenerResult {
  rows: ScreenerRow[];
  evaluated: number;
  matched: number;
  skippedNoQuote: number;
  skippedNoHistory: number;
  /** Rows priced from the deterministic SAMPLE series because no quote was stored. */
  samplePriced: number;
  /** Rows dropped because only SAMPLE data existed for them. */
  sampleExcluded: number;
  mode: DataMode;
  asOf: number;
  note: string | null;
  excludedNote: string | null;
}

export interface BacktestPrepareResult {
  instrumentId: string;
  interval: Interval;
  mode: DataMode;
  source: string;
  eod: boolean;
  rowCount: number;
  firstTs: number | null;
  lastTs: number | null;
  fromCache: boolean;
  ready: boolean;
  note: string | null;
  warning: string | null;
}

export interface ScreenerAvailability {
  quoteFields: boolean;
  fundamentalFields: boolean;
  technicalFields: boolean;
  instrumentCount: number;
}

export interface SavedScreener {
  _id: string;
  name: string;
  filtersJson: string;
  lastResultCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface IndicatorConfig {
  name: "SMA" | "EMA" | "RSI" | "MACD" | "BOLLINGER" | "VWAP";
  enabled: boolean;
  period?: number;
  fast?: number;
  slow?: number;
  signal?: number;
  multiplier?: number;
}

export interface ChartPreference {
  _id: string;
  instrumentId: string;
  interval: Interval;
  chartType: ChartType;
  indicators: IndicatorConfig[];
  updatedAt: number;
}

export const marketApi = {
  /* market data */
  getQuotes: makeFunctionReference<
    "action",
    { instrumentIds: string[]; forceRefresh?: boolean },
    QuotesResult
  >("marketData:getQuotes"),
  getCandles: makeFunctionReference<
    "action",
    {
      instrumentId: string;
      interval: Interval;
      fromMs?: number;
      toMs?: number;
      source?: ChartSource;
    },
    CandleResult
  >("marketData:getCandles"),
  getFundamentals: makeFunctionReference<
    "action",
    { instrumentId: string },
    FundamentalsResult
  >("marketData:getFundamentals"),
  providerOverview: makeFunctionReference<"action", Record<string, never>, ProviderOverview>(
    "marketData:providerOverview"
  ),
  testProvider: makeFunctionReference<
    "action",
    { providerId: string },
    TestProviderResult
  >("marketData:testProvider"),
  /** Persists the informational quote source for the signed-in user. */
  setQuoteProvider: makeFunctionReference<
    "mutation",
    { provider: "tejhq" | "nsemcp" },
    "tejhq" | "nsemcp"
  >("users:setQuoteProvider"),
  prepareBacktestData: makeFunctionReference<
    "action",
    { strategyId: string },
    BacktestPrepareResult
  >("backtests:prepareData"),
  syncInstruments: makeFunctionReference<
    "action",
    { exchanges?: Exchange[] },
    { providerId: string; total: number; inserted: number; updated: number; exchanges: Exchange[] }
  >("marketData:syncInstruments"),

  /* explorer */
  searchInstruments: makeFunctionReference<
    "query",
    {
      search?: string;
      exchange?: Exchange | "ALL";
      instrumentType?: InstrumentType | "ALL";
      limit?: number;
      cursor?: string | null;
    },
    SearchResult
  >("marketData:searchInstruments"),
  getInstrument: makeFunctionReference<
    "query",
    { instrumentId: string },
    InstrumentRow | null
  >("marketData:getInstrument"),
  catalogueStats: makeFunctionReference<"query", Record<string, never>, CatalogueStats>(
    "marketData:catalogueStats"
  ),
  /** Six verified NSE index identities for the dashboard cards. */
  dashboardIndices: makeFunctionReference<"query", Record<string, never>, DashboardIndicesResult>(
    "marketData:dashboardIndices"
  ),
  /** Curated dashboard stocks, resolved in the requested order. */
  featuredInstruments: makeFunctionReference<
    "query",
    { symbols: string[]; limit?: number },
    FeaturedInstrumentsResult
  >("marketData:featuredInstruments"),

  /* official NSE market movers — fixed source, independent of the quote selector */
  getMarketMovers: makeFunctionReference<
    "action",
    { refresh?: boolean },
    MarketMoversResult
  >("marketMovers:getMarketMovers"),
  marketStatus: makeFunctionReference<"query", Record<string, never>, SessionStatusResult>(
    "marketData:marketStatus"
  ),

  /* CSV imports */
  importCsv: makeFunctionReference<
    "action",
    { instrumentId: string; interval: Interval; fileName: string; csvText: string },
    CsvImportResult
  >("marketData:importCsv"),
  listImports: makeFunctionReference<"query", Record<string, never>, ImportRecord[]>(
    "marketData:listImports"
  ),
  deleteImport: makeFunctionReference<
    "mutation",
    { importId: string },
    { deleted: boolean }
  >("marketData:deleteImport"),

  /* screener */
  screenerRun: makeFunctionReference<
    "action",
    { filters: ScreenerFilters },
    ScreenerResult
  >("screener:run"),
  screenerAvailability: makeFunctionReference<
    "query",
    Record<string, never>,
    ScreenerAvailability
  >("screener:availability"),
  savedScreeners: makeFunctionReference<"query", Record<string, never>, SavedScreener[]>(
    "screener:listSaved"
  ),
  saveScreener: makeFunctionReference<
    "mutation",
    { name: string; filtersJson: string; resultCount: number },
    string
  >("screener:save"),
  renameScreener: makeFunctionReference<
    "mutation",
    { id: string; name: string },
    null
  >("screener:renameSaved"),
  removeScreener: makeFunctionReference<"mutation", { id: string }, null>(
    "screener:removeSaved"
  ),

  /* chart preferences */
  chartPreferences: makeFunctionReference<
    "query",
    { instrumentId: string },
    ChartPreference | null
  >("chartPreferences:get"),
  saveChartPreferences: makeFunctionReference<
    "mutation",
    { instrumentId: string; interval: Interval; chartType: ChartType; indicators: IndicatorConfig[] },
    string
  >("chartPreferences:save"),
};
