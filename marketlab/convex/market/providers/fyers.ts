/**
 * FYERS API v3 adapter.
 *
 * Endpoints and parameters follow the published FYERS API reference
 * (myapi.fyers.in/docsv3, now fyers.in/api-docs/v3):
 *  - Quotes:        GET  /data/quotes?symbols=...            (max 50 symbols)
 *  - History:       GET  /data/history?symbol&resolution...  (100/366 day windows)
 *  - Auth code:     POST /api/v3/validate-authcode
 *  - Refresh token: POST /api/v3/validate-refresh-token
 *  - Instruments:   public sym_details CSV files
 *
 * Credentials live only in Convex deployment environment variables and are
 * never returned to the browser. A FYERS app needs the "Market Data"
 * permission, and access tokens expire daily at 06:30 IST.
 */

import type {
  CandleRequest,
  Exchange,
  Interval,
  MarketDataProvider,
  NormalizedCandle,
  NormalizedInstrument,
  NormalizedQuote,
  ProviderConfigStatus,
  ProviderEnv,
  TestConnectionResult,
} from "../types";
import { INTERVAL_MS } from "../types";
import { naiveIstEpochToUtcMs, utcMsToNaiveIstEpoch, chunkRange } from "../time";
import { normalizeCandles, redactError, toFiniteNumber } from "../normalize";
import { sha256Hex } from "../hash";
import { fetchWithTimeout } from "../http";

const API_BASE = "https://api-t1.fyers.in";
const SYMBOL_MASTER_BASE = "https://public.s3.fyers.in/sym_details";

/** Self-imposed conservative ceiling until the account's plan limit is known. */
export const FYERS_RATE_LIMIT_PER_MINUTE = 60;

const RESOLUTION: Record<Interval, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "1d": "1D",
  "1w": "1W",
  "1M": "1M",
};

function credentials(env: ProviderEnv) {
  return {
    appId: (env.FYERS_APP_ID ?? "").trim(),
    secretId: (env.FYERS_SECRET_ID ?? "").trim(),
    accessToken: (env.FYERS_ACCESS_TOKEN ?? "").trim(),
    refreshToken: (env.FYERS_REFRESH_TOKEN ?? "").trim(),
  };
}

export function fyersTradingSymbol(instrument: {
  symbol: string;
  exchange: string;
  instrumentType: string;
  providerIds?: { fyers?: string };
}): string {
  if (instrument.providerIds?.fyers) return instrument.providerIds.fyers;
  const suffix = instrument.instrumentType === "INDEX" ? "-INDEX" : "-EQ";
  return `${instrument.exchange}:${instrument.symbol}${suffix}`;
}

interface FyersEnvelope<T> {
  s?: string;
  code?: number | string;
  message?: string;
  d?: T;
  candles?: number[][];
  access_token?: string;
  refresh_token?: string;
  data?: T;
}

async function readJson<T>(response: Response): Promise<FyersEnvelope<T>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as FyersEnvelope<T>;
  } catch {
    throw new Error(`FYERS returned a non-JSON response (HTTP ${response.status})`);
  }
}

/** Exchanges an auth code for an access token (documented individual-app flow). */
export async function fyersExchangeAuthCode(
  env: ProviderEnv,
  authCode: string
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const { appId, secretId } = credentials(env);
  if (!appId || !secretId) throw new Error("FYERS_APP_ID and FYERS_SECRET_ID are required");
  const response = await fetchWithTimeout(`${API_BASE}/api/v3/validate-authcode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      appIdHash: sha256Hex(`${appId}:${secretId}`),
      code: authCode,
    }),
  });
  const body = await readJson<unknown>(response);
  if (!response.ok || !body.access_token) {
    throw new Error(redactError(`FYERS auth code exchange failed: ${body.message ?? response.status}`));
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? null };
}

/**
 * Refreshes an access token. Refresh tokens last ~15 days, but the returned
 * token must be written back to the deployment with
 * `npx convex env set FYERS_ACCESS_TOKEN <value>` — this adapter never writes
 * secrets anywhere else.
 */
export async function fyersRefreshAccessToken(
  env: ProviderEnv
): Promise<{ accessToken: string; refreshToken: string | null }> {
  const { appId, secretId, refreshToken } = credentials(env);
  if (!appId || !secretId || !refreshToken) {
    throw new Error("FYERS_APP_ID, FYERS_SECRET_ID and FYERS_REFRESH_TOKEN are required to refresh");
  }
  const response = await fetchWithTimeout(`${API_BASE}/api/v3/validate-refresh-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      appIdHash: sha256Hex(`${appId}:${secretId}`),
      refresh_token: refreshToken,
    }),
  });
  const body = await readJson<unknown>(response);
  if (!response.ok || !body.access_token) {
    throw new Error(redactError(`FYERS token refresh failed: ${body.message ?? response.status}`));
  }
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? refreshToken };
}

async function authorizedGet(
  env: ProviderEnv,
  path: string
): Promise<{ response: Response; body: FyersEnvelope<unknown> }> {
  const { appId, accessToken } = credentials(env);
  if (!appId || !accessToken) {
    throw new Error(
      "FYERS is not configured. Set FYERS_APP_ID, FYERS_SECRET_ID and FYERS_ACCESS_TOKEN in the Convex deployment."
    );
  }
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    headers: {
      Authorization: `${appId}:${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  const body = await readJson<unknown>(response);
  return { response, body };
}

function quoteModeForErrors(body: FyersEnvelope<unknown>): string {
  const code = Number(body.code ?? 0);
  if ([-8, -15, -16, -17].includes(code)) {
    // Phrased without "token <word>" so `redactError` does not rewrite the sentence.
    return "FYERS access token has expired or is invalid — regenerate it after 06:30 IST and update FYERS_ACCESS_TOKEN.";
  }
  return `FYERS error ${code}: ${body.message ?? "request failed"}`;
}

async function fetchQuotes(
  env: ProviderEnv,
  instruments: NormalizedInstrument[]
): Promise<NormalizedQuote[]> {
  const quotes: NormalizedQuote[] = [];
  const batches: NormalizedInstrument[][] = [];
  for (let i = 0; i < instruments.length; i += 50) {
    batches.push(instruments.slice(i, i + 50));
  }

  for (const batch of batches) {
    const symbols = batch.map((instrument) => fyersTradingSymbol(instrument));
    const { response, body } = await authorizedGet(
      env,
      `/data/quotes?symbols=${encodeURIComponent(symbols.join(","))}`
    );
    if (!response.ok || body.s !== "ok") throw new Error(redactError(quoteModeForErrors(body)));

    const entries = (body.d as { n?: string; s?: string; v?: Record<string, unknown> }[]) ?? [];
    for (const entry of entries) {
      if (entry.s !== "ok" || !entry.v) continue;
      const symbol = String(entry.n ?? entry.v.symbol ?? "");
      const instrument = batch.find((candidate) => fyersTradingSymbol(candidate) === symbol);
      if (!instrument) continue;
      const values = entry.v;
      const lastPrice = toFiniteNumber(values.lp);
      if (lastPrice === null) continue;
      const tt = toFiniteNumber(values.tt);
      quotes.push({
        instrumentId: instrument.instrumentId,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        lastPrice,
        change: toFiniteNumber(values.ch),
        changePercent: toFiniteNumber(values.chp),
        open: toFiniteNumber(values.open_price),
        high: toFiniteNumber(values.high_price),
        low: toFiniteNumber(values.low_price),
        previousClose: toFiniteNumber(values.prev_close_price),
        volume: toFiniteNumber(values.volume),
        bid: toFiniteNumber(values.bid),
        ask: toFiniteNumber(values.ask),
        // `tt` is an IST-naive epoch second value.
        quoteTime: tt === null ? null : naiveIstEpochToUtcMs(tt),
        source: "fyers",
        mode: "DELAYED",
      });
    }
  }
  return quotes;
}

async function fetchCandles(env: ProviderEnv, req: CandleRequest): Promise<NormalizedCandle[]> {
  const resolution = RESOLUTION[req.interval];
  const isIntraday = req.interval !== "1d" && req.interval !== "1w" && req.interval !== "1M";
  // Documented per-request limits: 100 days for intraday, 366 days for D/W/M.
  const maxDays = isIntraday ? 100 : 366;
  const chunks = chunkRange(req.fromMs, req.toMs, maxDays).slice(-12);
  const tradingSymbol = fyersTradingSymbol(req.instrument);
  const collected: NormalizedCandle[] = [];

  for (const chunk of chunks) {
    const params = new URLSearchParams({
      symbol: tradingSymbol,
      resolution,
      date_format: "0",
      range_from: String(utcMsToNaiveIstEpoch(chunk.fromMs)),
      range_to: String(utcMsToNaiveIstEpoch(chunk.toMs)),
      cont_flag: req.instrument.instrumentType === "EQUITY" ? "0" : "1",
    });
    const { response, body } = await authorizedGet(env, `/data/history?${params.toString()}`);
    if (!response.ok || body.s !== "ok") {
      // A chunk with no data returns an error; an empty series is a valid outcome.
      const code = Number(body.code ?? 0);
      if (code === 428 || /no data/i.test(String(body.message ?? ""))) continue;
      throw new Error(redactError(quoteModeForErrors(body)));
    }
    for (const row of body.candles ?? []) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const [epoch, open, high, low, close, volume] = row;
      collected.push({
        instrumentId: req.instrument.instrumentId,
        interval: req.interval,
        ts: naiveIstEpochToUtcMs(Number(epoch)),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number.isFinite(Number(volume)) ? Number(volume) : null,
        source: "fyers",
        mode: "HISTORICAL",
        // FYERS history is not documented as split/dividend adjusted.
        adjusted: "unknown",
      });
    }
  }

  return normalizeCandles(collected).candles;
}

const SYMBOL_PATTERN = /^[A-Z]+:[A-Z0-9&.\-]+-(EQ|BE|BZ|SM|INDEX|EQT|N1|N2)$/;
const ISIN_PATTERN = /^IN[A-Z0-9]{10}$/;

/**
 * Parses the public FYERS sym_details CSV.
 *
 * The file is headerless and its positional layout is not documented per
 * column, so the columns are detected by validating the values themselves
 * (trading-symbol format, ISIN format, lot/tick numeric shape). Detection is
 * all-or-nothing: if the layout cannot be established the sync aborts without
 * touching existing instruments.
 */
export function parseFyersInstrumentCsv(
  csv: string,
  exchange: Exchange,
  limit = 5000
): NormalizedInstrument[] {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 20000)
    .map((line) => line.split(","));

  if (rows.length < 10) throw new Error("Instrument master file looks truncated");

  const columnCount = Math.max(...rows.map((row) => row.length));
  const sample = rows.slice(0, 500);

  const matchRate = (index: number, pattern: RegExp) => {
    const values = sample.map((row) => (row[index] ?? "").trim()).filter(Boolean);
    if (values.length === 0) return 0;
    return values.filter((value) => pattern.test(value)).length / values.length;
  };

  let symbolIndex = -1;
  let isinIndex = -1;
  for (let index = 0; index < columnCount; index += 1) {
    if (symbolIndex === -1 && matchRate(index, SYMBOL_PATTERN) >= 0.9) symbolIndex = index;
    if (isinIndex === -1 && matchRate(index, ISIN_PATTERN) >= 0.9) isinIndex = index;
  }
  if (symbolIndex === -1) {
    throw new Error("Could not locate the trading-symbol column in the FYERS instrument master");
  }

  // Name column: the longest alphabetic text that is not a symbol or ISIN.
  let nameIndex = -1;
  let bestLength = 0;
  for (let index = 0; index < columnCount; index += 1) {
    if (index === symbolIndex || index === isinIndex) continue;
    const values = sample.map((row) => (row[index] ?? "").trim()).filter(Boolean);
    if (values.length < sample.length * 0.9) continue;
    const average = values.reduce((sum, value) => sum + value.length, 0) / values.length;
    const alphabetic = values.every((value) => /^[A-Za-z0-9 .,&()\-']+$/.test(value));
    if (alphabetic && average > bestLength) {
      bestLength = average;
      nameIndex = index;
    }
  }

  // Lot size and tick size: adjacent numeric columns next to the ISIN column.
  let lotIndex = -1;
  let tickIndex = -1;
  const numericShape = (index: number) => {
    const values = sample.map((row) => (row[index] ?? "").trim()).filter(Boolean);
    if (values.length < sample.length * 0.9) return null;
    const numbers = values.map((value) => Number(value));
    if (!numbers.every((value) => Number.isFinite(value))) return null;
    return {
      allIntegers: numbers.every((value) => Number.isInteger(value)),
      allBelow100: numbers.every((value) => value > 0 && value < 100),
    };
  };
  if (isinIndex > 0) {
    for (let index = isinIndex - 1; index >= Math.max(0, isinIndex - 4); index -= 1) {
      const shape = numericShape(index);
      if (!shape) continue;
      if (shape.allIntegers && lotIndex === -1) lotIndex = index;
      else if (shape.allBelow100 && tickIndex === -1) tickIndex = index;
    }
  }

  const instruments: NormalizedInstrument[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const tradingSymbol = (row[symbolIndex] ?? "").trim();
    if (!SYMBOL_PATTERN.test(tradingSymbol)) continue;
    const [symbolPart, suffix] = tradingSymbol.split(":");
    const symbol = suffix.replace(/-[A-Z0-9]+$/, "");
    const instrumentType =
      tradingSymbol.endsWith("-INDEX") ? "INDEX" : "EQUITY";
    const instrumentId = `${exchange}:${symbol}:${instrumentType}`;
    if (seen.has(instrumentId)) continue;
    seen.add(instrumentId);

    const name = nameIndex >= 0 ? (row[nameIndex] ?? "").trim() : symbol;
    instruments.push({
      instrumentId,
      symbol,
      tradingSymbol,
      name: name || symbol,
      exchange,
      instrumentType,
      segment: "CM",
      providerIds: { fyers: tradingSymbol },
      isin: isinIndex >= 0 && ISIN_PATTERN.test((row[isinIndex] ?? "").trim()) ? row[isinIndex].trim() : null,
      tickSize: tickIndex >= 0 ? toFiniteNumber(row[tickIndex]) : null,
      lotSize: lotIndex >= 0 ? toFiniteNumber(row[lotIndex]) : null,
      isActive: true,
      source: "fyers",
      isSampleData: false,
    });
    if (instruments.length >= limit) break;
  }

  if (instruments.length === 0) {
    throw new Error("Instrument master parsed to zero rows — refusing to replace existing data");
  }
  return instruments;
}

async function fetchInstrumentMaster(
  env: ProviderEnv,
  options: { exchanges: Exchange[]; limit: number }
): Promise<NormalizedInstrument[]> {
  const collected: NormalizedInstrument[] = [];
  for (const exchange of options.exchanges) {
    const url = `${SYMBOL_MASTER_BASE}/${exchange}_CM.csv`;
    const response = await fetchWithTimeout(url, { headers: { Accept: "text/csv" } });
    if (!response.ok) {
      throw new Error(`FYERS instrument master request failed for ${exchange}: HTTP ${response.status}`);
    }
    const text = await response.text();
    collected.push(...parseFyersInstrumentCsv(text, exchange, options.limit));
  }
  return collected;
}

async function testConnection(env: ProviderEnv): Promise<TestConnectionResult> {
  const { configured, missing } = provider.isConfigured(env);
  if (!configured) {
    return {
      ok: false,
      message: `Not configured — missing ${missing.join(", ")}`,
      latencyMs: 0,
    };
  }
  const startedAt = Date.now();
  try {
    const { response, body } = await authorizedGet(env, "/data/quotes?symbols=NSE%3ASBIN-EQ");
    const latencyMs = Date.now() - startedAt;
    const entries = (body.d as { s?: string; v?: { lp?: number } }[]) ?? [];
    const okQuote = entries.find((entry) => entry.s === "ok" && entry.v?.lp !== undefined);
    if (response.ok && body.s === "ok" && okQuote) {
      return {
        ok: true,
        latencyMs,
        message: `Connected — SBIN-EQ last price ${okQuote.v?.lp}`,
      };
    }
    return {
      ok: false,
      latencyMs,
      message: redactError(quoteModeForErrors(body)),
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      message: redactError(error),
    };
  }
}

export const provider: MarketDataProvider = {
  id: "fyers",
  label: "FYERS",
  docsUrl: "https://fyers.in/api-docs/v3/",
  authMode: "server_app_token",
  requiredEnv: ["FYERS_APP_ID", "FYERS_SECRET_ID", "FYERS_ACCESS_TOKEN"],
  notes: [
    "Requires the Market Data permission on the FYERS app; access tokens expire daily at 06:30 IST.",
    "Historical coverage depends on plan: Standard allows ~1 year of intraday and ~5 years of daily candles.",
    "Redistribution of FYERS/exchange market data to other users needs FYERS and exchange permission — development use only until confirmed.",
  ],
  capabilities: {
    instruments: { supported: true, note: "Public sym_details CSV files (NSE/BSE cash market)" },
    instrumentSync: { supported: true, note: "NSE_CM / BSE_CM CSV, column layout auto-detected" },
    quotes: { supported: true, note: "GET /data/quotes, up to 50 symbols per request" },
    candles: {
      supported: true,
      intervals: ["1m", "5m", "15m", "1h", "1d", "1w", "1M"],
      note: "GET /data/history; 100-day intraday / 366-day daily windows per request",
    },
    streaming: {
      supported: false,
      note: "Provider offers a websocket Data Socket, but a persistent socket host is outside this Convex deployment",
    },
    fundamentals: { supported: false, note: "Not offered by the FYERS market data API" },
    marketStatus: { supported: false, note: "Session status is derived locally from IST exchange hours" },
  },
  isConfigured(env) {
    const { appId, secretId, accessToken } = credentials(env);
    const missing: string[] = [];
    if (!appId) missing.push("FYERS_APP_ID");
    if (!secretId) missing.push("FYERS_SECRET_ID");
    if (!accessToken) missing.push("FYERS_ACCESS_TOKEN");
    return { configured: missing.length === 0, missing };
  },
  fetchQuotes,
  fetchCandles,
  fetchInstrumentMaster,
  testConnection,
};

/** Interval duration in ms, exported for chunk planning in tests. */
export function fyersIntervalMs(interval: Interval): number {
  return INTERVAL_MS[interval];
}

export function fyersStatus(env: ProviderEnv): ProviderConfigStatus {
  const { configured, missing } = provider.isConfigured(env);
  return {
    providerId: provider.id,
    label: provider.label,
    docsUrl: provider.docsUrl,
    authMode: provider.authMode,
    configured,
    requiredEnv: provider.requiredEnv,
    missingEnv: missing,
    capabilities: provider.capabilities,
    notes: provider.notes,
  };
}
