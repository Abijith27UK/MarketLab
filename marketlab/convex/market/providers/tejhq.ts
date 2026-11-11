/**
 * TejHQ adapter — keyless, end-of-day Indian market data.
 *
 * Verified against the live public API and its published OpenAPI document
 * (`https://api.tejhq.dev/openapi.yaml`) on 2026-10-30:
 *
 *  - Base URL `https://api.tejhq.dev`, no authentication on the open tier.
 *  - `GET /v1/ohlcv/{exchange}/{symbol}?from=YYYY-MM-DD&to=YYYY-MM-DD`
 *    → `{ data: OHLCV[], meta }`, one row per trading day.
 *  - `GET /v1/snapshot/{exchange}?date=YYYY-MM-DD`
 *    → `{ data: SnapshotRow[], meta }`, every symbol's bhavcopy line for one day.
 *  - `GET /v1/actions/{symbol}` → corporate actions (not used here).
 *  - `GET /health`, `GET /ready` → liveness/readiness.
 *  - Coverage: NSE bhavcopy from 2010-01-04, BSE from 2024-07-08, refreshed on
 *    trading days at 18:30 IST (21:30 IST retry), each run sweeping seven days.
 *
 * What this provider is NOT:
 *  - It has no intraday intervals, no streaming feed and no live tick. Every
 *    price it returns is an end-of-day (EOD) close from a completed session, so
 *    quotes are always labelled DELAYED and candles HISTORICAL. Nothing here can
 *    produce a LIVE label.
 *  - Bhavcopy prices are not split/bonus adjusted. `adjusted` is reported as
 *    `unknown` and corporate actions are only available separately.
 *  - Indices and non-equity instruments are not in the bhavcopy, so they have no
 *    TejHQ data; callers fall back to a labelled SAMPLE series.
 *
 * Keyless means no demat account, PAN, broker login or paid plan is involved.
 * The optional free key only unlocks `/v1/adjusted` and `/v1/symbols`, which this
 * adapter does not use.
 */

import type {
  CandleRequest,
  Exchange,
  MarketDataProvider,
  NormalizedCandle,
  NormalizedInstrument,
  NormalizedQuote,
  ProviderEnv,
  TestConnectionResult,
} from "../types";
import { normalizeCandles, redactError, toFiniteNumber } from "../normalize";
import { fetchWithTimeout } from "../http";
import { istDateString, istDateToUtcMs, toIstParts, SESSION } from "../time";

const API_BASE = "https://api.tejhq.dev";

/** Polite keyless budget; the open tier publishes no hard per-minute number. */
export const TEJHQ_RATE_LIMIT_PER_MINUTE = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back to look for the most recent ingested trading session. */
const MAX_SNAPSHOT_LOOKBACK_DAYS = 10;
/** The snapshot cache exists only to avoid re-downloading a large payload mid-request. */
const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000;
/** Rows requested per full-market snapshot during an instrument sync. */
const MAX_MASTER_ROWS = 8000;

interface Envelope<T> {
  data?: T;
  meta?: Record<string, unknown>;
  error?: string;
  message?: string;
}

interface TejhqOhlcvRow {
  date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  prev_close?: unknown;
  volume?: unknown;
}

interface TejhqSnapshotRow {
  symbol?: unknown;
  series?: unknown;
  isin?: unknown;
  name?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  last?: unknown;
  prev_close?: unknown;
  volume?: unknown;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

async function get<T>(
  path: string,
  timeoutMs?: number
): Promise<{ data: T; meta: Record<string, unknown> }> {
  const response = await fetchWithTimeout(
    `${API_BASE}${path}`,
    { headers: { Accept: "application/json" } },
    timeoutMs
  );
  const text = await response.text();
  let body: Envelope<T>;
  try {
    body = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new Error(`TejHQ returned a non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok || body.error) {
    throw new Error(
      redactError(
        `TejHQ ${body.error ?? response.status}: ${body.message ?? "request failed"}`
      )
    );
  }
  return { data: body.data as T, meta: body.meta ?? {} };
}

/** TejHQ uses the plain exchange symbol, e.g. `RELIANCE`. */
function tejhqSymbol(instrument: NormalizedInstrument): string {
  return (instrument.providerIds.tejhq ?? instrument.symbol ?? "").trim().toUpperCase();
}

/** Timestamp of the 15:30 IST close for an IST trading date. */
function sessionCloseMs(date: string): number {
  return istDateToUtcMs(date) + SESSION.close * 60_000;
}

const snapshotCache = new Map<
  string,
  { date: string; rows: TejhqSnapshotRow[]; fetchedAt: number }
>();

/**
 * Most recent snapshot with data, walking back from today.
 * Empty responses are normal for weekends and holidays; the API does not error
 * for them, so an empty array simply means "try the previous calendar day".
 */
async function latestSnapshot(
  exchange: Exchange,
  nowMs: number
): Promise<{ date: string; rows: TejhqSnapshotRow[] }> {
  const cached = snapshotCache.get(exchange);
  if (cached && nowMs - cached.fetchedAt < SNAPSHOT_CACHE_TTL_MS) {
    return { date: cached.date, rows: cached.rows };
  }

  for (let offset = 0; offset <= MAX_SNAPSHOT_LOOKBACK_DAYS; offset += 1) {
    const candidateMs = nowMs - offset * DAY_MS;
    const weekday = toIstParts(candidateMs).weekday;
    // Saturday/Sunday never carry a bhavcopy; skip without spending a request.
    if (weekday === 0 || weekday === 6) continue;
    const date = istDateString(candidateMs);
    const { data } = await get<TejhqSnapshotRow[]>(
      `/v1/snapshot/${exchange}?date=${date}`
    );
    const rows = Array.isArray(data) ? data : [];
    if (rows.length > 0) {
      snapshotCache.set(exchange, { date, rows, fetchedAt: nowMs });
      return { date, rows };
    }
  }
  throw new Error(
    `TejHQ has no ${exchange} snapshot in the last ${MAX_SNAPSHOT_LOOKBACK_DAYS} days`
  );
}

async function fetchCandles(
  _env: ProviderEnv,
  request: CandleRequest
): Promise<NormalizedCandle[]> {
  if (request.interval !== "1d") {
    throw new Error(
      `TejHQ serves end-of-day daily bars only; ${request.interval} is not available from this provider.`
    );
  }

  const symbol = tejhqSymbol(request.instrument);
  if (!symbol) throw new Error("TejHQ needs a symbol to fetch candles");

  const from = istDateString(request.fromMs);
  const to = istDateString(request.toMs);
  const { data } = await get<TejhqOhlcvRow[]>(
    `/v1/ohlcv/${request.instrument.exchange}/${encodeURIComponent(symbol)}?from=${from}&to=${to}`
  );

  const rows = Array.isArray(data) ? data : [];
  const candles: NormalizedCandle[] = [];
  for (const row of rows) {
    const date = typeof row.date === "string" ? row.date.trim() : "";
    if (!DATE_PATTERN.test(date)) continue;
    const open = toFiniteNumber(row.open);
    const high = toFiniteNumber(row.high);
    const low = toFiniteNumber(row.low);
    const close = toFiniteNumber(row.close);
    if (open === null || high === null || low === null || close === null) continue;
    candles.push({
      instrumentId: request.instrument.instrumentId,
      interval: "1d",
      // IST midnight of the session date, the same daily bucket convention the
      // sample series and CSV importer use.
      ts: istDateToUtcMs(date),
      open,
      high,
      low,
      close,
      volume: toFiniteNumber(row.volume),
      source: "tejhq",
      mode: "HISTORICAL",
      // Bhavcopy closes are raw; the adjusted series needs the paid/adjusted route.
      adjusted: "unknown",
    });
  }

  // Structural validation (OHLC relationships, duplicates, ordering) is shared
  // with every other provider. Invalid rows are dropped, never repaired.
  return normalizeCandles(candles).candles;
}

async function fetchQuotes(
  _env: ProviderEnv,
  instruments: NormalizedInstrument[]
): Promise<NormalizedQuote[]> {
  const nowMs = Date.now();
  const byExchange = new Map<Exchange, NormalizedInstrument[]>();
  for (const instrument of instruments) {
    const bucket = byExchange.get(instrument.exchange) ?? [];
    bucket.push(instrument);
    byExchange.set(instrument.exchange, bucket);
  }

  const quotes: NormalizedQuote[] = [];
  for (const [exchange, batch] of byExchange) {
    const { date, rows } = await latestSnapshot(exchange, nowMs);
    const bySymbol = new Map<string, TejhqSnapshotRow>();
    for (const row of rows) {
      const symbol = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
      if (symbol) bySymbol.set(symbol, row);
    }

    const quoteTime = sessionCloseMs(date);
    for (const instrument of batch) {
      const row = bySymbol.get(tejhqSymbol(instrument));
      if (!row) continue;
      const close = toFiniteNumber(row.close);
      const last = toFiniteNumber(row.last);
      const lastPrice = close ?? last;
      if (lastPrice === null || lastPrice <= 0) continue;
      const previousClose = toFiniteNumber(row.prev_close);
      const change = previousClose === null ? null : lastPrice - previousClose;

      quotes.push({
        instrumentId: instrument.instrumentId,
        symbol: instrument.symbol,
        exchange: instrument.exchange,
        lastPrice,
        change,
        changePercent:
          change !== null && previousClose ? (change / previousClose) * 100 : null,
        open: toFiniteNumber(row.open),
        high: toFiniteNumber(row.high),
        low: toFiniteNumber(row.low),
        previousClose,
        volume: toFiniteNumber(row.volume),
        bid: null,
        ask: null,
        // The timestamp of the completed session this close belongs to.
        quoteTime,
        source: "tejhq",
        // End-of-day close, never a live intraday tick.
        mode: "DELAYED",
      });
    }
  }

  return quotes;
}

async function fetchInstrumentMaster(
  _env: ProviderEnv,
  options: { exchanges: Exchange[]; limit: number }
): Promise<NormalizedInstrument[]> {
  const nowMs = Date.now();
  const limit = Math.min(Math.max(1, options.limit), MAX_MASTER_ROWS);
  const instruments: NormalizedInstrument[] = [];
  const seen = new Set<string>();

  for (const exchange of options.exchanges) {
    const { rows } = await latestSnapshot(exchange, nowMs);
    // `limit` is a per-exchange cap. Applying one shared cap truncated BSE
    // entirely once NSE's ~2,950 rows were read.
    let taken = 0;
    for (const row of rows) {
      if (taken >= limit) break;
      const symbol = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
      if (!symbol) continue;
      const instrumentId = `${exchange}:${symbol}:EQUITY`;
      if (seen.has(instrumentId)) continue;
      const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : symbol;
      const series = typeof row.series === "string" ? row.series.trim().toUpperCase() : "";
      const isin = typeof row.isin === "string" && row.isin.trim() ? row.isin.trim() : null;

      instruments.push({
        instrumentId,
        symbol,
        tradingSymbol: `${exchange}:${symbol}`,
        name,
        exchange,
        // The bhavcopy contains equities; the NSE series code (EQ/BE/…) is kept
        // as a segment hint rather than being used to invent other asset types.
        instrumentType: "EQUITY",
        segment: series || "CM",
        providerIds: { tejhq: symbol },
        isin,
        tickSize: null,
        lotSize: null,
        isActive: true,
        source: "tejhq",
        isSampleData: false,
      });
      seen.add(instrumentId);
      taken += 1;
    }
  }

  return instruments;
}

async function testConnection(_env: ProviderEnv): Promise<TestConnectionResult> {
  const startedAt = Date.now();
  try {
    const { data } = await get<TejhqOhlcvRow[]>(
      `/v1/ohlcv/NSE/RELIANCE?from=${istDateString(Date.now() - 10 * DAY_MS)}&to=${istDateString(Date.now())}`
    );
    const rows = Array.isArray(data) ? data : [];
    const lastDate =
      rows
        .map((row) => (typeof row.date === "string" ? row.date : ""))
        .filter((date) => DATE_PATTERN.test(date))
        .sort()
        .at(-1) ?? null;
    const latencyMs = Date.now() - startedAt;
    if (!lastDate) {
      return {
        ok: false,
        latencyMs,
        message: "Reached TejHQ but no NSE rows were returned for the last 10 days",
      };
    }
    return {
      ok: true,
      latencyMs,
      message: `Connected — keyless open tier, NSE EOD data through ${lastDate}`,
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, message: redactError(error) };
  }
}

export const provider: MarketDataProvider = {
  id: "tejhq",
  label: "TejHQ (open EOD)",
  docsUrl: "https://tejhq.dev/docs",
  authMode: "none",
  // No environment variables: the open endpoints are keyless.
  requiredEnv: [],
  notes: [
    "Keyless open tier — no demat account, PAN, broker login, API key or paid plan is required.",
    "DAILY / EOD ONLY. Every price is the close of a completed session, labelled DELAYED (or HISTORICAL for candles). There is no intraday interval, no streaming feed and no live tick.",
    "Coverage: NSE bhavcopy from 2010-01-04, BSE from 2024-07-08, refreshed on trading days at 18:30 IST (21:30 IST retry). Today's session appears only after that refresh.",
    "Bhavcopy prices are not split/bonus adjusted; `adjusted` is reported as unknown and corporate actions are available separately at /v1/actions.",
    "Indices and non-equity instruments are not in the bhavcopy, so TejHQ cannot price them; those series stay on the labelled SAMPLE fallback.",
  ],
  capabilities: {
    instruments: {
      supported: true,
      note: "Full-market snapshot rows carry symbol, name and ISIN",
    },
    instrumentSync: {
      supported: true,
      note: "One snapshot request per exchange returns the whole bhavcopy symbol list",
    },
    quotes: {
      supported: true,
      note: "Latest completed session's close from the snapshot — EOD, always labelled DELAYED",
    },
    candles: {
      supported: true,
      intervals: ["1d"],
      note: "GET /v1/ohlcv/{exchange}/{symbol} — daily EOD bars only",
    },
    streaming: { supported: false, note: "No streaming feed; data is refreshed once per trading day" },
    fundamentals: { supported: false, note: "No fundamentals endpoints on the open tier" },
    marketStatus: { supported: false, note: "Session status is derived locally from IST exchange hours" },
  },
  isConfigured() {
    // Always available: this provider needs no credentials.
    return { configured: true, missing: [] };
  },
  fetchQuotes,
  fetchCandles,
  fetchInstrumentMaster,
  testConnection,
};
