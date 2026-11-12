import { istDateString, istDateTimeString, istTimeString } from "@quant/time";
import type { DataMode, Interval } from "./marketClient";

/**
 * Single source of truth for financial formatting.
 *
 * Every figure in the UI goes through these helpers, so the ₹ symbol, Indian
 * digit grouping and the 2-decimal price precision are decided in one place.
 * `Intl.NumberFormat("en-IN")` instances are created once — they are expensive
 * to construct and a dashboard can format dozens of values per render.
 */
const INR_AMOUNT = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Whole rupees — headline amounts such as the virtual starting balance. */
const INR_WHOLE = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** True only for values that can be rendered as a number. */
export const isFiniteNumber = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value);

/** INR price without the symbol, e.g. `1,23,456.78`. */
export function formatPrice(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  return INR_AMOUNT.format(value);
}

/** Rupee amount with the ₹ symbol, e.g. `₹1,00,000.00`. */
export function formatInr(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  return `₹${INR_AMOUNT.format(value)}`;
}

/** Rupee amount with an explicit + or − sign, for P&L figures. */
/** Whole-rupee amount, e.g. `₹1,00,000` — for headline balances. */
export function formatInrWhole(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  return `₹${INR_WHOLE.format(value)}`;
}

export function formatSignedInr(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${INR_AMOUNT.format(Math.abs(value))}`;
}

/** Percentage with an explicit + for gains; negatives keep their minus. */
export function formatPercent(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Absolute change with an explicit + for gains. */
export function formatSigned(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

/** Indian numbering: 12.34 L, 4.56 Cr. */
export function formatVolume(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  if (value >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (value >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)} K`;
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
}

export function formatMarketCapCrore(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return "—";
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)} L Cr`;
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value)} Cr`;
}

export const isStale = (
  asOf: number | null | undefined,
  now: number,
  ttlMs = 180_000
): boolean => asOf === null || asOf === undefined || now - asOf > ttlMs;

/** "3s ago", "12m ago", "2h ago". */
export function formatAge(asOf: number | null | undefined, now: number): string {
  if (asOf === null || asOf === undefined || !Number.isFinite(asOf)) return "unknown";
  const seconds = Math.max(0, Math.round((now - asOf) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Timestamp label: intraday intervals show time, daily and coarser show the date. */
export function formatTimestamp(ts: number | null | undefined, interval?: Interval): string {
  if (ts === null || ts === undefined) return "—";
  if (interval && (interval === "1m" || interval === "5m" || interval === "15m" || interval === "1h")) {
    return `${istDateString(ts)} ${istTimeString(ts)} IST`;
  }
  return `${istDateString(ts)} IST`;
}

export function formatDateTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return "—";
  return `${istDateTimeString(ts)} IST`;
}

export function modeDescription(mode: DataMode): string {
  switch (mode) {
    case "LIVE":
      return "Provider tick received during the exchange session";
    case "DELAYED":
      return "Provider data that is not a live tick (delayed or snapshot feed)";
    case "CACHED":
      return "Stored value from an earlier request — not currently live";
    case "HISTORICAL":
      return "Historical series, not a current quote";
    case "SAMPLE":
      return "Generated sample data — not real market data";
    default:
      return "Unknown freshness";
  }
}

/* --------------------------------------------------------------- movement */

export type Tone = "up" | "down" | "flat" | "none";

/**
 * Classifies a movement once. Every component derives both its wording and its
 * colour from this, so "up" can never be green in one place and red in another.
 */
export function toneOf(value: number | null | undefined): Tone {
  if (!isFiniteNumber(value)) return "none";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

/** Semantic token class (`--pos` / `--neg` / neutral) for new components. */
export function toneToken(value: number | null | undefined): string {
  return `ml-tone--${toneOf(value)}`;
}

/**
 * Legacy Tailwind colour class still used by pages that have not been migrated
 * to the design-system tokens. Kept delegating to `toneOf` so the decision
 * stays in one place.
 */
export function toneClass(value: number | null | undefined): string {
  switch (toneOf(value)) {
    case "up":
      return "text-emerald-400";
    case "down":
      return "text-red-400";
    default:
      return "text-gray-300";
  }
}

export function signGlyph(value: number | null | undefined): string {
  const tone = toneOf(value);
  if (tone === "up") return "▲";
  if (tone === "down") return "▼";
  return "";
}
