/**
 * The paper-trading decision engine.
 *
 * Everything that decides *whether* an order fills, at *what* price, and what it
 * does to cash and cost basis lives here as pure functions. The Convex mutation
 * is a thin adapter that loads rows, calls `evaluateOrder`, and persists the
 * result inside one transaction.
 *
 * Order policy (documented, deliberately conservative)
 * ---------------------------------------------------
 * - MARKET orders fill at the side's reference price: the ask for buys, the bid
 *   for sells, falling back to the last price when the source has no book.
 *   No slippage, no brokerage, no taxes, no stamp duty — the simulation models
 *   price and nothing else.
 * - LIMIT orders fill immediately, at that same reference price, only when the
 *   reference already satisfies the limit (buy: reference ≤ limit, sell:
 *   reference ≥ limit). A fill therefore never breaches its limit.
 * - A limit that is not satisfied rests as `OPEN`. It is never filled by a
 *   background job, because the simulation has no continuous price feed and
 *   pretending an unobserved tick crossed the limit would be a fabrication. The
 *   user can explicitly re-check it (`recheckOrder`) or cancel it.
 * - Resting buy limits reserve their worst-case cost, and resting sell limits
 *   reserve their shares, so the same cash or shares cannot back two orders.
 * - Quantities are whole shares. Short selling, margin, leverage, derivatives
 *   and fractional shares are rejected, not approximated.
 *
 * State model: (new) → FILLED | OPEN | REJECTED, OPEN → FILLED | CANCELLED.
 * FILLED, CANCELLED and REJECTED are terminal; nothing moves cash or positions
 * unless an order reaches FILLED.
 */

import {
  MAX_FILL_QUOTE_AGE_MS,
  MAX_ORDER_QUANTITY,
  isSupportedInstrumentType,
  roundMoney,
  roundRatio,
} from "./config";
import { isEndOfDaySource } from "../market/provenance";

export type PaperSide = "BUY" | "SELL";
export type PaperOrderType = "MARKET" | "LIMIT" | "STOP_LOSS";
export type PaperOrderStatus = "PENDING" | "OPEN" | "FILLED" | "CANCELLED" | "REJECTED";
export type PaperInstrumentType = "EQUITY" | "ETF" | "INDEX" | "OTHER";
export type PaperDataMode = "LIVE" | "DELAYED" | "CACHED" | "HISTORICAL" | "SAMPLE";

/** The price a fill would use, already labelled with its freshness. */
export interface EligiblePrice {
  price: number;
  bid: number | null;
  ask: number | null;
  mode: PaperDataMode;
  source: string;
  quoteTime: number | null;
  fetchedAt: number;
  /**
   * True when the price is a completed session's close. Such a price can value a
   * position but can never execute an order: it is not a price you could trade at.
   */
  eod?: boolean;
}

export interface AccountBalance {
  startingCapital: number;
  availableCash: number;
  realizedPnl: number;
}

export interface PositionBalance {
  quantity: number;
  /** Total invested cost still held, in rupees (2 dp). */
  costBasis: number;
}

export interface OpenOrderSummary {
  orderId: string;
  instrumentId: string;
  side: PaperSide;
  quantity: number;
  limitPrice: number | null;
}

export interface OrderRequest {
  clientOrderId: string;
  instrumentId: string;
  instrumentType: PaperInstrumentType;
  side: PaperSide;
  orderType: PaperOrderType;
  quantity: number;
  limitPrice: number | null;
}

export interface OrderFill {
  status: "FILLED";
  fillPrice: number;
  quantity: number;
  /** quantity × fillPrice, always positive. */
  grossValue: number;
  /** Signed: negative for a buy, positive for a sell. */
  cashDelta: number;
  realizedPnl: number;
  position: PositionBalance;
  mode: PaperDataMode;
  source: string;
  quoteTime: number | null;
}

export interface OrderResting {
  status: "OPEN";
  /** Cash this resting buy locks up (0 for a sell). */
  reservedCash: number;
  /** Shares this resting sell locks up (0 for a buy). */
  reservedQuantity: number;
  referencePrice: number;
  mode: PaperDataMode;
  source: string;
  quoteTime: number | null;
}

export interface OrderRejection {
  status: "REJECTED";
  reason: string;
}

export type OrderEvaluation = OrderFill | OrderResting | OrderRejection;

const EPSILON = 0.005;

/** Rupee rendering for user-facing rejection messages. */
function inr(value: number): string {
  return `₹${value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Validates the client-supplied part of an order. Returns a reason or null. */
export function validateOrderRequest(request: OrderRequest): string | null {
  if (!request.clientOrderId || !request.clientOrderId.trim()) {
    return "An order reference is required.";
  }
  if (request.side !== "BUY" && request.side !== "SELL") {
    return "Side must be BUY or SELL.";
  }
  if (request.orderType === "STOP_LOSS") {
    return "Stop-loss orders are not supported by the paper engine yet.";
  }
  if (request.orderType !== "MARKET" && request.orderType !== "LIMIT") {
    return "Order type must be MARKET or LIMIT.";
  }
  if (!isSupportedInstrumentType(request.instrumentType)) {
    return `Paper trading supports equities and ETFs only — ${request.instrumentType} instruments are rejected.`;
  }
  if (!Number.isInteger(request.quantity) || request.quantity <= 0) {
    return "Quantity must be a whole number of shares above zero.";
  }
  if (request.quantity > MAX_ORDER_QUANTITY) {
    return `Quantity cannot exceed ${MAX_ORDER_QUANTITY.toLocaleString("en-IN")} shares in one order.`;
  }
  if (request.orderType === "LIMIT") {
    const limit = request.limitPrice;
    if (limit === null || !Number.isFinite(limit) || limit <= 0) {
      return "A limit price above zero is required for a limit order.";
    }
  }
  return null;
}

/** Ask for buys, bid for sells, last price as the documented fallback. */
export function referencePrice(side: PaperSide, eligible: EligiblePrice | null): number | null {
  if (!eligible) return null;
  if (!Number.isFinite(eligible.price) || eligible.price <= 0) return null;
  const top = side === "BUY" ? eligible.ask : eligible.bid;
  if (top !== null && Number.isFinite(top) && top > 0) return roundMoney(top);
  return roundMoney(eligible.price);
}

/** Cash locked by resting buy limits. */
export function reservedCashFrom(orders: OpenOrderSummary[]): number {
  return roundMoney(
    orders
      .filter((order) => order.side === "BUY")
      .reduce((total, order) => total + order.quantity * (order.limitPrice ?? 0), 0)
  );
}

/** Shares locked by resting sell limits for one instrument. */
export function reservedQuantityFrom(
  orders: OpenOrderSummary[],
  instrumentId?: string
): number {
  return orders
    .filter((order) => order.side === "SELL")
    .filter((order) => instrumentId === undefined || order.instrumentId === instrumentId)
    .reduce((total, order) => total + order.quantity, 0);
}

/**
 * Downgrades a stored quote label for use as a fill price.
 * Nothing is allowed to be called LIVE just because a request succeeded.
 */
export function fillModeFor(input: {
  quotedMode: PaperDataMode;
  quoteFetchedAt: number;
  quoteTime: number | null;
  nowMs: number;
}): PaperDataMode {
  if (input.quotedMode === "SAMPLE") return "SAMPLE";
  const age = input.nowMs - input.quoteFetchedAt;
  if (!Number.isFinite(age) || age > MAX_FILL_QUOTE_AGE_MS) return "CACHED";
  if (input.quotedMode === "LIVE") {
    if (input.quoteTime !== null && input.nowMs - input.quoteTime > MAX_FILL_QUOTE_AGE_MS) {
      return "CACHED";
    }
    return "LIVE";
  }
  if (input.quotedMode === "DELAYED") return "DELAYED";
  // A historical series is never a tradable price.
  if (input.quotedMode === "HISTORICAL") return "CACHED";
  return "CACHED";
}

/**
 * Chooses the price an order may use and labels it honestly.
 *
 * A stored provider quote always wins. The sample series is only used when
 * sample fills are explicitly enabled, and then it is labelled SAMPLE so a
 * fallback can never be presented as an apparently real provider price.
 */
export function selectFillPrice(input: {
  stored: {
    price: number;
    bid: number | null;
    ask: number | null;
    mode: PaperDataMode;
    source: string;
    quoteTime: number | null;
    fetchedAt: number;
  } | null;
  sample: { price: number; bid: number | null; ask: number | null; quoteTime: number | null } | null;
  sampleFillsEnabled: boolean;
  nowMs: number;
}): EligiblePrice | null {
  const { stored } = input;
  if (stored && stored.source !== "sample") {
    return {
      price: stored.price,
      bid: stored.bid,
      ask: stored.ask,
      mode: fillModeFor({
        quotedMode: stored.mode,
        quoteFetchedAt: stored.fetchedAt,
        quoteTime: stored.quoteTime,
        nowMs: input.nowMs,
      }),
      source: stored.source,
      quoteTime: stored.quoteTime,
      fetchedAt: stored.fetchedAt,
      eod: isEndOfDaySource(stored.source),
    };
  }
  if (!input.sample || !input.sampleFillsEnabled) return null;
  return {
    price: input.sample.price,
    bid: input.sample.bid,
    ask: input.sample.ask,
    mode: "SAMPLE",
    source: "sample",
    quoteTime: input.sample.quoteTime,
    fetchedAt: input.nowMs,
  };
}

/** Average cost per share, 4 dp, for display and partial-sell maths. */
export function averageCost(position: PositionBalance): number {
  if (position.quantity <= 0) return 0;
  return roundRatio(position.costBasis / position.quantity);
}

/**
 * Decides what happens to an order right now.
 *
 * `reservedCash` / `reservedQuantity` must describe the *other* resting orders
 * for this account (and, for shares, this instrument), so an order can never
 * spend cash or shares another open order has already committed.
 */
export function evaluateOrder(input: {
  request: OrderRequest;
  account: AccountBalance;
  position: PositionBalance | null;
  eligible: EligiblePrice | null;
  reservedCash: number;
  reservedQuantity: number;
}): OrderEvaluation {
  const { request, account, eligible } = input;
  const invalid = validateOrderRequest(request);
  if (invalid) return { status: "REJECTED", reason: invalid };

  // An end-of-day close is a historical fact, not a tradable quote. Filling at
  // yesterday's close would invent an execution the user never could have had,
  // so every order type is rejected while only EOD data is available.
  if (eligible?.eod) {
    return {
      status: "REJECTED",
      reason:
        "Only an end-of-day close is available for this instrument. Paper orders need a live or delayed quote; historical prices are never used as fills.",
    };
  }

  const position = input.position ?? { quantity: 0, costBasis: 0 };
  const reference = referencePrice(request.side, eligible);
  if (!eligible || reference === null) {
    return {
      status: "REJECTED",
      reason:
        "No eligible price is available for this instrument, so the order cannot be priced. Refresh the quote or try again when a source is configured.",
    };
  }

  const spendable = roundMoney(
    Math.max(0, account.availableCash - Math.max(0, input.reservedCash))
  );
  const sellable = Math.max(0, position.quantity - Math.max(0, input.reservedQuantity));
  const limit = request.orderType === "LIMIT" ? request.limitPrice : null;

  const base = {
    referencePrice: reference,
    mode: eligible.mode,
    source: eligible.source,
    quoteTime: eligible.quoteTime,
  };

  if (limit !== null) {
    const satisfied = request.side === "BUY" ? reference <= limit + EPSILON : reference >= limit - EPSILON;
    if (!satisfied) {
      if (request.side === "BUY") {
        const required = roundMoney(request.quantity * limit);
        if (required > spendable) {
          return {
            status: "REJECTED",
            reason: `Insufficient cash: a resting limit buy of ${request.quantity} @ ${inr(limit)} reserves ${inr(required)}, but only ${inr(spendable)} is spendable.`,
          };
        }
        return { status: "OPEN", reservedCash: required, reservedQuantity: 0, ...base };
      }
      if (request.quantity > sellable) {
        return {
          status: "REJECTED",
          reason: `Only ${sellable} share(s) of this instrument are sellable; the order asked for ${request.quantity}.`,
        };
      }
      return { status: "OPEN", reservedCash: 0, reservedQuantity: request.quantity, ...base };
    }
  }

  const price = roundMoney(reference);
  if (!(price > 0)) {
    return {
      status: "REJECTED",
      reason: "The eligible price is not usable (it is zero or malformed).",
    };
  }
  const gross = roundMoney(request.quantity * price);

  if (request.side === "BUY") {
    if (gross > spendable) {
      return {
        status: "REJECTED",
        reason: `Insufficient cash: ${inr(gross)} required, ${inr(spendable)} spendable.`,
      };
    }
    return {
      status: "FILLED",
      fillPrice: price,
      quantity: request.quantity,
      grossValue: gross,
      cashDelta: -gross,
      realizedPnl: 0,
      position: {
        quantity: position.quantity + request.quantity,
        costBasis: roundMoney(position.costBasis + gross),
      },
      mode: eligible.mode,
      source: eligible.source,
      quoteTime: eligible.quoteTime,
    };
  }

  if (request.quantity > sellable) {
    return {
      status: "REJECTED",
      reason: `Only ${sellable} share(s) of this instrument are sellable; the order asked for ${request.quantity}.`,
    };
  }

  // Weighted-average cost: a partial sell removes its share of the remaining
  // cost basis, so the average cost of the rest is unchanged.
  const costRemoved = roundMoney(
    request.quantity * (position.quantity > 0 ? position.costBasis / position.quantity : 0)
  );
  const remainingQuantity = position.quantity - request.quantity;
  return {
    status: "FILLED",
    fillPrice: price,
    quantity: request.quantity,
    grossValue: gross,
    cashDelta: gross,
    realizedPnl: roundMoney(gross - costRemoved),
    position: {
      quantity: remainingQuantity,
      costBasis: remainingQuantity === 0 ? 0 : roundMoney(position.costBasis - costRemoved),
    },
    mode: eligible.mode,
    source: eligible.source,
    quoteTime: eligible.quoteTime,
  };
}

/** Allowed status changes; anything else is rejected by the backend. */
export function canTransition(from: PaperOrderStatus, to: PaperOrderStatus): boolean {
  if (from === "PENDING") return to === "OPEN" || to === "FILLED" || to === "REJECTED";
  if (from === "OPEN") return to === "FILLED" || to === "CANCELLED";
  return false;
}

export function isTerminalStatus(status: PaperOrderStatus): boolean {
  return status === "FILLED" || status === "CANCELLED" || status === "REJECTED";
}

/* ------------------------------------------------------------------ */
/* Portfolio valuation                                                */
/* ------------------------------------------------------------------ */

export interface ValuedPosition {
  instrumentId: string;
  quantity: number;
  costBasis: number;
  averageCost: number;
  price: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPercent: number;
  mode: PaperDataMode;
  source: string;
  quoteTime: number | null;
}

export interface PortfolioTotals {
  startingCapital: number;
  availableCash: number;
  reservedCash: number;
  spendableCash: number;
  investedCost: number;
  marketValue: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalReturnPercent: number;
  /** Dominant freshness label across valuations; null when nothing is held. */
  mode: PaperDataMode | null;
}

const MODE_PRIORITY: PaperDataMode[] = ["SAMPLE", "CACHED", "DELAYED", "LIVE", "HISTORICAL"];

function dominantMode(modes: PaperDataMode[]): PaperDataMode | null {
  if (modes.length === 0) return null;
  for (const mode of MODE_PRIORITY) {
    if (modes.includes(mode)) return mode;
  }
  return modes[0];
}

/**
 * Builds position valuations, the investable-cash split and account totals.
 * A portfolio holding any sample-priced instrument is labelled SAMPLE overall —
 * a simulated mix is never presented as one verified live source.
 */
export function summarizePortfolio(input: {
  account: AccountBalance;
  positions: {
    instrumentId: string;
    quantity: number;
    costBasis: number;
    price: number;
    mode: PaperDataMode;
    source: string;
    quoteTime: number | null;
  }[];
  reservedCash: number;
}): { positions: ValuedPosition[]; totals: PortfolioTotals } {
  const positions = input.positions
    .filter((position) => position.quantity > 0)
    .map((position): ValuedPosition => {
      const marketValue = roundMoney(position.quantity * position.price);
      const unrealizedPnl = roundMoney(marketValue - position.costBasis);
      return {
        instrumentId: position.instrumentId,
        quantity: position.quantity,
        costBasis: roundMoney(position.costBasis),
        averageCost: roundRatio(
          position.quantity > 0 ? position.costBasis / position.quantity : 0
        ),
        price: roundMoney(position.price),
        marketValue,
        unrealizedPnl,
        unrealizedPercent:
          position.costBasis > 0 ? roundMoney((unrealizedPnl / position.costBasis) * 100) : 0,
        mode: position.mode,
        source: position.source,
        quoteTime: position.quoteTime,
      };
    });

  const investedCost = roundMoney(
    positions.reduce((total, position) => total + position.costBasis, 0)
  );
  const marketValue = roundMoney(
    positions.reduce((total, position) => total + position.marketValue, 0)
  );
  const unrealizedPnl = roundMoney(marketValue - investedCost);
  const realizedPnl = roundMoney(input.account.realizedPnl);
  const availableCash = roundMoney(input.account.availableCash);
  const reservedCash = roundMoney(Math.max(0, input.reservedCash));
  const equity = roundMoney(availableCash + marketValue);
  const totalPnl = roundMoney(realizedPnl + unrealizedPnl);

  return {
    positions,
    totals: {
      startingCapital: roundMoney(input.account.startingCapital),
      availableCash,
      reservedCash,
      spendableCash: roundMoney(Math.max(0, availableCash - reservedCash)),
      investedCost,
      marketValue,
      equity,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      totalReturnPercent:
        input.account.startingCapital > 0
          ? roundMoney((totalPnl / input.account.startingCapital) * 100)
          : 0,
      mode: dominantMode(positions.map((position) => position.mode)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Ledger reconciliation                                              */
/* ------------------------------------------------------------------ */

export interface LedgerMovement {
  kind: PaperSide;
  quantity: number;
  price: number;
  cashDelta: number;
  realizedPnl: number;
}

/**
 * Replays ledger movements to reconstruct cash and realized P&L.
 * The account summary must match this, or a fill mutated balances without
 * recording an auditable entry.
 */
export function replayLedger(
  startingCapital: number,
  movements: LedgerMovement[]
): { cash: number; realizedPnl: number } {
  let cash = roundMoney(startingCapital);
  let realizedPnl = 0;
  for (const movement of movements) {
    cash = roundMoney(cash + movement.cashDelta);
    realizedPnl = roundMoney(realizedPnl + movement.realizedPnl);
  }
  return { cash, realizedPnl };
}
