import { istDateString, istDateTimeString, istTimeString } from "@quant/time";
import type { DataMode, Interval } from "./marketClient";

/** INR price. Sample data uses the same formatter so labels stay consistent. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Rupee amount with the ₹ symbol, e.g. `₹1,00,000.00`. */
export function formatInr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Rupee amount with an explicit + or − sign, for P&L figures. */
export function formatSignedInr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${Math.abs(value).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatSigned(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

/** Indian numbering: 12.34 L, 4.56 Cr. */
export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (value >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)} K`;
  return value.toLocaleString("en-IN");
}

export function formatMarketCapCrore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)} L Cr`;
  return `₹${value.toLocaleString("en-IN")} Cr`;
}

export const isStale = (
  asOf: number | null | undefined,
  now: number,
  ttlMs = 180_000
): boolean => asOf === null || asOf === undefined || now - asOf > ttlMs;

/** "3s ago", "12m ago", "2h ago". */
export function formatAge(asOf: number | null | undefined, now: number): string {
  if (asOf === null || asOf === undefined) return "unknown";
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

export function toneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "text-gray-300";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-red-400";
  return "text-gray-300";
}

export function signGlyph(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return "";
  return value > 0 ? "▲" : "▼";
}
