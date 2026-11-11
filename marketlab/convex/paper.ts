import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { sampleQuote } from "./market/sample";
import { isEndOfDaySource } from "./market/provenance";
import {
  DEFAULT_STARTING_CAPITAL,
  MAX_HISTORY_ROWS,
  MAX_STARTING_CAPITAL,
  MIN_STARTING_CAPITAL,
  PAPER_CURRENCY,
  SAMPLE_FILLS_ENABLED,
  roundMoney,
} from "./paperCore/config";
import {
  canTransition,
  evaluateOrder,
  reservedCashFrom,
  reservedQuantityFrom,
  selectFillPrice,
  summarizePortfolio,
  type AccountBalance,
  type EligiblePrice,
  type OpenOrderSummary,
  type OrderRequest,
  type PaperDataMode,
  type PaperOrderType,
  type PaperSide,
  type PortfolioTotals,
  type ValuedPosition,
} from "./paperCore/engine";

/**
 * Simulated paper trading. Nothing here reaches a broker: every fill is written
 * by a validated Convex mutation against a labelled price, and every balance can
 * be reconstructed from the append-only ledger.
 *
 * Security: the owner is always the authenticated identity (`getAuthUserId`).
 * No function accepts a user id or a balance from the client.
 */

const sideValidator = v.union(v.literal("BUY"), v.literal("SELL"));
const orderTypeValidator = v.union(
  v.literal("MARKET"),
  v.literal("LIMIT"),
  v.literal("STOP_LOSS")
);

export interface PlaceOrderResult {
  status: "FILLED" | "OPEN" | "REJECTED";
  orderId: Id<"paperOrders">;
  reason: string | null;
  duplicate: boolean;
  /** Present only for a filled order; carries the exact price and its label. */
  filledPrice: number | null;
  fillMode: PaperDataMode | null;
  fillSource: string | null;
}

export interface RecheckResult {
  status: "FILLED" | "OPEN" | "CANCELLED" | "REJECTED";
  reason: string | null;
}

export interface PaperSummary {
  account: {
    _id: Id<"paperAccounts">;
    startingCapital: number;
    availableCash: number;
    realizedPnl: number;
    currency: string;
    status: "active" | "disabled";
    startingCapitalLocked: boolean;
    createdAt: number;
    updatedAt: number;
  };
  positions: (ValuedPosition & {
    symbol: string;
    name: string;
    exchange: "NSE" | "BSE";
    instrumentType: "EQUITY" | "ETF" | "INDEX" | "OTHER";
    /** Valuation price is an end-of-day close, not an executable quote. */
    eod: boolean;
  })[];
  totals: PortfolioTotals;
  openOrderCount: number;
  sampleFillsEnabled: boolean;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

type ReadCtx = QueryCtx | MutationCtx;

interface InstrumentRef {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: "NSE" | "BSE";
  instrumentType: "EQUITY" | "ETF" | "INDEX" | "OTHER";
}

function toInstrumentRef(row: Doc<"instruments">): InstrumentRef {
  return {
    instrumentId: row.instrumentId ?? `${row.exchange}:${row.symbol}:${row.instrumentType}`,
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    instrumentType: row.instrumentType,
  };
}

/** Canonical id first, then the legacy `EXCHANGE:SYMBOL:TYPE` parse. */
async function findInstrument(ctx: ReadCtx, instrumentId: string): Promise<InstrumentRef | null> {
  const direct = await ctx.db
    .query("instruments")
    .withIndex("by_instrument_id", (q) => q.eq("instrumentId", instrumentId))
    .first();
  if (direct) return toInstrumentRef(direct);

  const [exchange, symbol, type] = instrumentId.split(":");
  if (!exchange || !symbol) return null;
  if (exchange !== "NSE" && exchange !== "BSE") return null;
  const rows = await ctx.db
    .query("instruments")
    .withIndex("by_exchange_symbol", (q) => q.eq("exchange", exchange).eq("symbol", symbol))
    .collect();
  const match = rows.find((row) => row.instrumentType === type) ?? rows[0];
  return match ? toInstrumentRef(match) : null;
}

function accountBalance(account: Doc<"paperAccounts">): AccountBalance {
  return {
    startingCapital: account.startingCapital,
    availableCash: account.availableCash,
    realizedPnl: account.realizedPnl ?? 0,
  };
}

async function accountFor(ctx: ReadCtx, userId: Id<"users">): Promise<Doc<"paperAccounts"> | null> {
  return await ctx.db
    .query("paperAccounts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * Resolves the price an order may fill at, with an honest label.
 *
 * Only a non-sample stored quote is eligible. Sample pricing is used solely for
 * the explicitly enabled demo simulation and is labelled SAMPLE on the order and
 * the ledger entry, so it can never be mistaken for a provider price.
 */
async function resolveEligiblePrice(
  ctx: ReadCtx,
  instrument: InstrumentRef,
  nowMs: number
): Promise<EligiblePrice | null> {
  const quote = await ctx.db
    .query("marketQuotes")
    .withIndex("by_instrument", (q) => q.eq("instrumentId", instrument.instrumentId))
    .first();

  const sample = sampleQuote(
    {
      instrumentId: instrument.instrumentId,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      name: instrument.name,
    },
    nowMs
  );

  return selectFillPrice({
    stored: quote
      ? {
          price: quote.lastPrice,
          bid: quote.bid,
          ask: quote.ask,
          mode: quote.mode as PaperDataMode,
          source: quote.source,
          quoteTime: quote.quoteTime,
          fetchedAt: quote.fetchedAt,
        }
      : null,
    sample: { price: sample.lastPrice, bid: sample.bid, ask: sample.ask, quoteTime: sample.quoteTime },
    sampleFillsEnabled: SAMPLE_FILLS_ENABLED,
    nowMs,
  });
}

async function openOrderRows(
  ctx: ReadCtx,
  accountId: Id<"paperAccounts">
): Promise<Doc<"paperOrders">[]> {
  return await ctx.db
    .query("paperOrders")
    .withIndex("by_account_status", (q) => q.eq("accountId", accountId).eq("status", "OPEN"))
    .collect();
}

function toOpenOrderSummary(order: Doc<"paperOrders">): OpenOrderSummary {
  return {
    orderId: order._id,
    instrumentId: order.instrumentId,
    side: order.side,
    quantity: order.quantity,
    limitPrice: order.limitPrice ?? order.price ?? null,
  };
}

async function positionFor(
  ctx: ReadCtx,
  accountId: Id<"paperAccounts">,
  instrumentId: string
): Promise<Doc<"paperPositions"> | null> {
  return await ctx.db
    .query("paperPositions")
    .withIndex("by_account_instrument", (q) =>
      q.eq("accountId", accountId).eq("instrumentId", instrumentId)
    )
    .first();
}

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */

/** The raw paper-account document, or null when none exists yet. */
export const account = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await accountFor(ctx, userId);
  },
});

/**
 * Account summary with live(ly labelled) valuations.
 *
 * Prices come from the stored quote cache, downgraded to CACHED when stale, and
 * fall back to the deterministic sample series (labelled SAMPLE) only when no
 * provider quote exists. The overall label is the weakest label present, so a
 * mixed portfolio is never presented as one verified live source.
 */
export const summary = query({
  args: {},
  handler: async (ctx): Promise<PaperSummary | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const account = await accountFor(ctx, userId);
    if (!account) return null;

    const now = Date.now();
    const positionRows = await ctx.db
      .query("paperPositions")
      .withIndex("by_account", (q) => q.eq("accountId", account._id))
      .collect();

    const priced: {
      instrumentId: string;
      quantity: number;
      costBasis: number;
      price: number;
      mode: PaperDataMode;
      source: string;
      quoteTime: number | null;
      row: Doc<"paperPositions">;
    }[] = [];

    for (const row of positionRows) {
      const instrument = await findInstrument(ctx, row.instrumentId);
      const eligible = instrument
        ? await resolveEligiblePrice(ctx, instrument, now)
        : null;
      priced.push({
        instrumentId: row.instrumentId,
        quantity: row.quantity,
        costBasis: row.costBasis,
        price: eligible?.price ?? 0,
        mode: eligible?.mode ?? "CACHED",
        source: eligible?.source ?? "unavailable",
        quoteTime: eligible?.quoteTime ?? null,
        row,
      });
    }

    const openRows = await openOrderRows(ctx, account._id);
    const reservedCash = reservedCashFrom(openRows.map(toOpenOrderSummary));
    const { positions, totals } = summarizePortfolio({
      account: accountBalance(account),
      positions: priced.map((entry) => ({
        instrumentId: entry.instrumentId,
        quantity: entry.quantity,
        costBasis: entry.costBasis,
        price: entry.price,
        mode: entry.mode,
        source: entry.source,
        quoteTime: entry.quoteTime,
      })),
      reservedCash,
    });

    const rowById = new Map(priced.map((entry) => [entry.instrumentId, entry.row]));

    return {
      account: {
        _id: account._id,
        startingCapital: account.startingCapital,
        availableCash: account.availableCash,
        realizedPnl: account.realizedPnl ?? 0,
        currency: account.currency,
        status: account.status,
        startingCapitalLocked: account.startingCapitalLocked ?? false,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      },
      positions: positions.map((position) => {
        const row = rowById.get(position.instrumentId);
        return {
          ...position,
          eod: isEndOfDaySource(position.source),
          symbol: row?.symbol ?? position.instrumentId.split(":")[1] ?? position.instrumentId,
          name: row?.name ?? "",
          exchange: row?.exchange ?? "NSE",
          instrumentType: row?.instrumentType ?? "EQUITY",
        };
      }),
      totals,
      openOrderCount: openRows.length,
      sampleFillsEnabled: SAMPLE_FILLS_ENABLED,
    };
  },
});

/** Most recent orders, newest first. */
export const orders = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const account = await accountFor(ctx, userId);
    if (!account) return [];
    const limit = Math.min(Math.max(1, args.limit ?? 50), MAX_HISTORY_ROWS);
    return await ctx.db
      .query("paperOrders")
      .withIndex("by_account_created", (q) => q.eq("accountId", account._id))
      .order("desc")
      .take(limit);
  },
});

/** Append-only fill ledger, newest first — the audit trail behind the balances. */
export const ledger = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const account = await accountFor(ctx, userId);
    if (!account) return [];
    const limit = Math.min(Math.max(1, args.limit ?? 50), MAX_HISTORY_ROWS);
    return await ctx.db
      .query("paperLedger")
      .withIndex("by_account_ts", (q) => q.eq("accountId", account._id))
      .order("desc")
      .take(limit);
  },
});

/* ------------------------------------------------------------------ */
/* Account setup                                                      */
/* ------------------------------------------------------------------ */

/**
 * Creates the simulated account once (idempotent). Never touches an existing
 * account, so repeated page loads cannot reset balances.
 */
export const ensureAccount = mutation({
  args: { startingCapital: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Id<"paperAccounts">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await accountFor(ctx, userId);
    if (existing) return existing._id;

    const capital = args.startingCapital ?? DEFAULT_STARTING_CAPITAL;
    if (!Number.isFinite(capital) || capital < MIN_STARTING_CAPITAL || capital > MAX_STARTING_CAPITAL) {
      throw new Error(
        `Starting capital must be between ₹${MIN_STARTING_CAPITAL.toLocaleString("en-IN")} and ₹${MAX_STARTING_CAPITAL.toLocaleString("en-IN")}.`
      );
    }
    const capitalRounded = roundMoney(capital);
    const now = Date.now();
    return await ctx.db.insert("paperAccounts", {
      userId,
      startingCapital: capitalRounded,
      availableCash: capitalRounded,
      currency: PAPER_CURRENCY,
      status: "active",
      createdAt: now,
      updatedAt: now,
      realizedPnl: 0,
      startingCapitalLocked: false,
      lastOrderAt: null,
    });
  },
});

/**
 * Sets starting capital before the first order. Once an order exists the
 * baseline is immutable — otherwise history could be rewritten to flatter P&L.
 */
export const configureCapital = mutation({
  args: { startingCapital: v.number() },
  handler: async (ctx, args): Promise<Id<"paperAccounts">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    if (
      !Number.isFinite(args.startingCapital) ||
      args.startingCapital < MIN_STARTING_CAPITAL ||
      args.startingCapital > MAX_STARTING_CAPITAL
    ) {
      throw new Error(
        `Starting capital must be between ₹${MIN_STARTING_CAPITAL.toLocaleString("en-IN")} and ₹${MAX_STARTING_CAPITAL.toLocaleString("en-IN")}.`
      );
    }

    const account = await accountFor(ctx, userId);
    if (!account) {
      const capital = roundMoney(args.startingCapital);
      const now = Date.now();
      return await ctx.db.insert("paperAccounts", {
        userId,
        startingCapital: capital,
        availableCash: capital,
        currency: PAPER_CURRENCY,
        status: "active",
        createdAt: now,
        updatedAt: now,
        realizedPnl: 0,
        startingCapitalLocked: false,
        lastOrderAt: null,
      });
    }

    const anyOrder = await ctx.db
      .query("paperOrders")
      .withIndex("by_account_created", (q) => q.eq("accountId", account._id))
      .first();
    if (anyOrder || (account.startingCapitalLocked ?? false)) {
      throw new Error(
        "Starting capital is locked after the first order. It can only be changed before trading starts."
      );
    }

    const capital = roundMoney(args.startingCapital);
    await ctx.db.patch(account._id, {
      startingCapital: capital,
      availableCash: capital,
      updatedAt: Date.now(),
    });
    return account._id;
  },
});

/* ------------------------------------------------------------------ */
/* Order placement                                                    */
/* ------------------------------------------------------------------ */

export const placeOrder = mutation({
  args: {
    clientOrderId: v.string(),
    instrumentId: v.string(),
    side: sideValidator,
    orderType: orderTypeValidator,
    quantity: v.number(),
    limitPrice: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args): Promise<PlaceOrderResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const instrument = await findInstrument(ctx, args.instrumentId);
    if (!instrument) throw new Error("Instrument not found");
    if (instrument.instrumentType !== "EQUITY" && instrument.instrumentType !== "ETF") {
      throw new Error("Paper trading only supports equity and ETF instruments.");
    }

    const account = await accountFor(ctx, userId);
    if (!account) throw new Error("Paper account not found — open the Trading page to create one.");
    if (account.status === "disabled") throw new Error("This paper account is disabled.");

    const now = Date.now();
    const request: OrderRequest = {
      clientOrderId: args.clientOrderId,
      instrumentId: instrument.instrumentId,
      instrumentType: instrument.instrumentType,
      side: args.side as PaperSide,
      orderType: args.orderType as PaperOrderType,
      quantity: args.quantity,
      limitPrice: args.limitPrice ?? null,
    };

    // Idempotency: the same client reference can never create a second order or
    // a second ledger entry, however many times the client retries.
    const duplicate = await ctx.db
      .query("paperOrders")
      .withIndex("by_account_client", (q) =>
        q.eq("accountId", account._id).eq("clientOrderId", args.clientOrderId)
      )
      .first();
    if (duplicate) {
      return {
        status:
          duplicate.status === "FILLED"
            ? "FILLED"
            : duplicate.status === "REJECTED"
              ? "REJECTED"
              : "OPEN",
        orderId: duplicate._id,
        reason: duplicate.rejectionReason ?? null,
        duplicate: true,
        filledPrice: duplicate.filledPrice ?? null,
        fillMode: (duplicate.fillMode as PaperDataMode | undefined) ?? null,
        fillSource: duplicate.fillSource ?? null,
      };
    }

    const openRows = await openOrderRows(ctx, account._id);
    const open = openRows.map(toOpenOrderSummary);
    const position = await positionFor(ctx, account._id, instrument.instrumentId);
    const eligible = await resolveEligiblePrice(ctx, instrument, now);

    const evaluation = evaluateOrder({
      request,
      account: accountBalance(account),
      position: position ? { quantity: position.quantity, costBasis: position.costBasis } : null,
      eligible,
      reservedCash: reservedCashFrom(open),
      reservedQuantity: reservedQuantityFrom(open, instrument.instrumentId),
    });

    const orderBase = {
      userId,
      accountId: account._id,
      instrumentId: instrument.instrumentId,
      symbol: instrument.symbol,
      name: instrument.name,
      exchange: instrument.exchange,
      instrumentType: instrument.instrumentType,
      side: args.side as PaperSide,
      orderType: args.orderType as PaperOrderType,
      quantity: args.quantity,
      clientOrderId: args.clientOrderId,
      price: request.limitPrice ?? undefined,
      limitPrice: request.limitPrice,
      triggerPrice: undefined,
      updatedAt: now,
    };

    if (evaluation.status === "REJECTED") {
      const orderId = await ctx.db.insert("paperOrders", {
        ...orderBase,
        status: "REJECTED",
        createdAt: now,
        rejectionReason: evaluation.reason,
        reservedCash: 0,
        reservedQuantity: 0,
      });
      await ctx.db.patch(account._id, {
        startingCapitalLocked: true,
        lastOrderAt: now,
        updatedAt: now,
      });
      return {
        status: "REJECTED",
        orderId,
        reason: evaluation.reason,
        duplicate: false,
        filledPrice: null,
        fillMode: null,
        fillSource: null,
      };
    }

    if (evaluation.status === "OPEN") {
      const orderId = await ctx.db.insert("paperOrders", {
        ...orderBase,
        status: "OPEN",
        createdAt: now,
        fillMode: evaluation.mode,
        fillSource: evaluation.source,
        fillQuoteTime: evaluation.quoteTime,
        reservedCash: evaluation.reservedCash,
        reservedQuantity: evaluation.reservedQuantity,
      });
      await ctx.db.patch(account._id, {
        startingCapitalLocked: true,
        lastOrderAt: now,
        updatedAt: now,
      });
      return {
        status: "OPEN",
        orderId,
        reason: null,
        duplicate: false,
        filledPrice: null,
        fillMode: evaluation.mode,
        fillSource: evaluation.source,
      };
    }

    // FILLED — write the order, then its balance, position and ledger effects.
    const orderId = await ctx.db.insert("paperOrders", {
      ...orderBase,
      status: "FILLED",
      createdAt: now,
      filledQuantity: evaluation.quantity,
      filledPrice: evaluation.fillPrice,
      filledAt: now,
      fillMode: evaluation.mode,
      fillSource: evaluation.source,
      fillQuoteTime: evaluation.quoteTime,
      reservedCash: 0,
      reservedQuantity: 0,
    });

    const cashAfter = roundMoney(account.availableCash + evaluation.cashDelta);
    const realizedPnl = roundMoney((account.realizedPnl ?? 0) + evaluation.realizedPnl);

    await ctx.db.patch(account._id, {
      availableCash: cashAfter,
      realizedPnl,
      startingCapitalLocked: true,
      lastOrderAt: now,
      updatedAt: now,
    });

    if (evaluation.position.quantity > 0) {
      if (position) {
        await ctx.db.patch(position._id, {
          quantity: evaluation.position.quantity,
          costBasis: evaluation.position.costBasis,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("paperPositions", {
          userId,
          accountId: account._id,
          instrumentId: instrument.instrumentId,
          symbol: instrument.symbol,
          name: instrument.name,
          exchange: instrument.exchange,
          instrumentType: instrument.instrumentType,
          quantity: evaluation.position.quantity,
          costBasis: evaluation.position.costBasis,
          updatedAt: now,
        });
      }
    } else if (position) {
      // Fully sold: no holding remains. The ledger entry below still records it.
      await ctx.db.delete(position._id);
    }

    await ctx.db.insert("paperLedger", {
      userId,
      accountId: account._id,
      orderId,
      instrumentId: instrument.instrumentId,
      symbol: instrument.symbol,
      kind: args.side as PaperSide,
      quantity: evaluation.quantity,
      price: evaluation.fillPrice,
      cashDelta: evaluation.cashDelta,
      cashAfter,
      positionQtyAfter: evaluation.position.quantity,
      costBasisAfter: evaluation.position.costBasis,
      realizedPnl: evaluation.realizedPnl,
      mode: evaluation.mode,
      source: evaluation.source,
      ts: now,
    });

    return {
      status: "FILLED",
      orderId,
      reason: null,
      duplicate: false,
      filledPrice: evaluation.fillPrice,
      fillMode: evaluation.mode,
      fillSource: evaluation.source,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Open order lifecycle                                               */
/* ------------------------------------------------------------------ */

/** Cancels a resting limit order. Resting orders never moved cash or shares. */
export const cancelOrder = mutation({
  args: { orderId: v.id("paperOrders") },
  handler: async (ctx, args): Promise<RecheckResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const order = await ctx.db.get(args.orderId);
    if (!order || order.userId !== userId) throw new Error("Order not found");
    if (order.status !== "OPEN" || !canTransition(order.status, "CANCELLED")) {
      throw new Error(`Only open orders can be cancelled — this order is ${order.status}.`);
    }

    await ctx.db.patch(order._id, {
      status: "CANCELLED",
      cancelledAt: Date.now(),
      reservedCash: 0,
      reservedQuantity: 0,
      updatedAt: Date.now(),
    });
    return { status: "CANCELLED", reason: null };
  },
});

/**
 * Re-evaluates a resting limit order against the current eligible price.
 *
 * This is an explicit user action, not a background job: the simulation has no
 * continuous feed, so an unobserved tick is never assumed to have crossed the
 * limit. If the condition still is not met the order stays OPEN.
 */
export const recheckOrder = mutation({
  args: { orderId: v.id("paperOrders") },
  handler: async (ctx, args): Promise<RecheckResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const order = await ctx.db.get(args.orderId);
    if (!order || order.userId !== userId) throw new Error("Order not found");
    if (order.status !== "OPEN") {
      throw new Error(`Only open orders can be re-checked — this order is ${order.status}.`);
    }

    const account = await accountFor(ctx, userId);
    if (!account) throw new Error("Paper account not found");
    if (account.status === "disabled") throw new Error("This paper account is disabled.");

    const instrument = await findInstrument(ctx, order.instrumentId);
    if (!instrument) throw new Error("Instrument not found");

    const now = Date.now();
    const openRows = await openOrderRows(ctx, account._id);
    // This order's own reservation must not block it.
    const otherOpen = openRows
      .filter((row) => row._id !== order._id)
      .map(toOpenOrderSummary);
    const position = await positionFor(ctx, account._id, instrument.instrumentId);
    const eligible = await resolveEligiblePrice(ctx, instrument, now);

    const evaluation = evaluateOrder({
      request: {
        clientOrderId: order.clientOrderId ?? order._id,
        instrumentId: instrument.instrumentId,
        instrumentType: instrument.instrumentType,
        side: order.side,
        orderType: "LIMIT",
        quantity: order.quantity,
        limitPrice: order.limitPrice ?? order.price ?? null,
      },
      account: accountBalance(account),
      position: position ? { quantity: position.quantity, costBasis: position.costBasis } : null,
      eligible,
      reservedCash: reservedCashFrom(otherOpen),
      reservedQuantity: reservedQuantityFrom(otherOpen, instrument.instrumentId),
    });

    if (evaluation.status !== "FILLED") {
      return {
        status: "OPEN",
        reason:
          evaluation.status === "REJECTED"
            ? evaluation.reason
            : "The limit condition is still not met, so the order stays open.",
      };
    }
    if (!canTransition("OPEN", "FILLED")) {
      throw new Error("This order can no longer be filled.");
    }

    const cashAfter = roundMoney(account.availableCash + evaluation.cashDelta);
    const realizedPnl = roundMoney((account.realizedPnl ?? 0) + evaluation.realizedPnl);

    await ctx.db.patch(order._id, {
      status: "FILLED",
      filledQuantity: evaluation.quantity,
      filledPrice: evaluation.fillPrice,
      filledAt: now,
      fillMode: evaluation.mode,
      fillSource: evaluation.source,
      fillQuoteTime: evaluation.quoteTime,
      reservedCash: 0,
      reservedQuantity: 0,
      updatedAt: now,
    });

    await ctx.db.patch(account._id, {
      availableCash: cashAfter,
      realizedPnl,
      lastOrderAt: now,
      updatedAt: now,
    });

    if (evaluation.position.quantity > 0) {
      if (position) {
        await ctx.db.patch(position._id, {
          quantity: evaluation.position.quantity,
          costBasis: evaluation.position.costBasis,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("paperPositions", {
          userId,
          accountId: account._id,
          instrumentId: instrument.instrumentId,
          symbol: instrument.symbol,
          name: instrument.name,
          exchange: instrument.exchange,
          instrumentType: instrument.instrumentType,
          quantity: evaluation.position.quantity,
          costBasis: evaluation.position.costBasis,
          updatedAt: now,
        });
      }
    } else if (position) {
      await ctx.db.delete(position._id);
    }

    await ctx.db.insert("paperLedger", {
      userId,
      accountId: account._id,
      orderId: order._id,
      instrumentId: instrument.instrumentId,
      symbol: instrument.symbol,
      kind: order.side,
      quantity: evaluation.quantity,
      price: evaluation.fillPrice,
      cashDelta: evaluation.cashDelta,
      cashAfter,
      positionQtyAfter: evaluation.position.quantity,
      costBasisAfter: evaluation.position.costBasis,
      realizedPnl: evaluation.realizedPnl,
      mode: evaluation.mode,
      source: evaluation.source,
      ts: now,
    });

    return { status: "FILLED", reason: null };
  },
});
