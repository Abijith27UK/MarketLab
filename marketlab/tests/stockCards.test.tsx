// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import StockCard from "@/components/market/StockCard";
import Sparkline from "@/components/market/Sparkline";
import DataModeBadge from "@/components/market/DataModeBadge";
import { DashboardDemo } from "@/pages/Dashboard";
import { MarketsDemo } from "@/pages/Markets";
import { DEMO_INSTRUMENTS, demoQuote } from "@/lib/demoCatalogue";
import type { StockCardModel } from "@/lib/stockModels";

afterEach(cleanup);

const baseModel = (overrides: Partial<StockCardModel> = {}): StockCardModel => ({
  instrumentId: "NSE:RELIANCE:EQUITY",
  symbol: "RELIANCE",
  name: "Reliance Industries",
  exchange: "NSE",
  instrumentType: "EQUITY",
  lastPrice: 2845.55,
  change: 31.2,
  changePercent: 1.11,
  mode: "SAMPLE",
  source: "sample",
  quoteTime: Date.now() - 60_000,
  sparkline: [2800, 2810, 2830, 2825, 2845.55],
  sampleCatalogue: true,
  ...overrides,
});

describe("StockCard", () => {
  it("renders name, symbol, exchange, price and change", () => {
    render(<StockCard model={baseModel()} onOpen={() => {}} now={Date.now()} />);
    const card = screen.getByTestId("stock-card");

    expect(within(card).getByText("RELIANCE")).toBeTruthy();
    expect(within(card).getByText("Reliance Industries")).toBeTruthy();
    expect(within(card).getByText("NSE")).toBeTruthy();
    expect(card.textContent).toMatch(/₹/);
    expect(card.textContent).toMatch(/\+1\.11%/);
    expect(card.textContent).toMatch(/SAMPLE/);
  });

  it("communicates direction with a word, not colour alone", () => {
    const { unmount } = render(
      <StockCard model={baseModel()} onOpen={() => {}} now={Date.now()} />
    );
    expect(screen.getByTestId("stock-card").getAttribute("data-direction")).toBe("up");
    expect(screen.getByText("up")).toBeTruthy();
    unmount();

    render(
      <StockCard
        model={baseModel({ change: -12, changePercent: -0.42 })}
        onOpen={() => {}}
        now={Date.now()}
      />
    );
    expect(screen.getByTestId("stock-card").getAttribute("data-direction")).toBe("down");
    expect(screen.getByText("down")).toBeTruthy();
  });

  it("is a native button that opens the instrument when activated", () => {
    const onOpen = vi.fn();
    render(<StockCard model={baseModel()} onOpen={onOpen} now={Date.now()} />);
    const card = screen.getByTestId("stock-card");

    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("tabindex")).toBeNull(); // focusable by default
    expect(card.getAttribute("aria-label")).toContain("open details");
    expect(card.getAttribute("data-instrument-id")).toBe("NSE:RELIANCE:EQUITY");

    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("NSE:RELIANCE:EQUITY");
  });

  it("shows the data mode from the source and never upgrades it", () => {
    const { unmount } = render(
      <StockCard model={baseModel({ mode: "LIVE", source: "fyers" })} onOpen={() => {}} now={Date.now()} />
    );
    let card = screen.getByTestId("stock-card");
    expect(card.getAttribute("data-mode")).toBe("LIVE");
    expect(card.textContent).toMatch(/LIVE/);
    expect(card.textContent).toMatch(/fyers/);
    unmount();

    render(<StockCard model={baseModel()} onOpen={() => {}} now={Date.now()} />);
    card = screen.getByTestId("stock-card");
    expect(card.getAttribute("data-mode")).toBe("SAMPLE");
  });

  it("omits the sparkline when no series exists and shows — for a missing price", () => {
    render(
      <StockCard
        model={baseModel({ lastPrice: null, change: null, changePercent: null, sparkline: [] })}
        onOpen={() => {}}
        now={Date.now()}
      />
    );
    const card = screen.getByTestId("stock-card");
    expect(card.querySelector(".ml-sparkline")).toBeNull();
    expect(card.textContent).toContain("—");
    expect(card.textContent).toMatch(/no quote available/);
  });

  it("renders a sparkline only for a series with at least two points", () => {
    const { unmount } = render(
      <Sparkline values={[10, 12]} direction="up" label="two points" />
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("two points");
    unmount();

    render(<Sparkline values={[10]} direction="up" label="one point" />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("labels every data mode badge distinctly", () => {
    const modes = ["LIVE", "DELAYED", "CACHED", "HISTORICAL", "SAMPLE"] as const;
    const { container } = render(
      <div>
        {modes.map((mode) => (
          <DataModeBadge key={mode} mode={mode} />
        ))}
      </div>
    );
    const badges = Array.from(container.querySelectorAll(".ml-data-mode"));
    expect(badges).toHaveLength(modes.length);
    expect(badges.map((badge) => badge.getAttribute("data-mode"))).toEqual([...modes]);
  });
});

describe("DashboardDemo", () => {
  it("renders index cards and a clickable stock-card grid, all labelled SAMPLE", () => {
    render(<DashboardDemo onNavigate={() => {}} onOpenInstrument={() => {}} />);

    const cards = screen.getAllByTestId("stock-card");
    expect(cards).toHaveLength(13); // 3 indices + 10 NSE equities

    const modes = new Set(cards.map((card) => card.getAttribute("data-mode")));
    expect([...modes]).toEqual(["SAMPLE"]);
    expect(screen.getByTestId("demo-chip").textContent).toMatch(/SAMPLE DATA/);
    expect(document.body.textContent).not.toMatch(/\bLIVE\b/);
  });

  it("opens the instrument that was clicked", () => {
    const onOpenInstrument = vi.fn();
    render(<DashboardDemo onNavigate={() => {}} onOpenInstrument={onOpenInstrument} />);

    const reliance = screen
      .getAllByTestId("stock-card")
      .find((card) => card.getAttribute("data-instrument-id") === "NSE:RELIANCE:EQUITY");
    expect(reliance).toBeTruthy();
    fireEvent.click(reliance!);
    expect(onOpenInstrument).toHaveBeenCalledWith("NSE:RELIANCE:EQUITY");
  });

  it("does not invent account balances or ranking data", () => {
    render(<DashboardDemo onNavigate={() => {}} onOpenInstrument={() => {}} />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Available cash/);
    expect(text).toMatch(/Account features are paused/);
  });

  it("renders deterministic prices across mounts", () => {
    const { unmount } = render(<DashboardDemo onNavigate={() => {}} onOpenInstrument={() => {}} />);
    const first = screen.getAllByTestId("stock-card")[0].textContent;
    unmount();

    render(<DashboardDemo onNavigate={() => {}} onOpenInstrument={() => {}} />);
    const second = screen.getAllByTestId("stock-card")[0].textContent;
    expect(second).toBe(first);
  });
});

describe("MarketsDemo", () => {
  it("lists the whole sample catalogue and filters by search", () => {
    render(<MarketsDemo onOpenInstrument={() => {}} />);
    expect(screen.getAllByTestId("stock-card")).toHaveLength(DEMO_INSTRUMENTS.length);

    fireEvent.change(screen.getByPlaceholderText("Search symbol or company"), {
      target: { value: "TCS" },
    });
    expect(screen.getAllByTestId("stock-card")).toHaveLength(2); // NSE + BSE
    expect(screen.getByTestId("demo-result-count").textContent).toMatch(
      `2 of ${DEMO_INSTRUMENTS.length}`
    );
  });

  it("shows an empty state when nothing matches", () => {
    render(<MarketsDemo onOpenInstrument={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Search symbol or company"), {
      target: { value: "ZZZZNOTREAL" },
    });
    expect(screen.queryAllByTestId("stock-card")).toHaveLength(0);
    expect(screen.getByText(/No sample instrument matches/)).toBeTruthy();
  });
});

describe("sample quotes", () => {
  it("are stable inside the same sample bucket", () => {
    const instrument = DEMO_INSTRUMENTS[0];
    const now = Date.now();
    const first = demoQuote(instrument, now);
    const second = demoQuote(instrument, now + 1000);
    expect(second.lastPrice).toBe(first.lastPrice);
    expect(second.changePercent).toBe(first.changePercent);
    expect(first.mode).toBe("SAMPLE");
  });
});
