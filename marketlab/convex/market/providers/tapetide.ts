/**
 * Tapetide API adapter (optional fundamentals provider).
 *
 * Documented contract implemented here:
 *  - Base URL https://api.tapetide.com/v1, `Authorization: Bearer tpt_rt_...`
 *  - Success `{ data, meta }`, error `{ error: { code, message } }`
 *  - GET /me/usage            quota snapshot (free, not counted)
 *  - GET /quotes?symbols=     up to 20 quotes for one request unit
 *  - GET /stocks/{symbol}/quote    LTP, change %, open/high/low, previous close,
 *                                  volume, market cap (INR crore), pe_ttm, 52-week range
 *  - GET /stocks/{symbol}/financials?section=&periods=
 *  - Free plan: 50 successful requests per IST day, 60 requests/minute burst.
 *
 * The documented price-history route exists but its request parameters were not
 * verifiable, so no candle capability is claimed here. Guessing them would risk
 * serving wrong series under a real provider label.
 */

import type {
  Fundamentals,
  MarketDataProvider,
  NormalizedInstrument,
  NormalizedQuote,
  ProviderEnv,
  TestConnectionResult,
} from "../types";
import { redactError, toFiniteNumber } from "../normalize";
import { fetchWithTimeout } from "../http";

const API_BASE = "https://api.tapetide.com/v1";

/** Documented free-tier limits. */
export const TAPETIDE_RATE_LIMIT_PER_MINUTE = 60;
export const TAPETIDE_DAILY_LIMIT = 50;

function token(env: ProviderEnv): string {
  return (env.TAPETIDE_API_TOKEN ?? "").trim();
}

interface Envelope<T> {
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  /** Plan/entitlement notice. Tapetide returns HTTP 200 with `data: null`. */
  notice?: { code?: string; message?: string; plan?: string };
}

/**
 * Authenticated GET against the Tapetide API. Exported so the research module
 * (`convex/market/research/tapetide.ts`) can reuse the same auth, redaction and
 * envelope handling instead of duplicating it.
 */
export async function tapetideRequest<T>(
  env: ProviderEnv,
  path: string
): Promise<{ meta: Record<string, unknown>; data: T }> {
  const apiToken = token(env);
  if (!apiToken) {
    throw new Error("Tapetide is not configured. Set TAPETIDE_API_TOKEN in the Convex deployment.");
  }
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiToken}`, Accept: "application/json" },
  });
  const text = await response.text();
  let body: Envelope<T>;
  try {
    body = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new Error(`Tapetide returned a non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok || body.error) {
    const code = body.error?.code ?? String(response.status);
    throw new Error(redactError(`Tapetide ${code}: ${body.error?.message ?? "request failed"}`));
  }
  if (body.notice) {
    // Verified 2026-11-12: the Free plan answers every REST route with HTTP 200,
    // `data: null` and this notice. Say so instead of "no data returned".
    throw new Error(
      redactError(
        `Tapetide ${body.notice.code ?? "notice"}: ${
          body.notice.message ?? "REST API access is not included in the current plan."
        }`
      )
    );
  }
  return { meta: body.meta ?? {}, data: body.data as T };
}

function tapetideSymbol(instrument: NormalizedInstrument): string {
  return instrument.providerIds.tapetide ?? instrument.symbol;
}

function mapQuote(
  instrument: NormalizedInstrument,
  record: Record<string, unknown>
): NormalizedQuote | null {
  const lastPrice = toFiniteNumber(record.price) ?? toFiniteNumber(record.last_price);
  if (lastPrice === null) return null;
  const changePercent = toFiniteNumber(record.change_pct);
  const previousClose =
    toFiniteNumber(record.previous_close) ?? toFiniteNumber(record.prev_close);
  const change =
    previousClose === null
      ? toFiniteNumber(record.change)
      : lastPrice - previousClose;
  const updatedAt = typeof record.updated_at === "string" ? Date.parse(record.updated_at) : NaN;

  return {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    lastPrice,
    change: change ?? null,
    changePercent:
      changePercent ?? (change !== null && previousClose ? (change / previousClose) * 100 : null),
    open: toFiniteNumber(record.open),
    high: toFiniteNumber(record.high),
    low: toFiniteNumber(record.low),
    previousClose,
    volume: toFiniteNumber(record.volume),
    bid: null,
    ask: null,
    quoteTime: Number.isNaN(updatedAt) ? null : updatedAt,
    source: "tapetide",
    // Tapetide's quote document is a snapshot updated on its own cadence, not a
    // live tick stream, so it is never presented as LIVE.
    mode: "DELAYED",
  };
}

async function fetchQuotes(
  env: ProviderEnv,
  instruments: NormalizedInstrument[]
): Promise<NormalizedQuote[]> {
  const quotes: NormalizedQuote[] = [];
  for (let i = 0; i < instruments.length; i += 20) {
    const batch = instruments.slice(i, i + 20);
    const symbols = batch.map(tapetideSymbol).join(",");
    const { data } = await tapetideRequest<unknown>(
      env,
      `/quotes?symbols=${encodeURIComponent(symbols)}`
    );
    const records: Record<string, unknown>[] = Array.isArray(data)
      ? (data as Record<string, unknown>[])
      : typeof data === "object" && data !== null
        ? Object.values(data as Record<string, unknown>).filter(
            (value): value is Record<string, unknown> =>
              typeof value === "object" && value !== null
          )
        : [];
    for (const record of records) {
      const symbol = String(record.symbol ?? "");
      const instrument =
        batch.find((candidate) => tapetideSymbol(candidate) === symbol) ??
        (records.length === 1 ? batch[0] : undefined);
      if (!instrument) continue;
      const mapped = mapQuote(instrument, record);
      if (mapped) quotes.push(mapped);
    }
  }
  return quotes;
}

async function fetchFundamentals(
  env: ProviderEnv,
  instrument: NormalizedInstrument
): Promise<Fundamentals> {
  const symbol = encodeURIComponent(tapetideSymbol(instrument));
  const [quote, financials] = await Promise.all([
    tapetideRequest<Record<string, unknown>>(env, `/stocks/${symbol}/quote`),
    tapetideRequest<Record<string, unknown>>(
      env,
      `/stocks/${symbol}/financials?periods=8`
    ).catch(() => null),
  ]);

  const sections: { name: string; periodCount: number }[] = [];
  const payload = financials?.data;
  if (payload && typeof payload === "object") {
    for (const [name, value] of Object.entries(payload as Record<string, unknown>)) {
      const section = value as { periods?: unknown[] } | undefined;
      if (section && Array.isArray(section.periods)) {
        sections.push({ name, periodCount: section.periods.length });
      }
    }
  }

  const record = quote.data ?? {};
  return {
    symbol: tapetideSymbol(instrument),
    source: "tapetide",
    mode: "DELAYED",
    fetchedAt: Date.now(),
    asOf: typeof financials?.meta?.as_of === "string" ? financials.meta.as_of : null,
    peTtm: toFiniteNumber(record.pe_ttm),
    // Tapetide reports market capitalisation in INR crore.
    marketCapCrore: toFiniteNumber(record.market_cap),
    high52w: toFiniteNumber(record.high_52w),
    low52w: toFiniteNumber(record.low_52w),
    sections,
  };
}

async function testConnection(env: ProviderEnv): Promise<TestConnectionResult> {
  const { configured, missing } = provider.isConfigured(env);
  if (!configured) {
    return { ok: false, message: `Not configured — missing ${missing.join(", ")}`, latencyMs: 0 };
  }
  const startedAt = Date.now();
  try {
    // Probe the MCP research surface, not REST: the Free plan answers every REST
    // route with `api_access_not_in_plan` while research works over MCP
    // (verified 2026-11-12). One small profile call per explicit test.
    const { callTapetideMcp } = await import("../research/tapetideMcp");
    const payload = await callTapetideMcp(env, "get_company_profile", { symbol: "ITC" });
    const latencyMs = Date.now() - startedAt;
    const company = (payload.data as { company?: { name?: unknown } } | undefined)?.company;
    return {
      ok: true,
      latencyMs,
      message: `MCP research reachable — profile returned for ${
        typeof company?.name === "string" ? company.name : "ITC"
      }. REST API access is not included in the current Tapetide plan.`,
      detail: "get_company_profile · https://mcp.tapetide.com/mcp",
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
  id: "tapetide",
  label: "Tapetide",
  docsUrl: "https://developers.tapetide.com/",
  authMode: "api_token",
  requiredEnv: ["TAPETIDE_API_TOKEN"],
  notes: [
    "Research is read through Tapetide's MCP server. Its REST API is not included in the Free plan (verified 2026-11-12).",
    "Tapetide terms prohibit redistribution and commercial exploitation without permission, so this provider is restricted to development use until written permission is obtained.",
    "Quotes are snapshots with their own update cadence and are always labelled DELAYED, never LIVE.",
  ],
  capabilities: {
    instruments: { supported: true, note: "GET /stocks?q= symbol search" },
    instrumentSync: {
      supported: false,
      note: "No bulk instrument master is documented; import a CSV or sync from FYERS",
    },
    quotes: { supported: true, note: "GET /quotes (20 symbols) — snapshot prices, labelled DELAYED" },
    candles: {
      supported: false,
      note: "A price-history route exists but its request parameters could not be verified, so no candles are requested",
    },
    streaming: { supported: false, note: "No streaming feed documented" },
    fundamentals: {
      supported: true,
      note: "Company profile, ratios, annual/quarterly statements, shareholding, news and corporate actions via MCP",
    },
    marketStatus: { supported: false, note: "Session status is derived locally from IST exchange hours" },
  },
  isConfigured(env) {
    const value = token(env);
    return { configured: value.length > 0, missing: value ? [] : ["TAPETIDE_API_TOKEN"] };
  },
  fetchQuotes,
  fetchFundamentals,
  testConnection,
};

export function tapetideStatus(env: ProviderEnv) {
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
