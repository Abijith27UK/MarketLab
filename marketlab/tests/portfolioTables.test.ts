import { describe, expect, it } from "vitest";
import {
  filterLedger,
  filterOrders,
  sortOrders,
  sortPositions,
  sortWatchlistRows,
  toggleSort,
  type WatchlistRow,
} from "../src/lib/tableSort";
import type { PaperLedgerRow, PaperOrderRow, PaperPosition } from "../src/lib/paperTypes";

const position = (
  symbol: string,
  quantity: number,
  averageCost: number,
  marketValue: number,
  unrealizedPnl: number
): PaperPosition =>
  ({
    instrumentId: `NSE:${symbol}:EQUITY`,
    symbol,
    name: symbol,
    exchange: "NSE",
    instrumentType: "EQUITY",
    quantity,
    averageCost,
    price: marketValue / Math.max(1, quantity),
    marketValue,
    unrealizedPnl,
    unrealizedPercent: 0,
    costBasis: averageCost * quantity,
    mode: "SAMPLE",
    source: "sample",
  }) as unknown as PaperPosition;

const positions: PaperPosition[] = [
  position("TCS", 4, 3000, 12_000, 400),
  position("INFY", 10, 1000, 11_000, -250),
  position("RELIANCE", 6, 2000, 15_000, 900),
];

const order = (
  id: string,
  symbol: string,
  status: PaperOrderRow["status"],
  quantity: number,
  createdAt: number
): PaperOrderRow =>
  ({
    _id: id,
    symbol,
    instrumentId: `NSE:${symbol}:EQUITY`,
    status,
    quantity,
    createdAt,
  }) as unknown as PaperOrderRow;

const orders: PaperOrderRow[] = [
  order("o1", "TCS", "FILLED", 4, 300),
  order("o2", "INFY", "OPEN", 10, 100),
  order("o3", "RELIANCE", "REJECTED", 6, 200),
];

describe("Portfolio sorting", () => {
  it("sorts positions by market value descending when asked", () => {
    const rows = sortPositions(positions, "value", -1);
    expect(rows.map((row) => row.symbol)).toEqual(["RELIANCE", "TCS", "INFY"]);
  });

  it("sorts positions by unrealised P&L ascending", () => {
    const rows = sortPositions(positions, "pnl", 1);
    expect(rows.map((row) => row.symbol)).toEqual(["INFY", "TCS", "RELIANCE"]);
  });

  it("does not mutate the input array", () => {
    const copy = [...positions];
    sortPositions(positions, "symbol", 1);
    expect(positions.map((p) => p.symbol)).toEqual(copy.map((p) => p.symbol));
  });

  it("toggles direction only for the same column", () => {
    expect(toggleSort({ key: "value", dir: 1 }, "value")).toEqual({ key: "value", dir: -1 });
    expect(toggleSort({ key: "value", dir: -1 }, "pnl")).toEqual({ key: "pnl", dir: 1 });
  });
});

describe("Orders filtering and sorting", () => {
  it("filters by status and keeps every state when ALL", () => {
    expect(filterOrders(orders, "OPEN").map((row) => row._id)).toEqual(["o2"]);
    expect(filterOrders(orders, "ALL").length).toBe(3);
    expect(filterOrders(orders, "CANCELLED")).toEqual([]);
  });

  it("sorts orders by placed time in either direction", () => {
    expect(sortOrders(orders, "placed", 1).map((row) => row._id)).toEqual(["o2", "o3", "o1"]);
    expect(sortOrders(orders, "placed", -1).map((row) => row._id)).toEqual(["o1", "o3", "o2"]);
  });

  it("sorts orders by symbol", () => {
    expect(sortOrders(orders, "symbol", 1).map((row) => row.symbol)).toEqual([
      "INFY",
      "RELIANCE",
      "TCS",
    ]);
  });
});

describe("Ledger filtering", () => {
  const entries = [
    { _id: "l1", kind: "BUY" },
    { _id: "l2", kind: "SELL" },
  ] as unknown as PaperLedgerRow[];

  it("filters by side", () => {
    expect(filterLedger(entries, "BUY").map((entry) => entry._id)).toEqual(["l1"]);
    expect(filterLedger(entries, "SELL").map((entry) => entry._id)).toEqual(["l2"]);
    expect(filterLedger(entries, "ALL").length).toBe(2);
  });
});

describe("Watchlist sorting", () => {
  const row = (
    itemId: string,
    symbol: string,
    price: number | null,
    changePercent: number | null,
    addedAt: number
  ): WatchlistRow => ({
    itemId,
    instrumentId: `NSE:${symbol}:EQUITY`,
    symbol,
    name: symbol,
    exchange: "NSE",
    price,
    changePercent,
    addedAt,
  });

  const rows = [
    row("w1", "TCS", 3900, 0.5, 20),
    row("w2", "INFY", 1500, -1.2, 10),
    row("w3", "RELIANCE", null, null, 30),
  ];

  it("sorts by symbol", () => {
    expect(sortWatchlistRows(rows, "symbol", 1).map((r) => r.symbol)).toEqual([
      "INFY",
      "RELIANCE",
      "TCS",
    ]);
  });

  it("sorts by price and keeps missing prices last in both directions", () => {
    expect(sortWatchlistRows(rows, "price", 1).map((r) => r.symbol)).toEqual([
      "INFY",
      "TCS",
      "RELIANCE",
    ]);
    expect(sortWatchlistRows(rows, "price", -1).map((r) => r.symbol)).toEqual([
      "TCS",
      "INFY",
      "RELIANCE",
    ]);
  });

  it("sorts by change percentage", () => {
    expect(sortWatchlistRows(rows, "change", -1).map((r) => r.symbol)).toEqual([
      "TCS",
      "INFY",
      "RELIANCE",
    ]);
  });

  it("sorts by the date added", () => {
    expect(sortWatchlistRows(rows, "added", 1).map((r) => r.symbol)).toEqual([
      "INFY",
      "TCS",
      "RELIANCE",
    ]);
  });
});
