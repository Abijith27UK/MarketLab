/**
 * NSE MCP adapter — experimental, private, informational quotes only.
 *
 * Official endpoints (per NSE MCP documentation):
 *  - current market: https://mcp.nseindia.in/cmmkt/mcp
 *  - historical bhavcopy: https://mcp.nseindia.in/bhavcopy/cm/mcp
 *
 * This adapter speaks the Model Context Protocol over Streamable HTTP:
 * `initialize` → `notifications/initialized` → `tools/list` → `tools/call`,
 * carrying the `Mcp-Session-Id` the server returns. Tool names and argument
 * names are NOT hard-coded: they are read from `tools/list` and validated
 * against each tool's discovered input schema before a call is made.
 *
 * Safety:
 *  - Disabled unless `NSE_MCP_POC_ENABLED=true` on the Convex deployment. When
 *    disabled no network request is attempted at all.
 *  - Never used for paper fills, alerts, portfolio valuation or backtests: only
 *    the quote views read it, and only after explicit user selection.
 *  - Responses are normalized conservatively; nothing is invented. A row with
 *    no usable price is dropped rather than guessed.
 *
 * Verification status: the client is implemented and unit-tested against a mock
 * transport. Live connectivity to mcp.nseindia.in has NOT been verified from
 * this environment (see docs/NSE_MCP_PROOF_OF_CONCEPT.md).
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
import { fetchWithTimeout } from "../http";
import { redactError, toFiniteNumber } from "../normalize";
import { nseIndexName } from "../indexCatalogue";

export const NSE_MCP_CMMKT_URL = "https://mcp.nseindia.in/cmmkt/mcp";
export const NSE_MCP_BHAVCOPY_URL = "https://mcp.nseindia.in/bhavcopy/cm/mcp";
export const NSE_MCP_FEATURE_FLAG = "NSE_MCP_POC_ENABLED";
/** Conservative keyless budget: the server is a shared public proof of concept. */
export const NSE_MCP_RATE_LIMIT_PER_MINUTE = 12;

const REQUEST_TIMEOUT_MS = 15_000;
/** Protocol revisions this client knows how to speak, newest first. */
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CLIENT_INFO = { name: "marketlab-nse-mcp-poc", version: "0.1.0" };
const MAX_TOOL_PAGES = 5;

/* ------------------------------------------------------------------ */
/* Feature flag                                                        */
/* ------------------------------------------------------------------ */

export function nseMcpEnabled(env: ProviderEnv): boolean {
  const raw = env[NSE_MCP_FEATURE_FLAG];
  return typeof raw === "string" && raw.trim().toLowerCase() === "true";
}

/* ------------------------------------------------------------------ */
/* Streamable HTTP transport                                           */
/* ------------------------------------------------------------------ */

interface JsonRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, { type?: string; description?: string; enum?: unknown[] }>;
    required?: string[];
  };
}

export interface McpSessionInfo {
  protocolVersion: string;
  serverInfo: { name?: string; version?: string } | null;
  sessionId: string | null;
  tools: McpTool[];
}

type FetchLike = (url: string, init: RequestInit, timeoutMs?: number) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses JSON or the SSE frames a Streamable HTTP server may return. */
async function readRpcResponse(response: Response): Promise<JsonRpcResponse | null> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!text.trim()) return null;

  if (contentType.includes("text/event-stream")) {
    let last: JsonRpcResponse | null = null;
    for (const frame of text.split(/\r?\n\r?\n/)) {
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        const parsed: unknown = JSON.parse(data);
        if (isRecord(parsed)) last = parsed as JsonRpcResponse;
      } catch {
        // A partial SSE frame is not a market-data failure; ignore it.
      }
    }
    return last;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? (parsed as JsonRpcResponse) : null;
  } catch {
    throw new Error(
      `NSE MCP returned a non-JSON response (HTTP ${response.status}, ${contentType || "unknown type"})`
    );
  }
}

/**
 * One MCP session. Instances are short-lived: connect, discover, call, close.
 * There is no background polling and no cached session across actions.
 */
export class NseMcpClient {
  private sessionId: string | null = null;
  private nextId = 1;
  private protocolVersion: string | null = null;

  constructor(
    private readonly url: string = NSE_MCP_CMMKT_URL,
    private readonly fetchImpl: FetchLike = fetchWithTimeout,
    /** Extra headers for token-authenticated MCP servers (e.g. Tapetide). */
    private readonly extraHeaders: Record<string, string> = {}
  ) {}

  private async post(
    body: Record<string, unknown>,
    expectId: number | null
  ): Promise<JsonRpcResponse | null> {
    const headers: Record<string, string> = {
      ...this.extraHeaders,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    if (this.protocolVersion) headers["MCP-Protocol-Version"] = this.protocolVersion;

    const response = await this.fetchImpl(
      this.url,
      { method: "POST", headers, body: JSON.stringify(body) },
      REQUEST_TIMEOUT_MS
    );

    const issuedSession = response.headers.get("mcp-session-id");
    if (issuedSession) this.sessionId = issuedSession;

    if (response.status === 202 || response.status === 204) return null;
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        redactError(
          `NSE MCP HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`
        )
      );
    }

    const payload = await readRpcResponse(response);
    if (!payload) return null;
    if (payload.error) {
      throw new Error(
        redactError(
          `NSE MCP error ${payload.error.code ?? ""}: ${payload.error.message ?? "tool call failed"}`
        )
      );
    }
    if (expectId !== null && payload.id !== undefined && payload.id !== expectId && payload.id !== null) {
      throw new Error("NSE MCP returned a response for a different request id");
    }
    return payload;
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const payload = await this.post({ jsonrpc: "2.0", id, method, params }, id);
    return payload?.result ?? null;
  }

  /** initialize → notifications/initialized, negotiating a known revision. */
  async initialize(): Promise<{ protocolVersion: string; serverInfo: McpSessionInfo["serverInfo"] }> {
    let lastError: unknown = null;
    for (const protocolVersion of PROTOCOL_VERSIONS) {
      try {
        const result = await this.request("initialize", {
          protocolVersion,
          capabilities: { tools: {} },
          clientInfo: CLIENT_INFO,
        });
        if (!isRecord(result)) throw new Error("NSE MCP initialize returned no result");
        const negotiated =
          typeof result.protocolVersion === "string" ? result.protocolVersion : protocolVersion;
        this.protocolVersion = negotiated;
        await this.post(
          { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
          null
        );
        return {
          protocolVersion: negotiated,
          serverInfo: isRecord(result.serverInfo)
            ? {
                name: typeof result.serverInfo.name === "string" ? result.serverInfo.name : undefined,
                version:
                  typeof result.serverInfo.version === "string"
                    ? result.serverInfo.version
                    : undefined,
              }
            : null,
        };
      } catch (error) {
        lastError = error;
        // Fall through to the previous revision only when the server rejected
        // the handshake itself, never to mask a network failure.
        const message = redactError(error);
        if (!/HTTP (400|4\d\d)|protocol|version/i.test(message)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("NSE MCP initialize failed");
  }

  /** tools/list with cursor pagination. Real names and schemas, never guessed. */
  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await this.request("tools/list", cursor ? { cursor } : {});
      if (!isRecord(result) || !Array.isArray(result.tools)) break;
      for (const raw of result.tools) {
        if (!isRecord(raw) || typeof raw.name !== "string") continue;
        tools.push({
          name: raw.name,
          description: typeof raw.description === "string" ? raw.description : undefined,
          inputSchema: isRecord(raw.inputSchema)
            ? (raw.inputSchema as McpTool["inputSchema"])
            : undefined,
        });
      }
      const next = isRecord(result) && typeof result.nextCursor === "string" ? result.nextCursor : null;
      if (!next) break;
      cursor = next;
    }
    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.request("tools/call", { name, arguments: args });
    if (isRecord(result) && result.isError === true) {
      const message = Array.isArray(result.content)
        ? result.content
            .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
            .join(" ")
        : "";
      throw new Error(redactError(`NSE MCP tool ${name} failed: ${message || "unknown tool error"}`));
    }
    return result;
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.fetchImpl(
        this.url,
        {
          method: "DELETE",
          headers: {
            "Mcp-Session-Id": this.sessionId,
            ...(this.protocolVersion ? { "MCP-Protocol-Version": this.protocolVersion } : {}),
          },
        },
        REQUEST_TIMEOUT_MS
      );
    } catch {
      // A session that cannot be closed is not a data failure.
    } finally {
      this.sessionId = null;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tool selection (schema-driven)                                      */
/* ------------------------------------------------------------------ */

const QUOTE_HINTS = /quote|price|ltp|snapshot|market.?data|ticker/i;
const SYMBOL_FIELDS = /symbol|ticker|scrip|instrument|security/i;

function propertiesOf(tool: McpTool): Record<string, { type?: string; enum?: unknown[] }> {
  return tool.inputSchema?.properties ?? {};
}

function symbolFieldOf(tool: McpTool): string | null {
  const properties = propertiesOf(tool);
  const names = Object.keys(properties);
  const exact = names.find((name) => /^(symbol|ticker|scrip|instrument)$/i.test(name));
  if (exact) return exact;
  return names.find((name) => SYMBOL_FIELDS.test(name)) ?? null;
}

/** Highest-scoring tool whose schema can carry a symbol. */
function pickQuoteTool(tools: McpTool[]): McpTool | null {
  const candidates = tools
    .filter((tool) => symbolFieldOf(tool) !== null)
    .map((tool) => {
      const text = `${tool.name} ${tool.description ?? ""}`;
      let score = QUOTE_HINTS.test(text) ? 2 : 0;
      if (/quote|ltp|price/i.test(tool.name)) score += 2;
      if (tool.inputSchema?.required?.includes(symbolFieldOf(tool) as string)) score += 1;
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.tool ?? null;
}

/** Index tools name the instrument in `indexName` / `index` / `name`, not `symbol`. */
function indexNameFieldOf(tool: McpTool): string | null {
  return (
    Object.keys(propertiesOf(tool)).find((name) => /^(indexname|index|name)$/i.test(name)) ?? null
  );
}

/** Highest-scoring tool that quotes a single index by name. */
function pickIndexQuoteTool(tools: McpTool[]): McpTool | null {
  return (
    tools
      .filter((tool) => indexNameFieldOf(tool) !== null)
      .map((tool) => {
        const text = `${tool.name} ${tool.description ?? ""}`;
        let score = 0;
        // `cm_get_index_quote` names the index; `cm_get_live_market_data` only
        // has an `index` argument for gainers/losers, so it scores lower.
        if (/index/i.test(tool.name)) score += 3;
        if (/quote|value|price/i.test(text)) score += 1;
        return { tool, score };
      })
      .filter((entry) => entry.score >= 3)
      .sort((a, b) => b.score - a.score)[0]?.tool ?? null
  );
}

function buildIndexArguments(tool: McpTool, indexName: string): Record<string, unknown> {
  const properties = propertiesOf(tool);
  const nameField = indexNameFieldOf(tool);
  const args: Record<string, unknown> = {};
  for (const name of tool.inputSchema?.required ?? []) {
    if (name === nameField) continue;
    const property = properties[name];
    const enumValues = Array.isArray(property?.enum) ? property.enum : [];
    if (enumValues.length > 0) args[name] = enumValues[0];
    else if (property?.type === "boolean") args[name] = false;
    else if (property?.type === "integer" || property?.type === "number") args[name] = 1;
  }
  if (nameField) args[nameField] = indexName;
  return args;
}

/** Builds arguments from the discovered schema: required fields plus the symbol. */
function buildArguments(tool: McpTool, symbol: string, exchange: Exchange): Record<string, unknown> {
  const properties = propertiesOf(tool);
  const symbolField = symbolFieldOf(tool);
  const required = new Set(tool.inputSchema?.required ?? []);
  const args: Record<string, unknown> = {};

  for (const [name, property] of Object.entries(properties)) {
    if (name === symbolField) continue;
    const enumValues = Array.isArray(property?.enum) ? property.enum : [];
    if (enumValues.length > 0) {
      // Constrained fields (exchange, series, market) are safe to fill even when
      // optional: the value is one the schema itself lists.
      const preferred =
        enumValues.find(
          (value) => typeof value === "string" && value.toUpperCase() === exchange
        ) ??
        enumValues.find((value) => typeof value === "string" && /^(EQ|CM)$/i.test(value));
      if (preferred !== undefined) args[name] = preferred;
      else if (required.has(name)) args[name] = enumValues[0];
      continue;
    }
    if (!required.has(name)) continue;
    if (property?.type === "boolean") args[name] = false;
    else if (property?.type === "integer" || property?.type === "number") args[name] = 1;
    else args[name] = exchange;
  }
  if (symbolField) args[symbolField] = symbol;
  return args;
}

/* ------------------------------------------------------------------ */
/* Response normalization                                              */
/* ------------------------------------------------------------------ */

const PRICE_KEYS = [
  "lastPrice",
  "lastTradedPrice",
  "ltp",
  "last",
  "close",
  "price",
  "last_price",
  "last_traded_price",
];
// Verified against a live `cm_get_stock_quote` payload: NSE returns
// `preClosePrice`, `lastTradedPrice`, `perChange` and `latestTimestamp`.
const PREV_CLOSE_KEYS = [
  "preClosePrice",
  "prevClosePrice",
  "previousClosePrice",
  "previousClose",
  "prevClose",
  "prev_close",
  "prevclose",
  "previous_close",
];
const CHANGE_KEYS = ["change", "netChange", "net_change"];
const CHANGE_PCT_KEYS = [
  "perChange",
  // Verified live on `cm_get_index_quote`: NSE spells it `percChange`.
  "percChange",
  "changePercent",
  "pChange",
  "pchange",
  "change_pct",
  "change_percent",
  "pctChange",
];
const OPEN_KEYS = ["open", "openPrice", "dayOpen"];
const HIGH_KEYS = ["high", "dayHigh", "highPrice"];
const LOW_KEYS = ["low", "dayLow", "lowPrice"];
const VOLUME_KEYS = ["volume", "totalTradedVolume", "tradedVolume", "qty"];
const TIME_KEYS = [
  // Provider-reported quote time first: `updatedAt` is the crawl time.
  "latestTimestamp",
  "timeVal",
  "nseTimestamp",
  "lastTradedTimestamp",
  "quoteTime",
  "timestamp",
  "lastUpdateTime",
  "lastTradedTime",
  "updateTime",
  "updatedAt",
  "time",
  "asOf",
  "date",
];
const SYMBOL_KEYS = ["symbol", "tradingSymbol", "ticker", "scrip", "securitySymbol"];

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toFiniteNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

function firstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/** `12-Nov-2026 13:23(:34)` — the form NSE uses for `nseTimestamp` / `timeVal`. */
function parseNseDate(text: string): number | null {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const iso = `${match[3]}-${month}-${match[1]}T${match[4]}:${match[5]}:${match[6] ?? "00"}+05:30`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Accepts epoch seconds, epoch milliseconds, ISO strings, `12-Nov-2026 13:23`
 * and the naive `YYYY-MM-DD HH:mm:ss` form NSE returns for `latestTimestamp`.
 *
 * A naive timestamp from an Indian exchange endpoint is IST, not the browser's
 * local zone: parsing it with `Date.parse` alone would shift it by the host
 * offset. Such values are pinned to +05:30 explicitly.
 */
export function parseQuoteTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const text = value.trim();
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const nseDate = parseNseDate(text);
    if (nseDate !== null) return nseDate;
    const naiveIst = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(text);
    const parsed = Date.parse(naiveIst ? `${text.replace(" ", "T")}+05:30` : text);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Depth-first search for the first object that carries a usable price. */
function findQuoteNode(value: unknown, symbol: string, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    let fallback: Record<string, unknown> | null = null;
    for (const item of value) {
      const found = findQuoteNode(item, symbol, depth + 1);
      if (!found) continue;
      const nodeSymbol = firstString(found, SYMBOL_KEYS);
      if (!nodeSymbol || nodeSymbol.toUpperCase().includes(symbol.toUpperCase())) return found;
      fallback = fallback ?? found;
    }
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const price = firstNumber(record, PRICE_KEYS);
  if (price !== null && price > 0) return record;
  for (const nested of Object.values(record)) {
    const found = findQuoteNode(nested, symbol, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Extracts text content an MCP tool may return instead of structured data. */
function textPayloads(result: unknown): unknown[] {
  if (!isRecord(result) || !Array.isArray(result.content)) return [];
  const payloads: unknown[] = [];
  for (const part of result.content) {
    if (!isRecord(part)) continue;
    if (typeof part.text !== "string") continue;
    const text = part.text.trim();
    if (!text) continue;
    try {
      payloads.push(JSON.parse(text));
    } catch {
      payloads.push(text);
    }
  }
  return payloads;
}

export function normalizeNseMcpQuote(
  result: unknown,
  instrument: NormalizedInstrument
): NormalizedQuote | null {
  const candidates: unknown[] = [result, ...textPayloads(result)];
  let node: Record<string, unknown> | null = null;
  for (const candidate of candidates) {
    node = findQuoteNode(candidate, instrument.symbol);
    if (node) break;
  }
  if (!node) return null;

  const lastPrice = firstNumber(node, PRICE_KEYS);
  if (lastPrice === null || lastPrice <= 0) return null;
  const previousClose = firstNumber(node, PREV_CLOSE_KEYS);
  const change = firstNumber(node, CHANGE_KEYS);
  const changePercent = firstNumber(node, CHANGE_PCT_KEYS);
  const derivedChange =
    change ?? (previousClose === null ? null : lastPrice - previousClose);
  const derivedPercent =
    changePercent ??
    (derivedChange === null || previousClose === null || previousClose === 0
      ? null
      : (derivedChange / previousClose) * 100);

  const timeNode = node[TIME_KEYS[0]] ?? null;
  const explicitTime = parseQuoteTime(timeNode);
  const fallbackTime =
    explicitTime ??
    TIME_KEYS.slice(1)
      .map((key) => parseQuoteTime(node[key]))
      .find((value) => value !== null) ??
    null;

  return {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    lastPrice,
    change: derivedChange,
    changePercent: derivedPercent,
    open: firstNumber(node, OPEN_KEYS),
    high: firstNumber(node, HIGH_KEYS),
    low: firstNumber(node, LOW_KEYS),
    previousClose,
    volume: firstNumber(node, VOLUME_KEYS),
    bid: null,
    ask: null,
    quoteTime: fallbackTime,
    source: "nsemcp",
    // NSE documents a 1–3 minute delay for this feed; it is never LIVE here.
    mode: "DELAYED",
  };
}

/* ------------------------------------------------------------------ */
/* Connection helpers                                                  */
/* ------------------------------------------------------------------ */

async function withSession<T>(
  url: string,
  work: (client: NseMcpClient, session: McpSessionInfo) => Promise<T>
): Promise<T> {
  const client = new NseMcpClient(url);
  try {
    const init = await client.initialize();
    const tools = await client.listTools();
    return await work(client, { ...init, sessionId: null, tools });
  } finally {
    await client.close();
  }
}

/* ------------------------------------------------------------------ */
/* Historical bhavcopy candles (verified 2026-11-12)                    */
/* ------------------------------------------------------------------ */

/**
 * The bhavcopy server documents `get_stock_history(symbol, months, endDate)`
 * returning up to ~3 months per call. Verified live on 2026-11-12: ITC returned
 * 63 daily rows with open/high/low/close/volume and ISO trading dates.
 */
export const NSE_BHAVCOPY_MAX_MONTHS_PER_CALL = 3;
/** Bounded total span; four calls maximum per chart request. */
export const NSE_BHAVCOPY_MAX_MONTHS = 12;

/**
 * Parses JSON from a text block that may carry a trailing server note.
 *
 * Tapetide appends `[TRUNCATED: …]` (and a narrowing hint) after the JSON when a
 * result exceeds its size budget, so a plain JSON.parse fails on an otherwise
 * valid document. Only the leading JSON object is kept; the note is not data.
 */
export function parseJsonPrefix(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    let end = text.lastIndexOf("}");
    for (let attempts = 0; end > 0 && attempts < 60; attempts += 1) {
      try {
        return JSON.parse(text.slice(0, end + 1));
      } catch {
        end = text.lastIndexOf("}", end - 1);
      }
    }
    return null;
  }
}

/** Unwraps `{content:[{type:"text",text:"<json>"}]}` into the JSON payload. */
export function unwrapMcpToolPayload(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw) && Array.isArray(raw.content)) {
    for (const item of raw.content) {
      if (isRecord(item) && typeof item.text === "string") {
        const parsed = parseJsonPrefix(item.text);
        if (isRecord(parsed)) return parsed;
      }
    }
  }
  return isRecord(raw) ? raw : null;
}

function istDateString(ms: number): string {
  return new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Validates and de-duplicates bhavcopy rows into chart candles.
 *
 * A bar is dropped unless every OHLC value is finite and internally consistent
 * (low ≤ open/close/high, high ≥ open/close/low). Dates come from the provider;
 * nothing is interpolated or shifted.
 */
export function normalizeBhavcopyRows(
  rows: unknown[],
  instrument: NormalizedInstrument
): NormalizedCandle[] {
  const byDate = new Map<string, NormalizedCandle>();

  for (const entry of rows) {
    if (!isRecord(entry)) continue;
    // Multiple series can share a symbol; prefer the EQ series for charts.
    const series = typeof entry.series === "string" ? entry.series.toUpperCase() : null;
    if (series && series !== "EQ") continue;

    const date = typeof entry.date === "string" ? entry.date.slice(0, 10) : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const open = toFiniteNumber(entry.open);
    const high = toFiniteNumber(entry.high);
    const low = toFiniteNumber(entry.low);
    const close = toFiniteNumber(entry.close);
    if (open === null || high === null || low === null || close === null) continue;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
    if (low > Math.min(open, close, high)) continue;
    if (high < Math.max(open, close, low)) continue;

    const volume = toFiniteNumber(entry.volume);
    const ts = Date.parse(`${date}T00:00:00+05:30`);
    if (!Number.isFinite(ts)) continue;

    byDate.set(date, {
      instrumentId: instrument.instrumentId,
      interval: "1d",
      ts,
      open,
      high,
      low,
      close,
      volume: volume !== null && volume >= 0 ? volume : null,
      source: "nsemcp",
      mode: "HISTORICAL",
      // Bhavcopy prices are unadjusted; corporate actions are reported separately.
      adjusted: "unknown",
    });
  }

  return [...byDate.values()].sort((a, b) => a.ts - b.ts);
}

function pickHistoryTool(tools: McpTool[]): McpTool | null {
  return (
    tools.find((tool) => tool.name === "get_stock_history") ??
    tools.find((tool) => /stock.*(history|ohlc|bhavcopy)/i.test(tool.name)) ??
    null
  );
}

function historyArguments(tool: McpTool, symbol: string, endDate: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const key of Object.keys(tool.inputSchema?.properties ?? {})) {
    if (/symbol|ticker|scrip|security/i.test(key)) args[key] = symbol;
    else if (/enddate|end_date/i.test(key)) args[key] = endDate;
    else if (key === "to" || key === "date") args[key] = endDate;
    else if (/months|period/i.test(key)) args[key] = NSE_BHAVCOPY_MAX_MONTHS_PER_CALL;
    else if (/series/i.test(key)) args[key] = "EQ";
  }
  return args;
}

async function fetchBhavcopyCandles(
  env: ProviderEnv,
  request: CandleRequest
): Promise<NormalizedCandle[]> {
  if (!nseMcpEnabled(env)) {
    throw new Error(
      "NSE MCP is disabled. Set NSE_MCP_POC_ENABLED=true on the Convex deployment to enable this private proof of concept."
    );
  }
  if (request.interval !== "1d") {
    throw new Error(
      "NSE Bhavcopy history is daily only. No verified intraday candle tool is exposed."
    );
  }
  if (request.instrument.instrumentType !== "EQUITY") {
    throw new Error("NSE Bhavcopy stock history covers equities only; indices are not served here.");
  }

  const requestedMonths = Math.ceil((request.toMs - request.fromMs) / (30 * 24 * 60 * 60 * 1000));
  const totalMonths = Math.min(
    Math.max(1, requestedMonths),
    NSE_BHAVCOPY_MAX_MONTHS
  );
  const endDate = istDateString(request.toMs);

  const client = new NseMcpClient(NSE_MCP_BHAVCOPY_URL);
  const rows: unknown[] = [];
  try {
    await client.initialize();
    const tools = await client.listTools();
    const tool = pickHistoryTool(tools);
    if (!tool) {
      throw new Error(
        `NSE Bhavcopy exposes no stock-history tool. Discovered: ${tools.map((entry) => entry.name).join(", ")}`
      );
    }

    for (let offset = 0; offset < totalMonths; offset += NSE_BHAVCOPY_MAX_MONTHS_PER_CALL) {
      // Each call is anchored on the chunk end so the server's `months` window
      // does not overlap the previous one unnecessarily.
      const chunkEndMs = request.toMs - offset * 30 * 24 * 60 * 60 * 1000;
      const chunkEnd = istDateString(chunkEndMs);
      const raw = await client.callTool(
        tool.name,
        historyArguments(tool, request.instrument.symbol, chunkEnd)
      );
      const payload = unwrapMcpToolPayload(raw);
      const data = payload && Array.isArray(payload.data) ? payload.data : [];
      rows.push(...data);
      if (data.length === 0) break;
    }
  } finally {
    await client.close();
  }

  return normalizeBhavcopyRows(rows, request.instrument);
}

/* ------------------------------------------------------------------ */
/* Provider entry points                                               */
/* ------------------------------------------------------------------ */

async function fetchQuotes(
  env: ProviderEnv,
  instruments: NormalizedInstrument[]
): Promise<NormalizedQuote[]> {
  if (!nseMcpEnabled(env)) {
    throw new Error(
      "NSE MCP is disabled. Set NSE_MCP_POC_ENABLED=true on the Convex deployment to enable this private proof of concept."
    );
  }
  if (instruments.length === 0) return [];

  // Indices are quoted by name, equities by symbol. They are fetched through
  // separate paths so a mixed batch never exhausts the per-symbol budget on
  // index calls, and so indices can use the bulk live-indices endpoint.
  const indexInstruments = instruments.filter((entry) => entry.instrumentType === "INDEX");
  const equityInstruments = instruments
    .filter((entry) => entry.instrumentType !== "INDEX")
    .slice(0, 12);

  const quotes: NormalizedQuote[] = [];
  if (indexInstruments.length > 0) {
    quotes.push(...(await fetchIndexQuotes(env, indexInstruments)));
  }
  if (equityInstruments.length === 0) return quotes;

  const client = new NseMcpClient();
  try {
    await client.initialize();
    const tools = await client.listTools();
    const equityTool = pickQuoteTool(tools);
    if (!equityTool) {
      const names = tools.map((entry) => entry.name).slice(0, 8).join(", ");
      throw new Error(
        `NSE MCP exposes no quote tool with a symbol argument. Discovered tools: ${names || "none"}.`
      );
    }

    for (const instrument of equityInstruments) {
      try {
        const raw = await client.callTool(
          equityTool.name,
          buildArguments(equityTool, instrument.symbol, instrument.exchange)
        );
        const quote = normalizeNseMcpQuote(raw, instrument);
        if (quote) quotes.push(quote);
      } catch {
        // One unsupported symbol must not discard the others; the caller shows
        // an explicit "no price" warning for whatever was not returned.
      }
    }
    return quotes;
  } finally {
    await client.close();
  }
}

/* ------------------------------------------------------------------ */
/* Market indices (bulk live indices, verified 2026-11-12)             */
/* ------------------------------------------------------------------ */

export interface NseIndexQuote {
  indexName: string;
  lastPrice: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  quoteTime: number | null;
}

/**
 * Trims a provider timestamp that is materially in the future.
 *
 * NSE occasionally reports a crawl time ahead of the caller's clock. Such a
 * value cannot describe a real quote age, so it is dropped instead of being
 * displayed as fresh — no replacement timestamp is manufactured.
 */
export function sanitizeQuoteTime(ms: number | null, nowMs = Date.now()): number | null {
  if (ms === null) return null;
  if (!Number.isFinite(ms)) return null;
  if (ms > nowMs + 5 * 60_000) return null;
  return ms;
}

/** Parses provider ISO timestamps, tolerating >3 fractional-second digits. */
export function parseIsoTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim().replace(/(\.\d{3})\d+/, "$1");
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Flattens `cm_get_live_indices` into one quote per index name.
 *
 * The payload is `{ nseTimestamp, updatedAt, indices: { group: [row] } }`;
 * rows carry `last`, `previousClose`, `change`, `percChange` and `timeVal`.
 * Duplicate names across groups keep their first, richest row.
 */
export function normalizeLiveIndices(payload: unknown): NseIndexQuote[] {
  if (!isRecord(payload) || !isRecord(payload.indices)) return [];
  const batchTime = sanitizeQuoteTime(parseQuoteTime(payload.nseTimestamp));
  const quotes: NseIndexQuote[] = [];
  const seen = new Set<string>();

  for (const rows of Object.values(payload.indices)) {
    if (!Array.isArray(rows)) continue;
    for (const entry of rows) {
      if (!isRecord(entry)) continue;
      const indexName = typeof entry.indexName === "string" ? entry.indexName.trim() : "";
      if (!indexName) continue;
      const key = indexName.toUpperCase();
      if (seen.has(key)) continue;
      const lastPrice = toFiniteNumber(entry.last);
      if (lastPrice === null || lastPrice <= 0) continue;
      seen.add(key);
      const previousClose = toFiniteNumber(entry.previousClose);
      const change = toFiniteNumber(entry.change);
      quotes.push({
        indexName,
        lastPrice,
        previousClose,
        change: change ?? (previousClose === null ? null : lastPrice - previousClose),
        changePercent:
          toFiniteNumber(entry.percChange) ??
          (change !== null && previousClose !== null && previousClose !== 0
            ? (change / previousClose) * 100
            : null),
        open: toFiniteNumber(entry.open),
        high: toFiniteNumber(entry.high),
        low: toFiniteNumber(entry.low),
        quoteTime: sanitizeQuoteTime(parseQuoteTime(entry.timeVal)) ?? batchTime,
      });
    }
  }
  return quotes;
}

function indexQuoteToNormalized(
  instrument: NormalizedInstrument,
  quote: NseIndexQuote
): NormalizedQuote {
  return {
    instrumentId: instrument.instrumentId,
    symbol: instrument.symbol,
    exchange: instrument.exchange,
    lastPrice: quote.lastPrice,
    change: quote.change,
    changePercent: quote.changePercent,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    previousClose: quote.previousClose,
    volume: null,
    bid: null,
    ask: null,
    quoteTime: quote.quoteTime,
    source: "nsemcp",
    mode: "DELAYED",
  };
}

/** Bulk index quotes; per-index fallback only for names the bulk result omits. */
async function fetchIndexQuotes(
  env: ProviderEnv,
  instruments: NormalizedInstrument[]
): Promise<NormalizedQuote[]> {
  if (!nseMcpEnabled(env)) {
    throw new Error(
      "NSE MCP is disabled. Set NSE_MCP_POC_ENABLED=true on the Convex deployment to enable this private proof of concept."
    );
  }
  if (instruments.length === 0) return [];

  const client = new NseMcpClient();
  try {
    await client.initialize();
    const tools = await client.listTools();
    const bulkTool = tools.find((tool) => tool.name === "cm_get_live_indices") ?? null;
    const singleTool = pickIndexQuoteTool(tools);

    const byName = new Map<string, NseIndexQuote>();
    if (bulkTool) {
      const args: Record<string, unknown> = {};
      for (const key of Object.keys(propertiesOf(bulkTool))) {
        if (/group/i.test(key)) args[key] = "all";
        else if (/filter/i.test(key)) args[key] = "";
      }
      try {
        const raw = await client.callTool(bulkTool.name, args);
        for (const quote of normalizeLiveIndices(unwrapMcpToolPayload(raw))) {
          byName.set(quote.indexName.toUpperCase(), quote);
        }
      } catch {
        // Fall through to per-index calls when the bulk endpoint fails.
      }
    }

    const quotes: NormalizedQuote[] = [];
    const missing: NormalizedInstrument[] = [];
    for (const instrument of instruments) {
      const match = byName.get(nseIndexName(instrument).toUpperCase());
      if (match) quotes.push(indexQuoteToNormalized(instrument, match));
      else missing.push(instrument);
    }

    for (const instrument of missing.slice(0, 6)) {
      if (!singleTool) break;
      try {
        const raw = await client.callTool(
          singleTool.name,
          buildIndexArguments(singleTool, nseIndexName(instrument))
        );
        const quote = normalizeNseMcpQuote(raw, instrument);
        if (quote) quotes.push(quote);
      } catch {
        // Leave the index without a quote rather than inventing one.
      }
    }
    return quotes;
  } finally {
    await client.close();
  }
}

/* ------------------------------------------------------------------ */
/* Official market movers (verified 2026-11-12)                        */
/* ------------------------------------------------------------------ */

export interface NseMarketMover {
  symbol: string;
  series: string;
  lastPrice: number;
  previousClose: number | null;
  change: number | null;
  changePercent: number;
  quoteTime: number | null;
}

export interface NseMarketMovers {
  tool: string;
  segment: string;
  universeLabel: string;
  gainersUpdatedAt: number | null;
  losersUpdatedAt: number | null;
  sessionDate: string | null;
  /** True when Gainers and Losers were crawled on different IST dates. */
  sessionMismatch: boolean;
  gainers: NseMarketMover[];
  losers: NseMarketMover[];
  droppedRows: number;
}

const MOVER_SERIES = "EQ";
const UNIVERSE_LABEL = "All NSE equities (EQ series)";

function segmentLabel(segment: string): string {
  return segment === "allSec" ? UNIVERSE_LABEL : `${segment} (EQ series)`;
}

/**
 * Normalizes `nse_get_market_movers` into two validated rankings.
 *
 * Observed payload (2026-11-12):
 * `{ segment: "allSec", gainersUpdatedAt, losersUpdatedAt, gainers: [...], losers: [...] }`
 * with rows `{ symbol, series, ltp, prev_price, net_price, perChange, ... }`.
 *
 * Rules: only EQ series rows, only finite positive percentages in Gainers and
 * finite negative ones in Losers, deduplicated, and sorted by the sign rule —
 * provider order is preserved when it already satisfies it. Nothing is padded:
 * a short list stays short.
 */
export function normalizeNseMarketMovers(
  payload: unknown,
  options: { limit?: number } = {}
): NseMarketMovers | null {
  if (!isRecord(payload)) return null;
  const limit = Math.max(1, Math.min(50, options.limit ?? 10));
  const rawGainers = Array.isArray(payload.gainers) ? payload.gainers : [];
  const rawLosers = Array.isArray(payload.losers) ? payload.losers : [];
  if (rawGainers.length === 0 && rawLosers.length === 0) return null;

  const segment = typeof payload.segment === "string" ? payload.segment : "allSec";
  const gainersUpdatedAt = sanitizeQuoteTime(parseIsoTimestamp(payload.gainersUpdatedAt));
  const losersUpdatedAt = sanitizeQuoteTime(parseIsoTimestamp(payload.losersUpdatedAt));
  const gainersDate = gainersUpdatedAt === null ? null : istDateString(gainersUpdatedAt);
  const losersDate = losersUpdatedAt === null ? null : istDateString(losersUpdatedAt);
  const sessionMismatch = Boolean(
    gainersDate && losersDate && gainersDate !== losersDate
  );
  const sessionDate = gainersDate ?? losersDate;

  const hasSeries = [...rawGainers, ...rawLosers].some(
    (row) => isRecord(row) && typeof row.series === "string"
  );
  const seen = new Set<string>();
  const gainers: NseMarketMover[] = [];
  const losers: NseMarketMover[] = [];
  let droppedRows = 0;

  const ingest = (rows: unknown[], direction: "gainers" | "losers") => {
    for (const entry of rows) {
      if (!isRecord(entry)) {
        droppedRows += 1;
        continue;
      }
      const symbol = typeof entry.symbol === "string" ? entry.symbol.trim().toUpperCase() : "";
      if (!symbol) {
        droppedRows += 1;
        continue;
      }
      const series = typeof entry.series === "string" ? entry.series.trim().toUpperCase() : "";
      if (hasSeries && series !== MOVER_SERIES) {
        // SME / trade-to-trade / bond series are a different universe.
        droppedRows += 1;
        continue;
      }
      const lastPrice = toFiniteNumber(entry.ltp) ?? toFiniteNumber(entry.lastPrice);
      const changePercent = toFiniteNumber(entry.perChange) ?? toFiniteNumber(entry.changePercent);
      if (lastPrice === null || lastPrice <= 0) {
        droppedRows += 1;
        continue;
      }
      if (changePercent === null || !Number.isFinite(changePercent)) {
        droppedRows += 1;
        continue;
      }
      const key = `${symbol}:${series}`;
      if (seen.has(key)) {
        droppedRows += 1;
        continue;
      }
      seen.add(key);

      const previousClose =
        toFiniteNumber(entry.prev_price) ??
        toFiniteNumber(entry.previousClose) ??
        toFiniteNumber(entry.prevClose);
      const change =
        toFiniteNumber(entry.net_price) ??
        toFiniteNumber(entry.change) ??
        (previousClose === null ? null : lastPrice - previousClose);
      const mover: NseMarketMover = {
        symbol,
        series: series || MOVER_SERIES,
        lastPrice,
        previousClose,
        change,
        changePercent,
        quoteTime: direction === "gainers" ? gainersUpdatedAt : losersUpdatedAt,
      };

      if (direction === "gainers") {
        if (changePercent > 0) gainers.push(mover);
        else droppedRows += 1;
      } else if (changePercent < 0) {
        losers.push(mover);
      } else {
        droppedRows += 1;
      }
    }
  };

  ingest(rawGainers, "gainers");
  ingest(rawLosers, "losers");
  gainers.sort((a, b) => b.changePercent - a.changePercent);
  losers.sort((a, b) => a.changePercent - b.changePercent);

  return {
    tool: "nse_get_market_movers",
    segment,
    universeLabel: segmentLabel(segment),
    gainersUpdatedAt,
    losersUpdatedAt,
    sessionDate,
    sessionMismatch,
    gainers: gainers.slice(0, limit),
    losers: losers.slice(0, limit),
    droppedRows,
  };
}

/**
 * Fetches the official NSE mover ranking (both directions, one session).
 * This is the only function allowed to produce Market Movers data.
 */
export async function fetchMarketMovers(
  env: ProviderEnv,
  options: { limit?: number } = {}
): Promise<NseMarketMovers> {
  if (!nseMcpEnabled(env)) {
    throw new Error(
      "NSE MCP is disabled. Set NSE_MCP_POC_ENABLED=true on the Convex deployment to enable official market movers."
    );
  }
  const limit = Math.max(1, Math.min(50, options.limit ?? 20));
  const client = new NseMcpClient();
  try {
    await client.initialize();
    const tools = await client.listTools();
    const tool = tools.find((entry) => entry.name === "nse_get_market_movers");
    if (!tool) {
      const names = tools.map((entry) => entry.name).slice(0, 10).join(", ");
      throw new Error(
        `NSE MCP exposes no nse_get_market_movers tool. Discovered: ${names || "none"}.`
      );
    }
    const args: Record<string, unknown> = {};
    for (const key of Object.keys(propertiesOf(tool))) {
      // Empty index name means ALL securities; limit is required and must not
      // be omitted (the server throws a NullPointerException when it is missing).
      if (/index/i.test(key)) args[key] = "";
      else if (/limit/i.test(key)) args[key] = limit;
    }
    const raw = await client.callTool(tool.name, args);
    const normalized = normalizeNseMarketMovers(unwrapMcpToolPayload(raw), { limit });
    if (!normalized) throw new Error("NSE MCP returned no market-mover rows for this session.");
    return normalized;
  } finally {
    await client.close();
  }
}

async function testConnection(env: ProviderEnv): Promise<TestConnectionResult> {
  const startedAt = Date.now();
  if (!nseMcpEnabled(env)) {
    return {
      ok: false,
      latencyMs: 0,
      message: `Disabled — set ${NSE_MCP_FEATURE_FLAG}=true on the Convex deployment to enable this private proof of concept.`,
    };
  }
  try {
    const session = await withSession(NSE_MCP_CMMKT_URL, async (_client, info) => info);
    const tool = pickQuoteTool(session.tools);
    return {
      ok: session.tools.length > 0,
      latencyMs: Date.now() - startedAt,
      message:
        session.tools.length === 0
          ? `Handshake succeeded (MCP ${session.protocolVersion}) but the server exposed no tools.`
          : `Handshake succeeded — MCP ${session.protocolVersion}, ${session.tools.length} tools discovered. Quote tool: ${tool?.name ?? "none matched"}.`,
      detail: session.tools.map((entry) => entry.name).slice(0, 20).join(", "),
    };
  } catch (error) {
    return { ok: false, latencyMs: Date.now() - startedAt, message: redactError(error) };
  }
}

export const provider: MarketDataProvider = {
  id: "nsemcp",
  label: "NSE MCP (experimental)",
  docsUrl: "https://www.nseindia.in/nse-mcp",
  authMode: "none",
  requiredEnv: [NSE_MCP_FEATURE_FLAG],
  notes: [
    "Private, experimental, informational proof of concept. Do not publish, redistribute or monetize this feed.",
    "NSE documents an approximately 1–3 minute delay on this market feed. Quotes are labelled DELAYED, never LIVE.",
    "Disabled by default: NSE_MCP_POC_ENABLED must be set to true on the deployment, and each user must select it explicitly.",
    "Never used for paper fills, alerts, portfolio valuation or backtests.",
    "Live-verified 2026-11-12: current-market quotes, bulk live indices (cm_get_live_indices), official market movers (nse_get_market_movers) and the bhavcopy get_stock_history tool (daily OHLCV, up to 3 months per call) all respond.",
    "Bhavcopy history is daily only, unadjusted for corporate actions, and capped at 12 months per chart request here. No intraday candle tool exists.",
    "Chart history is opt-in: selecting NSE Bhavcopy never changes the TejHQ default for backtests or other charts.",
  ],
  capabilities: {
    instruments: { supported: false, note: "Symbol discovery is not exposed as a documented listing tool" },
    instrumentSync: { supported: false, note: "No bulk master sync; the TejHQ bhavcopy seeds the catalogue" },
    quotes: {
      supported: true,
      note: "Discovered quote tool, one call per symbol, provider-delayed snapshot",
    },
    candles: {
      supported: true,
      intervals: ["1d"],
      note: "Daily OHLCV from the bhavcopy MCP server (get_stock_history, up to 3 months per call, 12-month cap). Unadjusted; no intraday tool exists.",
    },
    streaming: { supported: false, note: "No streaming; requests are on demand only" },
    fundamentals: { supported: false, note: "No fundamentals tool" },
    marketStatus: { supported: false, note: "Session status is derived locally from IST exchange hours" },
  },
  isConfigured(env) {
    if (!nseMcpEnabled(env)) {
      return { configured: false, missing: [NSE_MCP_FEATURE_FLAG] };
    }
    return { configured: true, missing: [] };
  },
  fetchQuotes,
  fetchCandles: fetchBhavcopyCandles,
  testConnection,
};
