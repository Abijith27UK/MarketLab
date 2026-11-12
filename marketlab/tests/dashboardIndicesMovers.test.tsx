// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import IndexSummaryCard from "../src/components/market/IndexSummaryCard";
import MoversPanel from "../src/components/dashboard/MoversPanel";
import type { StockCardModel } from "../src/lib/stockModels";
import type { MarketMoversResult } from "../src/lib/marketClient";

afterEach(cleanup);

const NOW = Date.parse("2026-11-12T10:30:00Z");

function indexModel(overrides: Partial<StockCardModel> = {}): StockCardModel {
  return {
    instrumentId: "NSE:NIFTY50:INDEX",
    symbol: "NIFTY50",
    name: "NIFTY 50",
    exchange: "NSE",
    instrumentType: "INDEX",
    lastPrice: 25233.2,
    change: -21.85,
    changePercent: -0.09,
    mode: "DELAYED",
    source: "nsemcp",
    quoteTime: Date.parse("2026-11-12T09:59:00Z"),
    sparkline: [],
    ...overrides,
  };
}

const movers: MarketMoversResult = {
  available: true,
  source: "nsemcp",
  sourceLabel: "NSE MCP",
  tool: "nse_get_market_movers",
  universe: "All NSE equities (EQ series)",
  segment: "allSec",
  gainers: [
    {
      symbol: "ORCHASP",
      name: "ORCHASP LIMITED",
      instrumentId: "NSE:ORCHASP:EQUITY",
      inCatalogue: true,
      series: "EQ",
      lastPrice: 1.38,
      previousClose: 1.15,
      change: 0.23,
      changePercent: 20,
      quoteTime: Date.parse("2026-11-12T10:22:18Z"),
    },
    {
      symbol: "PROZONER",
      name: null,
      instrumentId: "NSE:PROZONER:EQUITY",
      inCatalogue: false,
      series: "EQ",
      lastPrice: 63.76,
      previousClose: 53.14,
      change: 10.62,
      changePercent: 19.98,
      quoteTime: Date.parse("2026-11-12T10:22:18Z"),
    },
  ],
  losers: [
    {
      symbol: "PAGEIND",
      name: "PAGE INDUSTRIES LTD",
      instrumentId: "NSE:PAGEIND:EQUITY",
      inCatalogue: true,
      series: "EQ",
      lastPrice: 31850,
      previousClose: 36570,
      change: -4720,
      changePercent: -12.91,
      quoteTime: Date.parse("2026-11-12T10:22:18Z"),
    },
  ],
  mode: "DELAYED",
  quoteTimestamp: Date.parse("2026-11-12T10:22:18Z"),
  sessionDate: "2026-11-12",
  retrievedAt: Date.parse("2026-11-12T10:25:00Z"),
  cacheExpiresAt: Date.parse("2026-11-12T10:26:00Z"),
  fromCache: true,
  stale: false,
  warning: null,
  reason: null,
};

describe("index summary card", () => {
  it("shows index levels as points, never with a rupee symbol", () => {
    const { container } = render(
      <IndexSummaryCard model={indexModel()} onOpen={() => undefined} now={NOW} />
    );
    expect(container.textContent).toContain("25,233.20");
    expect(container.textContent).not.toContain("₹");
    expect(screen.getByText("NIFTY 50")).toBeTruthy();
  });

  it("labels the provider, delay and direction", () => {
    const { container } = render(
      <IndexSummaryCard model={indexModel()} onOpen={() => undefined} now={NOW} />
    );
    expect(container.querySelector("[data-direction='down']")).toBeTruthy();
    expect(container.textContent).toContain("DELAYED");
  });

  it("says so when no quote is available instead of showing a level", () => {
    const { container } = render(
      <IndexSummaryCard
        model={indexModel({ lastPrice: null, change: null, changePercent: null, quoteTime: null })}
        onOpen={() => undefined}
        now={NOW}
      />
    );
    expect(container.textContent).toContain("change unavailable");
    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toMatch(/\d{2},\d{3}\.\d{2}/);
  });
});

describe("market movers panel", () => {
  it("shows official NSE source, universe and session metadata", () => {
    const { container } = render(
      <MoversPanel data={movers} now={NOW} onOpen={() => undefined} />
    );
    expect(container.textContent).toContain("Official NSE market rankings");
    expect(container.textContent).toContain("NSE MCP");
    expect(container.textContent).toContain("All NSE equities (EQ series)");
    expect(container.textContent).toContain("session 2026-11-12");
    expect(container.textContent).toContain("DELAYED");
  });

  it("renders gainers with positive percentages and losers with negative ones", () => {
    render(<MoversPanel data={movers} now={NOW} onOpen={() => undefined} />);
    expect(screen.getByText("+20.00%")).toBeTruthy();
    expect(screen.getByText("+19.98%")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Losers" }));
    expect(screen.getByText("-12.91%")).toBeTruthy();
    expect(screen.queryByText("+20.00%")).toBeNull();
    expect(screen.queryByText("+19.98%")).toBeNull();
  });

  it("opens the instrument for catalogue rows only", () => {
    const opened: string[] = [];
    render(
      <MoversPanel data={movers} now={NOW} onOpen={(id) => opened.push(id)} />
    );
    fireEvent.click(screen.getByRole("button", { name: /ORCHASP/ }));
    expect(opened).toEqual(["NSE:ORCHASP:EQUITY"]);
    // A mover outside the local catalogue is not linked to a guessed instrument.
    expect(screen.queryByRole("button", { name: /PROZONER/ })).toBeNull();
    expect(screen.getByText(/sync the instrument catalogue/i)).toBeTruthy();
  });

  it("shows an explicit unavailable state instead of substituting quotes", () => {
    render(
      <MoversPanel
        data={{
          ...movers,
          available: false,
          gainers: [],
          losers: [],
          reason: "NSE MCP is disabled on this deployment.",
        }}
        now={NOW}
        onOpen={() => undefined}
      />
    );
    expect(screen.getByText("Official NSE rankings unavailable")).toBeTruthy();
    expect(screen.getByText("NSE MCP is disabled on this deployment.")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("marks a stale cached ranking and offers a retry", () => {
    const { container } = render(
      <MoversPanel
        data={{ ...movers, mode: "CACHED", stale: true, warning: "Refresh failed." }}
        now={NOW}
        onOpen={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(container.textContent).toContain("CACHED");
    expect(container.textContent).toContain("Refresh failed.");
    expect(
      screen.getByRole("button", { name: "Refresh NSE market movers" })
    ).toBeTruthy();
  });
});
