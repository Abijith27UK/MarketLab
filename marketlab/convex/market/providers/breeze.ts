/**
 * ICICI Direct Breeze API adapter.
 *
 * Documented behaviour implemented here:
 *  - Every signed request carries X-AppKey, X-SessionToken, X-Timestamp and
 *    X-Checksum, where the checksum is `token <lowercase sha256(timestamp + body + secret)>`
 *    over the exact JSON body that is sent.
 *  - Quotes:          GET /breezeapi/api/v1/quotes            (JSON body on a GET)
 *  - History:         GET /breezeapi/api/v1/historicalcharts   (max ~1000 candles)
 *  - Session token:   obtained by the user's interactive ICICI Direct login
 *    (CustomerDetails returns `Success.session_token`); an AppKey alone cannot
 *    fetch market data.
 *
 * Intervals are limited to the ones Breeze documents for the v1 history route
 * (1/5/30 minute and 1 day). 15-minute and hourly candles are NOT offered here,
 * because Breeze does not serve them and we refuse to resample silently.
 */

import type {
  CandleRequest,
  Interval,
  MarketDataProvider,
  NormalizedCandle,
  NormalizedInstrument,
  NormalizedQuote,
  ProviderEnv,
  TestConnectionResult,
} from "../types";
import { chunkRange, istDateToUtcMs } from "../time";
import { normalizeCandles, redactError, toFiniteNumber } from "../normalize";
import { sha256Hex } from "../hash";
import { fetchWithTimeout } from "../http";

const API_BASE = "https://api.icicidirect.com/breezeapi/api/v1";

/** Documented account limit: 100 calls/minute, 5,000 calls/day. */
export const BREEZE_RATE_LIMIT_PER_MINUTE = 60;

const INTERVAL_MAP: Partial<Record<Interval, string>> = {
  "1m": "1minute",
  "5m": "5minute",
  "1d": "1day",
};

const CANDLE_MS: Partial<Record<Interval, number>> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function credentials(env: ProviderEnv) {
  return {
    appKey: (env.BREEZE_APP_KEY ?? "").trim(),
    secretKey: (env.BREEZE_SECRET_KEY ?? "").trim(),
    sessionToken: (env.BREEZE_SESSION_TOKEN ?? "").trim(),
  };
}

interface BreezeEnvelope<T> {
  Success?: T;
  Status?: number;
  Error?: string | null;
}

function isoTimestamp(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().replace(/\.(\d{3})Z$/, ".$1Z");
}

function isoDateTime(ms: number): string {
  return new Date(ms).toISOString();
}

async function signedGet<T>(
  env: ProviderEnv,
  resource: string,
  body: Record<string, unknown>
): Promise<BreezeEnvelope<T>> {
  const { appKey, secretKey, sessionToken } = credentials(env);
  if (!appKey || !secretKey || !sessionToken) {
    throw new Error(
      "Breeze is not configured. Set BREEZE_APP_KEY, BREEZE_SECRET_KEY and BREEZE_SESSION_TOKEN in the Convex deployment."
    );
  }
  // The checksum must be computed over the exact serialized body that is sent.
  const payload = JSON.stringify(body);
  const timestamp = isoTimestamp();
  const checksum = sha256Hex(timestamp + payload + secretKey);

  const response = await fetchWithTimeout(`${API_BASE}/${resource}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-AppKey": appKey,
      "X-SessionToken": sessionToken,
      "X-Timestamp": timestamp,
      "X-Checksum": `token ${checksum}`,
    },
    body: payload,
  });

  const text = await response.text();
  let parsed: BreezeEnvelope<T>;
  try {
    parsed = JSON.parse(text) as BreezeEnvelope<T>;
  } catch {
    throw new Error(`Breeze returned a non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok && parsed.Error === undefined) {
    throw new Error(`Breeze request failed: HTTP ${response.status}`);
  }
  return parsed;
}

function breezeStockCode(instrument: NormalizedInstrument): string {
  return instrument.providerIds.breeze ?? instrument.symbol;
}

function parseBreezeDateTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return istDateToUtcMs(trimmed);
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

async function fetchQuotes(
  env: ProviderEnv,
  instruments: NormalizedInstrument[]
): Promise<NormalizedQuote[]> {
  const quotes: NormalizedQuote[] = [];
  for (const instrument of instruments) {
    const envelope = await signedGet<Record<string, unknown>>(env, "quotes", {
      stock_code: breezeStockCode(instrument),
      exchange_code: instrument.exchange,
      product_type: "cash",
    });
    if (envelope.Error) throw new Error(redactError(`Breeze quotes: ${envelope.Error}`));
    const record = envelope.Success;
    if (!record) continue;

    const lastPrice =
      toFiniteNumber(record.last_rate) ??
      toFiniteNumber(record.ltp) ??
      toFiniteNumber(record.close);
    if (lastPrice === null) continue;
    const previousClose = toFiniteNumber(record.prev_close) ?? toFiniteNumber(record.close);
    const change = previousClose === null ? null : lastPrice - previousClose;

    quotes.push({
      instrumentId: instrument.instrumentId,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      lastPrice,
      change,
      changePercent: change !== null && previousClose ? (change / previousClose) * 100 : null,
      open: toFiniteNumber(record.open),
      high: toFiniteNumber(record.high),
      low: toFiniteNumber(record.low),
      previousClose,
      volume:
        toFiniteNumber(record.volume) ?? toFiniteNumber(record.total_traded_quantity) ?? null,
      bid: toFiniteNumber(record.best_bid_rate) ?? toFiniteNumber(record.bid_rate),
      ask: toFiniteNumber(record.best_offer_rate) ?? toFiniteNumber(record.offer_rate),
      quoteTime: parseBreezeDateTime(record.ltt),
      source: "breeze",
      mode: "DELAYED",
    });
  }
  return quotes;
}

async function fetchCandles(env: ProviderEnv, req: CandleRequest): Promise<NormalizedCandle[]> {
  const interval = INTERVAL_MAP[req.interval];
  if (!interval) {
    throw new Error(
      `Breeze does not serve ${req.interval} candles. Supported: 1m, 5m, 1d.`
    );
  }
  const stepMs = CANDLE_MS[req.interval] as number;
  // Keep each response under the documented ~1000 candle cap.
  const maxDays = Math.max(1, Math.floor((1000 * stepMs) / (24 * 60 * 60 * 1000)));
  const chunks = chunkRange(req.fromMs, req.toMs, maxDays).slice(-20);
  const collected: NormalizedCandle[] = [];

  for (const chunk of chunks) {
    const envelope = await signedGet<Record<string, unknown>[]>(env, "historicalcharts", {
      interval,
      from_date: isoDateTime(chunk.fromMs),
      to_date: isoDateTime(chunk.toMs),
      stock_code: breezeStockCode(req.instrument),
      exchange_code: req.instrument.exchange,
      product_type: "cash",
    });
    if (envelope.Error) throw new Error(redactError(`Breeze history: ${envelope.Error}`));
    for (const row of envelope.Success ?? []) {
      const ts = parseBreezeDateTime(row.datetime);
      const open = toFiniteNumber(row.open);
      const high = toFiniteNumber(row.high);
      const low = toFiniteNumber(row.low);
      const close = toFiniteNumber(row.close);
      if (ts === null || open === null || high === null || low === null || close === null) continue;
      collected.push({
        instrumentId: req.instrument.instrumentId,
        interval: req.interval,
        ts,
        open,
        high,
        low,
        close,
        volume: toFiniteNumber(row.volume),
        source: "breeze",
        mode: "HISTORICAL",
        adjusted: "unknown",
      });
    }
  }
  return normalizeCandles(collected).candles;
}

async function testConnection(env: ProviderEnv): Promise<TestConnectionResult> {
  const { configured, missing } = provider.isConfigured(env);
  if (!configured) {
    return { ok: false, message: `Not configured — missing ${missing.join(", ")}`, latencyMs: 0 };
  }
  const startedAt = Date.now();
  try {
    const envelope = await signedGet<Record<string, unknown>>(env, "quotes", {
      stock_code: "RELIND",
      exchange_code: "NSE",
      product_type: "cash",
    });
    const latencyMs = Date.now() - startedAt;
    if (envelope.Error) {
      return { ok: false, latencyMs, message: redactError(envelope.Error) };
    }
    const lastPrice = toFiniteNumber(envelope.Success?.last_rate);
    if (lastPrice === null) {
      return {
        ok: false,
        latencyMs,
        message: "Breeze responded but no last traded price was returned for RELIND/NSE",
      };
    }
    return { ok: true, latencyMs, message: `Connected — RELIND/NSE last price ${lastPrice}` };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, message: redactError(error) };
  }
}

export const provider: MarketDataProvider = {
  id: "breeze",
  label: "ICICI Direct Breeze",
  docsUrl: "https://api.icicidirect.com/breezeapi/documents/index.html",
  authMode: "per_user_session",
  requiredEnv: ["BREEZE_APP_KEY", "BREEZE_SECRET_KEY", "BREEZE_SESSION_TOKEN"],
  notes: [
    "An AppKey alone cannot read market data: BREEZE_SESSION_TOKEN must come from an interactive ICICI Direct customer login and expires within ~24 hours.",
    "ICICI API terms prohibit sublicensing and cache-for-redistribution; serving one customer's session to all MarketLab users is not permitted. Development use only.",
    "Documented limits: 100 API calls/minute and 5,000/day across endpoints.",
    "15-minute and 1-hour candles are not offered by the documented history route, so they are not exposed.",
  ],
  capabilities: {
    instruments: { supported: true, note: "Security master is a daily ZIP archive; use CSV import" },
    instrumentSync: {
      supported: false,
      note: "SecurityMaster.zip cannot be unpacked in the Convex runtime — import an unzipped CSV instead",
    },
    quotes: { supported: true, note: "GET /quotes with signed headers, one symbol per call" },
    candles: {
      supported: true,
      intervals: ["1m", "5m", "1d"],
      note: "GET /historicalcharts, ~1000 candles per request",
    },
    streaming: {
      supported: false,
      note: "Breeze offers an OHLC websocket, but a persistent socket host is outside this Convex deployment",
    },
    fundamentals: { supported: false, note: "Not offered by the Breeze market data API" },
    marketStatus: { supported: false, note: "Session status is derived locally from IST exchange hours" },
  },
  isConfigured(env) {
    const { appKey, secretKey, sessionToken } = credentials(env);
    const missing: string[] = [];
    if (!appKey) missing.push("BREEZE_APP_KEY");
    if (!secretKey) missing.push("BREEZE_SECRET_KEY");
    if (!sessionToken) missing.push("BREEZE_SESSION_TOKEN");
    return { configured: missing.length === 0, missing };
  },
  fetchQuotes,
  fetchCandles,
  testConnection,
};

export function breezeStatus(env: ProviderEnv) {
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
