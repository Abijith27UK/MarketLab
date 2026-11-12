// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FinancialValue from "@/components/market/FinancialValue";
import PriceChange from "@/components/market/PriceChange";
import DataFreshnessBadge from "@/components/market/DataFreshnessBadge";
import MarketStatusBadge from "@/components/market/MarketStatusBadge";
import StockQuoteCard from "@/components/market/StockQuoteCard";
import IndexSummaryCard from "@/components/market/IndexSummaryCard";
import type { StockCardModel } from "@/lib/stockModels";

afterEach(cleanup);

/** Fixed reference time so age text and sparkline decisions are deterministic. */
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);

const model = (overrides: Partial<StockCardModel> = {}): StockCardModel => ({
  instrumentId: "NSE:RELIANCE:EQUITY",
  symbol: "RELIANCE",
  name: "Reliance Industries",
  exchange: "NSE",
  instrumentType: "EQUITY",
  lastPrice: 2845.55,
  change: 31.2,
  changePercent: 1.11,
  mode: "LIVE",
  source: "fyers",
  quoteTime: NOW - 30_000,
  sparkline: [2800, 2810, 2830, 2825, 2845.55],
  sampleCatalogue: false,
  ...overrides,
});

describe("FinancialValue", () => {
  it("formats INR with Indian digit grouping and two decimals", () => {
    render(<FinancialValue value={1234567.8} />);
    expect(screen.getByText("₹12,34,567.80")).toBeTruthy();
  });

  it("renders a neutral dash instead of NaN, null or undefined", () => {
    const { container, rerender } = render(<FinancialValue value={Number.NaN} />);
    expect(container.textContent).toBe("—");
    rerender(<FinancialValue value={null} />);
    expect(container.textContent).toBe("—");
    rerender(<FinancialValue value={undefined} />);
    expect(container.textContent).toBe("—");
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });
});

describe("PriceChange", () => {
  it("shows absolute and percentage change as separate elements with a gain sign", () => {
    const { container } = render(<PriceChange change={31.2} changePercent={1.11} />);
    expect(container.querySelector(".ml-price-change__abs")?.textContent).toBe("+31.20");
    expect(container.querySelector(".ml-price-change__pct")?.textContent).toBe("+1.11%");
    expect(container.querySelector(".ml-price-change")?.className).toContain("ml-tone--up");
  });

  it("marks losses as negative", () => {
    const { container } = render(<PriceChange change={-12.5} changePercent={-0.42} />);
    expect(container.querySelector(".ml-price-change")?.className).toContain("ml-tone--down");
    expect(container.textContent).toContain("-0.42%");
  });

  it("treats zero as unchanged and neutral", () => {
    const { container } = render(<PriceChange change={0} changePercent={0} />);
    expect(container.querySelector(".ml-price-change")?.className).toContain("ml-tone--flat");
    expect(container.textContent).toContain("unchanged");
  });

  it("says so when no change data exists", () => {
    const { container } = render(<PriceChange change={null} changePercent={null} />);
    expect(container.textContent).toBe("change unavailable");
  });
});

describe("DataFreshnessBadge", () => {
  it("keeps the source mode label and adds the quote age", () => {
    const { container } = render(
      <DataFreshnessBadge mode="DELAYED" asOf={NOW - 180_000} now={NOW} />
    );
    expect(container.querySelector(".ml-data-mode")?.getAttribute("data-mode")).toBe("DELAYED");
    expect(container.textContent).toContain("3m ago");
  });

  it("uses an explicit label when one is supplied", () => {
    const { container } = render(
      <DataFreshnessBadge mode="SAMPLE" asOf={null} now={NOW} label="no quote available" />
    );
    expect(container.textContent).toContain("no quote available");
    expect(container.querySelector(".ml-data-mode")?.getAttribute("data-mode")).toBe("SAMPLE");
  });
});

describe("MarketStatusBadge", () => {
  it("reflects the session label reported by the source", () => {
    const { container } = render(<MarketStatusBadge label="Market open" />);
    expect(container.querySelector(".ml-market-status")?.getAttribute("data-state")).toBe("open");
    expect(container.textContent).toContain("Market open");
  });

  it("falls back without inventing a session", () => {
    const { container } = render(<MarketStatusBadge label={null} fallback="Unavailable offline" />);
    expect(container.textContent).toBe("Unavailable offline");
    expect(container.querySelector(".ml-market-status")?.getAttribute("data-state")).toBe(
      "unknown"
    );
  });
});

describe("StockQuoteCard", () => {
  it("renders symbol, name and exchange as separate elements", () => {
    render(<StockQuoteCard model={model()} onOpen={() => undefined} now={NOW} />);
    const card = screen.getByTestId("stock-card");
    expect(card.querySelector(".ml-instrument__symbol")?.textContent).toBe("RELIANCE");
    expect(card.querySelector(".ml-instrument__name")?.textContent).toBe("Reliance Industries");
    expect(card.querySelector(".ml-instrument__exchange")?.textContent).toBe("NSE");
    expect(card.textContent).toContain("₹2,845.55");
  });

  it("shows absolute and percentage change plus a direction word", () => {
    render(<StockQuoteCard model={model()} onOpen={() => undefined} now={NOW} />);
    const card = screen.getByTestId("stock-card");
    expect(card.querySelector(".ml-price-change__abs")?.textContent).toBe("+31.20");
    expect(card.querySelector(".ml-price-change__pct")?.textContent).toBe("+1.11%");
    expect(card.querySelector(".ml-price-change__word")?.textContent).toBe("up");
    expect(card.getAttribute("data-direction")).toBe("up");
  });

  it("never renders NaN or undefined for a missing quote", () => {
    render(
      <StockQuoteCard
        model={model({
          lastPrice: null,
          change: null,
          changePercent: null,
          quoteTime: null,
          sparkline: [],
        })}
        onOpen={() => undefined}
        now={NOW}
      />
    );
    const card = screen.getByTestId("stock-card");
    expect(card.textContent).not.toMatch(/NaN|undefined/);
    expect(card.textContent).toContain("—");
    expect(card.textContent).toContain("no quote available");
    expect(card.querySelector(".ml-sparkline")).toBeNull();
    expect(card.getAttribute("data-direction")).toBe("flat");
  });

  it("keeps the SAMPLE classification from the source", () => {
    render(
      <StockQuoteCard
        model={model({ mode: "SAMPLE", source: "sample" })}
        onOpen={() => undefined}
        now={NOW}
      />
    );
    const card = screen.getByTestId("stock-card");
    expect(card.getAttribute("data-mode")).toBe("SAMPLE");
    expect(card.textContent).toContain("SAMPLE");
  });

  it("is a keyboard-reachable button that opens the instrument", () => {
    const onOpen = vi.fn();
    render(<StockQuoteCard model={model()} onOpen={onOpen} now={NOW} />);
    const card = screen.getByTestId("stock-card");
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("aria-label")).toContain("open details");
    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledWith("NSE:RELIANCE:EQUITY");
  });
});

describe("IndexSummaryCard", () => {
  const indexModel = (overrides: Partial<StockCardModel> = {}) =>
    model({
      instrumentId: "NSE:NIFTY 50:INDEX",
      symbol: "NIFTY 50",
      name: "Nifty 50 Index",
      instrumentType: "INDEX",
      ...overrides,
    });

  it("leads with the index name and shows value and change", () => {
    render(<IndexSummaryCard model={indexModel()} onOpen={() => undefined} now={NOW} />);
    const card = screen.getByTestId("index-summary-card");
    expect(card.textContent).toContain("Nifty 50 Index");
    // Index levels are points, not rupee amounts.
    expect(card.textContent).toContain("2,845.55");
    expect(card.textContent).not.toContain("₹2,845.55");
    expect(card.textContent).toContain("+1.11%");
    expect(card.getAttribute("data-direction")).toBe("up");
  });

  it("draws a sparkline only when a real series exists", () => {
    const { unmount } = render(
      <IndexSummaryCard model={indexModel()} onOpen={() => undefined} now={NOW} />
    );
    expect(screen.getByTestId("index-summary-card").querySelector(".ml-sparkline")).toBeTruthy();
    unmount();

    render(<IndexSummaryCard model={indexModel({ sparkline: [] })} onOpen={() => undefined} now={NOW} />);
    expect(screen.getByTestId("index-summary-card").querySelector(".ml-sparkline")).toBeNull();
  });
});
