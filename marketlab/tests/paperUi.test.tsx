// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import OrderTicket, { type TicketInstrument } from "@/components/paper/OrderTicket";
import PaperSummary from "@/components/paper/PaperSummary";
import PositionsTable from "@/components/paper/PositionsTable";
import OrdersTable from "@/components/paper/OrdersTable";
import type { PaperOrderRow, PaperPosition, PaperSummaryData } from "@/lib/paperTypes";
import type { Quote } from "@/lib/marketClient";

afterEach(cleanup);

const instruments: TicketInstrument[] = [
  {
    instrumentId: "NSE:TCS:EQUITY",
    symbol: "TCS",
    name: "Tata Consultancy Services",
    exchange: "NSE",
  },
  {
    instrumentId: "NSE:RELIANCE:EQUITY",
    symbol: "RELIANCE",
    name: "Reliance Industries",
    exchange: "NSE",
  },
];

const quote: Quote = {
  instrumentId: "NSE:TCS:EQUITY",
  symbol: "TCS",
  exchange: "NSE",
  lastPrice: 3892.5,
  change: 10,
  changePercent: 0.26,
  open: null,
  high: null,
  low: null,
  previousClose: null,
  volume: null,
  bid: null,
  ask: null,
  quoteTime: Date.now(),
  source: "sample",
  mode: "SAMPLE",
};

interface TicketOverrides {
  availableCash?: number;
  reservedCash?: number;
  sellableQuantity?: number;
  quote?: Quote | null;
  instruments?: TicketInstrument[];
  onSubmit?: (submission: {
    clientOrderId: string;
    instrumentId: string;
    side: "BUY" | "SELL";
    orderType: "MARKET" | "LIMIT";
    quantity: number;
    limitPrice: number | null;
  }) => Promise<{ ok: boolean; message: string }>;
}

function renderTicket(overrides: TicketOverrides = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn().mockResolvedValue({ ok: true, message: "Filled" });
  render(
    <OrderTicket
      instruments={overrides.instruments ?? instruments}
      search=""
      onSearch={() => {}}
      selectedInstrumentId={instruments[0].instrumentId}
      onSelectInstrument={() => {}}
      quote={overrides.quote === undefined ? quote : overrides.quote}
      availableCash={overrides.availableCash ?? 100_000}
      reservedCash={overrides.reservedCash ?? 0}
      sellableQuantity={overrides.sellableQuantity ?? 0}
      sampleFillsEnabled
      submitting={false}
      onSubmit={onSubmit}
    />
  );
  return { onSubmit };
}

function setQuantity(value: string) {
  fireEvent.change(screen.getByPlaceholderText("0"), { target: { value } });
}

function chooseLimit() {
  fireEvent.click(screen.getByText("Market"));
  fireEvent.click(screen.getByRole("option", { name: "Limit" }));
}

function chooseSell() {
  fireEvent.click(screen.getByRole("button", { name: "Sell" }));
}

describe("OrderTicket", () => {
  it("defaults to a market buy and hides the limit price field", () => {
    renderTicket();
    expect(screen.getByRole("button", { name: "Buy" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByPlaceholderText("0.00")).toBeNull();
    expect(screen.getByText("SAMPLE")).toBeTruthy();
    expect(screen.getByText(/Simulated only/)).toBeTruthy();
  });

  it("shows the limit price field only for limit orders", () => {
    renderTicket();
    chooseLimit();
    expect(screen.getByPlaceholderText("0.00")).toBeTruthy();
  });

  it("requires an explicit confirmation before submitting", async () => {
    const { onSubmit } = renderTicket();
    setQuantity("2");

    fireEvent.click(screen.getByText("Review order"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId("ticket-confirm").textContent).toMatch(/BUY/);

    fireEvent.click(screen.getByText("Place simulated order"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    const submission = (onSubmit as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(submission.instrumentId).toBe("NSE:TCS:EQUITY");
    expect(submission.side).toBe("BUY");
    expect(submission.orderType).toBe("MARKET");
    expect(submission.quantity).toBe(2);
    expect(submission.limitPrice).toBeNull();
    expect(submission.clientOrderId.length).toBeGreaterThan(8);
  });

  it("sends the limit price for a limit order", async () => {
    const { onSubmit } = renderTicket();
    chooseLimit();
    setQuantity("1");
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "3800" } });
    fireEvent.click(screen.getByText("Review order"));
    fireEvent.click(screen.getByText("Place simulated order"));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect((onSubmit as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      orderType: "LIMIT",
      limitPrice: 3800,
    });
  });

  it("reuses the same client reference when a failed attempt is retried", async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "Insufficient cash: ₹7,785.00 required." })
      .mockResolvedValueOnce({ ok: true, message: "Filled at ₹3,892.50 · SAMPLE." });

    renderTicket({ onSubmit });
    setQuantity("2");
    fireEvent.click(screen.getByText("Review order"));
    fireEvent.click(screen.getByText("Place simulated order"));

    await waitFor(() => expect(screen.getByTestId("ticket-error")).toBeTruthy());
    expect(screen.getByTestId("ticket-error").textContent).toMatch(/Insufficient cash/);

    fireEvent.click(screen.getByText("Place simulated order"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));

    const first = onSubmit.mock.calls[0][0].clientOrderId;
    const second = onSubmit.mock.calls[1][0].clientOrderId;
    expect(second).toBe(first);
  });

  it("blocks a buy above spendable cash instead of sending it", () => {
    const { onSubmit } = renderTicket({ availableCash: 1000, reservedCash: 500 });
    setQuantity("2");
    fireEvent.click(screen.getByText("Review order"));

    expect(screen.getByTestId("ticket-error").textContent).toMatch(/Insufficient spendable cash/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks a sell above the sellable quantity", () => {
    const { onSubmit } = renderTicket({ sellableQuantity: 2 });
    chooseSell();
    setQuantity("5");
    fireEvent.click(screen.getByText("Review order"));

    expect(screen.getByTestId("ticket-error").textContent).toMatch(/Only 2 share/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("requires a limit price above zero", () => {
    const { onSubmit } = renderTicket();
    chooseLimit();
    setQuantity("1");
    fireEvent.click(screen.getByText("Review order"));

    expect(screen.getByTestId("ticket-error").textContent).toMatch(/limit price above zero/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("warns when no eligible price is available", () => {
    const { onSubmit } = renderTicket({ quote: null });
    setQuantity("1");
    expect(screen.getByText("No eligible price available.")).toBeTruthy();
    fireEvent.click(screen.getByText("Review order"));
    expect(screen.getByTestId("ticket-error").textContent).toMatch(/No eligible price/);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reports the backend outcome and clears the quantity after a fill", async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValue({ ok: true, message: "Filled at ₹3,892.50 · SAMPLE · sample." });
    renderTicket({ onSubmit });
    setQuantity("1");
    fireEvent.click(screen.getByText("Review order"));
    fireEvent.click(screen.getByText("Place simulated order"));

    await waitFor(() => expect(screen.getByTestId("ticket-notice").textContent).toMatch(/SAMPLE/));
    expect((screen.getByPlaceholderText("0") as HTMLInputElement).value).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* Summary and tables                                                  */
/* ------------------------------------------------------------------ */

function summaryFixture(overrides: Partial<PaperSummaryData["totals"]> = {}): PaperSummaryData {
  const position: PaperPosition = {
    instrumentId: "NSE:TCS:EQUITY",
    symbol: "TCS",
    name: "Tata Consultancy Services",
    exchange: "NSE",
    instrumentType: "EQUITY",
    quantity: 10,
    costBasis: 38_000,
    averageCost: 3800,
    price: 3892.5,
    marketValue: 38_925,
    unrealizedPnl: 925,
    unrealizedPercent: 2.43,
    mode: "SAMPLE",
    source: "sample",
    quoteTime: Date.now(),
  };

  return {
    account: {
      _id: "acct_1",
      startingCapital: 100_000,
      availableCash: 61_075,
      realizedPnl: 0,
      currency: "INR",
      status: "active",
      startingCapitalLocked: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    positions: [position],
    totals: {
      startingCapital: 100_000,
      availableCash: 61_075,
      reservedCash: 0,
      spendableCash: 61_075,
      investedCost: 38_000,
      marketValue: 38_925,
      equity: 100_000,
      realizedPnl: 0,
      unrealizedPnl: 925,
      totalPnl: 925,
      totalReturnPercent: 0.93,
      mode: "SAMPLE",
      ...overrides,
    },
    openOrderCount: 0,
    sampleFillsEnabled: true,
  } as unknown as PaperSummaryData;
}

function orderFixture(overrides: Record<string, unknown> = {}): PaperOrderRow {
  return {
    _id: "order_1",
    _creationTime: Date.now(),
    userId: "user_1",
    accountId: "acct_1",
    instrumentId: "NSE:TCS:EQUITY",
    symbol: "TCS",
    name: "Tata Consultancy Services",
    exchange: "NSE",
    instrumentType: "EQUITY",
    side: "BUY",
    orderType: "MARKET",
    quantity: 10,
    limitPrice: null,
    status: "FILLED",
    filledQuantity: 10,
    filledPrice: 3892.5,
    fillMode: "SAMPLE",
    fillSource: "sample",
    rejectionReason: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as unknown as PaperOrderRow;
}

describe("PaperSummary", () => {
  it("shows the virtual equity, P&L and the simulation notice", () => {
    render(<PaperSummary summary={summaryFixture()} />);
    const card = screen.getByTestId("paper-summary");
    expect(card.textContent).toMatch(/₹1,00,000\.00/);
    expect(card.textContent).toMatch(/\+₹925\.00/);
    expect(card.textContent).toMatch(/SAMPLE/);
    expect(screen.getByTestId("paper-notice").textContent).toMatch(/Simulated account/);
  });

  it("labels a portfolio with no holdings without inventing a data mode", () => {
    render(
      <PaperSummary
        summary={summaryFixture({
          investedCost: 0,
          marketValue: 0,
          unrealizedPnl: 0,
          totalPnl: 0,
          mode: null,
        })}
      />
    );
    expect(screen.getByTestId("paper-summary").textContent).not.toMatch(/Position prices/);
  });

  it("shows cash reserved by open limit orders", () => {
    render(
      <PaperSummary summary={summaryFixture({ reservedCash: 5000, spendableCash: 56_075 })} />
    );
    expect(screen.getByText(/₹5,000\.00 reserved/)).toBeTruthy();
  });
});

describe("PositionsTable", () => {
  it("renders holdings with average cost, value and P&L plus the price label", () => {
    const summary = summaryFixture();
    render(<PositionsTable positions={summary.positions} />);
    const table = screen.getByTestId("positions-table");
    expect(within(table).getByText("TCS")).toBeTruthy();
    expect(table.textContent).toMatch(/3,800\.00/);
    expect(table.textContent).toMatch(/₹38,925\.00/);
    expect(table.textContent).toMatch(/\+₹925\.00/);
    expect(table.textContent).toMatch(/SAMPLE/);
  });

  it("shows an empty state with no positions", () => {
    render(<PositionsTable positions={[]} />);
    expect(screen.getByTestId("positions-empty")).toBeTruthy();
  });
});

describe("OrdersTable", () => {
  it("renders fill price, its data mode and the status", () => {
    render(<OrdersTable orders={[orderFixture()]} />);
    const table = screen.getByTestId("orders-table");
    expect(table.textContent).toMatch(/Filled/);
    expect(table.textContent).toMatch(/3,892\.50/);
    expect(table.textContent).toMatch(/SAMPLE/);
    expect(table.textContent).toMatch(/BUY/);
  });

  it("offers re-check and cancel only for open orders", () => {
    const onCancel = vi.fn();
    const onRecheck = vi.fn();
    render(
      <OrdersTable
        orders={[
          orderFixture({ _id: "open_1", status: "OPEN", filledPrice: null, fillMode: null }),
          orderFixture({ _id: "filled_1", status: "FILLED" }),
        ]}
        onCancel={onCancel}
        onRecheck={onRecheck}
      />
    );

    const openRow = screen.getByText("Open").closest("tr")!;
    fireEvent.click(within(openRow).getByText("Cancel"));
    fireEvent.click(within(openRow).getByText("Re-check"));
    expect(onCancel).toHaveBeenCalledWith("open_1");
    expect(onRecheck).toHaveBeenCalledWith("open_1");

    const filledRow = screen.getByText("Filled").closest("tr")!;
    expect(within(filledRow).queryByText("Cancel")).toBeNull();
    expect(within(filledRow).queryByText("Re-check")).toBeNull();
  });

  it("explains rejections instead of hiding them", () => {
    render(
      <OrdersTable
        orders={[
          orderFixture({
            status: "REJECTED",
            filledPrice: null,
            fillMode: null,
            rejectionReason: "Insufficient cash: ₹7,785.00 required, ₹1,000.00 spendable.",
          }),
        ]}
      />
    );
    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText(/Insufficient cash/)).toBeTruthy();
  });

  it("shows an empty state with no orders", () => {
    render(<OrdersTable orders={[]} />);
    expect(screen.getByTestId("orders-empty")).toBeTruthy();
  });
});
