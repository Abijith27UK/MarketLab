import type { PaperLedgerRow, PaperOrderRow, PaperPosition } from "./paperTypes";

/**
 * Sorting and filtering helpers for the portfolio and watchlist tables.
 *
 * They are pure functions rather than inline comparators so the ordering rules
 * (missing values last, ties broken by symbol) are testable and identical across
 * pages.
 */

export type SortDir = 1 | -1;

export interface SortState<Key extends string> {
  key: Key;
  dir: SortDir;
}

/** Flips direction when the same column is re-selected, otherwise starts ascending. */
export function toggleSort<Key extends string>(
  current: SortState<Key>,
  key: Key
): SortState<Key> {
  if (current.key !== key) return { key, dir: 1 };
  return { key, dir: current.dir === 1 ? -1 : 1 };
}

/** Missing numbers always sort last regardless of direction. */
function compareNumbers(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

export type PositionSortKey = "symbol" | "quantity" | "averageCost" | "value" | "pnl";

export function sortPositions(
  positions: PaperPosition[],
  key: PositionSortKey,
  dir: SortDir
): PaperPosition[] {
  const rows = [...positions];
  rows.sort((a, b) => {
    switch (key) {
      case "quantity":
        return compareNumbers(a.quantity, b.quantity, dir);
      case "averageCost":
        return compareNumbers(a.averageCost, b.averageCost, dir);
      case "value":
        return compareNumbers(a.marketValue, b.marketValue, dir);
      case "pnl":
        return compareNumbers(a.unrealizedPnl, b.unrealizedPnl, dir);
      default:
        return a.symbol.localeCompare(b.symbol) * dir;
    }
  });
  return rows;
}

export type OrderSortKey = "placed" | "symbol" | "quantity" | "status";
export type OrderStatusFilter = "ALL" | PaperOrderRow["status"];

export function filterOrders(
  orders: PaperOrderRow[],
  status: OrderStatusFilter
): PaperOrderRow[] {
  if (status === "ALL") return orders;
  return orders.filter((order) => order.status === status);
}

export function sortOrders(
  orders: PaperOrderRow[],
  key: OrderSortKey,
  dir: SortDir
): PaperOrderRow[] {
  const rows = [...orders];
  rows.sort((a, b) => {
    switch (key) {
      case "symbol":
        return (a.symbol ?? a.instrumentId).localeCompare(b.symbol ?? b.instrumentId) * dir;
      case "quantity":
        return compareNumbers(a.quantity, b.quantity, dir);
      case "status":
        return a.status.localeCompare(b.status) * dir;
      default:
        return (a.createdAt - b.createdAt) * dir;
    }
  });
  return rows;
}

export function filterLedger(entries: PaperLedgerRow[], side: "ALL" | "BUY" | "SELL"): PaperLedgerRow[] {
  if (side === "ALL") return entries;
  return entries.filter((entry) => entry.kind === side);
}

export type WatchlistSortKey = "symbol" | "price" | "change" | "added";

export interface WatchlistRow {
  itemId: string;
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string;
  price: number | null;
  changePercent: number | null;
  addedAt: number;
}

export function sortWatchlistRows(
  rows: WatchlistRow[],
  key: WatchlistSortKey,
  dir: SortDir
): WatchlistRow[] {
  const list = [...rows];
  list.sort((a, b) => {
    switch (key) {
      case "price":
        return compareNumbers(a.price, b.price, dir);
      case "change":
        return compareNumbers(a.changePercent, b.changePercent, dir);
      case "added":
        return compareNumbers(a.addedAt, b.addedAt, dir);
      default:
        return a.symbol.localeCompare(b.symbol) * dir;
    }
  });
  return list;
}
