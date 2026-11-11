/**
 * Normalization, validation and freshness rules shared by every provider.
 *
 * Provider responses are never trusted as-is: numbers are coerced and checked,
 * duplicates are collapsed, ordering is enforced, and the freshness label is
 * derived from the data's own timestamp (not from "the request succeeded").
 */

import type {
  DataMode,
  Interval,
  NormalizedCandle,
  NormalizedQuote,
  ProviderId,
} from "./types";
import { INTERVAL_MS } from "./types";
import { isFresh } from "./time";

export interface RejectedRow {
  index: number;
  reason: string;
}

export interface NormalizeResult {
  candles: NormalizedCandle[];
  rejected: RejectedRow[];
  duplicatesRemoved: number;
}

/** Coerces provider junk (strings, "" and null) into a finite number or null. */
export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Returns an error message when a candle is structurally invalid. */
export function validateCandle(candle: NormalizedCandle): string | null {
  if (!Number.isFinite(candle.ts) || candle.ts <= 0) return "invalid timestamp";
  const { open, high, low, close } = candle;
  for (const [name, value] of Object.entries({ open, high, low, close })) {
    if (!Number.isFinite(value) || value <= 0) return `invalid ${name}`;
  }
  if (high < low) return "high below low";
  if (high < Math.max(open, close)) return "high below open/close";
  if (low > Math.min(open, close)) return "low above open/close";
  if (candle.volume !== null && (!Number.isFinite(candle.volume) || candle.volume < 0)) {
    return "invalid volume";
  }
  return null;
}

/**
 * Validates, de-duplicates (keeping the last occurrence of a timestamp, which is
 * the more recent correction) and sorts candles ascending by time.
 */
export function normalizeCandles(candles: NormalizedCandle[]): NormalizeResult {
  const rejected: RejectedRow[] = [];
  const byTimestamp = new Map<number, NormalizedCandle>();

  candles.forEach((candle, index) => {
    const problem = validateCandle(candle);
    if (problem) {
      rejected.push({ index, reason: problem });
      return;
    }
    byTimestamp.set(candle.ts, candle);
  });

  const duplicatesRemoved = candles.length - rejected.length - byTimestamp.size;
  const sorted = [...byTimestamp.values()].sort((a, b) => a.ts - b.ts);
  return { candles: sorted, rejected, duplicatesRemoved };
}

/**
 * A daily series only has bars on exchange sessions, so a weekend or a festival
 * cluster is not missing data. Holes of five or more calendar days (four or more
 * absent sessions) are reported; shorter breaks are assumed to be non-trading
 * periods. A single absent weekday cannot be distinguished from a holiday, so it
 * is deliberately not claimed as a gap.
 */
export const DAILY_GAP_MIN_MISSING_BUCKETS = 4;

/** Detects missing buckets between the first and last candle in a range. */
export function findGaps(
  candles: NormalizedCandle[],
  interval: Interval
): { count: number; firstFew: number[] } {
  if (candles.length < 2) return { count: 0, firstFew: [] };
  const step = INTERVAL_MS[interval];
  // Weekly/monthly buckets are calendar based; gap detection is daily-resolution
  // and finer only, so coarser intervals report no gaps rather than false ones.
  if (interval === "1w" || interval === "1M") return { count: 0, firstFew: [] };
  const firstFew: number[] = [];
  let count = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const delta = candles[i].ts - candles[i - 1].ts;
    const missing = Math.round(delta / step) - 1;
    if (missing <= 0) continue;
    if (interval === "1d" && missing < DAILY_GAP_MIN_MISSING_BUCKETS) continue;
    count += missing;
    if (firstFew.length < 5) firstFew.push(candles[i - 1].ts + step);
  }
  return { count, firstFew };
}

export interface QuoteModeInput {
  source: ProviderId | "sample";
  /** Provider-stated freshness, when the provider declares delayed data. */
  providerMode?: "LIVE" | "DELAYED";
  quoteTime: number | null;
  fetchedAt: number;
  nowMs: number;
  ttlMs: number;
  marketOpen: boolean;
  /** Maximum age of a tick that may still be called LIVE. */
  maxLiveAgeMs: number;
}

/**
 * Decides the freshness label for a quote.
 *
 * Rules, in order:
 *  - sample data is always SAMPLE
 *  - providers that declare delayed data are never labelled LIVE
 *  - a cache entry older than its TTL is CACHED
 *  - outside exchange hours the last trade is CACHED (it cannot be "live")
 *  - a tick older than `maxLiveAgeMs` is DELAYED
 *  - anything else is LIVE
 */
export function classifyQuoteMode(input: QuoteModeInput): DataMode {
  if (input.source === "sample") return "SAMPLE";
  if (input.providerMode === "DELAYED") return "DELAYED";
  if (!isFresh(input.fetchedAt, input.nowMs, input.ttlMs)) return "CACHED";
  if (!input.marketOpen) return "CACHED";
  if (input.quoteTime === null || !Number.isFinite(input.quoteTime)) return "DELAYED";
  const age = input.nowMs - input.quoteTime;
  if (age < 0) return "DELAYED";
  return age <= input.maxLiveAgeMs ? "LIVE" : "DELAYED";
}

/** Mode for a historical candle series. */
export function classifyCandleMode(source: ProviderId | "sample"): DataMode {
  return source === "sample" ? "SAMPLE" : "HISTORICAL";
}

/**
 * Removes credentials, tokens and query strings from provider error text before
 * it is stored or displayed. Anything that looks like a secret is replaced.
 */
export function redactError(error: unknown, maxLength = 300): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return "Unknown error";
            }
          })();

  // Only redact a key's value when it is bound with `=`/`:` or is long enough to
  // be a real credential. Blindly eating the next word after "token" turned
  // useful sentences ("access token has expired") into "token=<redacted>".
  const redacted = raw
    .replace(
      /(access_token|refresh_token|session_token|token|secret|appsecret|app_secret|checksum|authorization|api[_-]?key)([=:]\s*|\s+)([^\s"',&}]+)/gi,
      (match, key: string, separator: string, value: string) => {
        const bound = separator.includes("=") || separator.includes(":");
        // A bare word after "token" is only treated as a credential when it is
        // long enough to be one ("has", "expired", "invalid" stay readable).
        return bound || value.length >= 8 ? `${key}${separator}<redacted>` : match;
      }
    )
    .replace(/(https?:\/\/[^?\s]+)\?[^\s]+/gi, "$1?<redacted-query>")
    .replace(/\s+/g, " ")
    .trim();

  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

/** Normalizes a provider quote into the internal shape. */
export function normalizeQuote(
  input: Omit<NormalizedQuote, "quoteTime" | "mode"> & { quoteTime: number | null },
  mode: DataMode
): NormalizedQuote {
  const lastPrice = toFiniteNumber(input.lastPrice);
  if (lastPrice === null) throw new Error("Quote is missing a last traded price");
  const previousClose = toFiniteNumber(input.previousClose);
  const change =
    toFiniteNumber(input.change) ??
    (previousClose === null ? null : lastPrice - previousClose);
  const changePercent =
    toFiniteNumber(input.changePercent) ??
    (previousClose === null || previousClose === 0
      ? null
      : ((lastPrice - previousClose) / previousClose) * 100);

  return {
    ...input,
    lastPrice,
    previousClose,
    change,
    changePercent,
    mode,
  };
}
