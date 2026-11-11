import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

/**
 * Types derived from the official generated Convex API, so the UI cannot drift
 * from the server handlers. Nothing here is hand-maintained JSON shape copying.
 */

export type PaperSummaryData = NonNullable<FunctionReturnType<typeof api.paper.summary>>;
export type PaperAccountData = PaperSummaryData["account"];
export type PaperPosition = PaperSummaryData["positions"][number];
export type PaperTotals = PaperSummaryData["totals"];

export type PaperOrderRow = FunctionReturnType<typeof api.paper.orders>[number];
export type PaperOrderStatus = PaperOrderRow["status"];
export type PaperSide = PaperOrderRow["side"];
export type PaperLedgerRow = FunctionReturnType<typeof api.paper.ledger>[number];

/** Human labels for the documented order states. */
export const ORDER_STATUS_LABEL: Record<PaperOrderStatus, string> = {
  PENDING: "Pending",
  OPEN: "Open",
  FILLED: "Filled",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
};

/** Terminal states never change again. */
export const ORDER_STATUS_DESCRIPTION: Record<PaperOrderStatus, string> = {
  PENDING: "Submitted, not yet evaluated",
  OPEN: "Resting limit order — reserves cash or shares, no fill yet",
  FILLED: "Executed in the simulation and recorded in the ledger",
  CANCELLED: "Cancelled by you before it filled — no balance change",
  REJECTED: "Refused by the backend — no balance change",
};
