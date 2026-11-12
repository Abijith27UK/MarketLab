// @vitest-environment jsdom
/**
 * Regression coverage for the redesign's shell, search trigger, quote cards and
 * empty states. Assertions are behavioural (roles, labels, test ids, rendered
 * text) rather than class-level wherever a user-visible outcome exists.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "@/App";
import type { BackendState } from "@/hooks/useBackendStatus";
import { OfflineRootProvider } from "@/context/RootContext";
import GlobalSearch from "@/components/system/GlobalSearch";
import StockCard from "@/components/market/StockCard";
import PositionsTable from "@/components/paper/PositionsTable";
import { modelFromQuote } from "@/lib/stockModels";

afterEach(() => {
  cleanup();
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
});

const offlineState = (): BackendState => ({
  status: "offline",
  url: "http://127.0.0.1:3210",
  error: "Connection refused or host unreachable",
  attempt: 1,
  lastCheckedAt: Date.now(),
  lastOnlineAt: null,
  latencyMs: null,
  nextRetryInMs: 4000,
  retryNow: vi.fn(),
});

/** jsdom ships no matchMedia; the app only reads `matches` and event hooks. */
const withViewport = (width: number) => {
  window.matchMedia = ((query: string) => {
    const limit = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: limit ? width <= Number(limit[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
};

const sidebar = () => document.querySelector("aside.ml-sidebar") as HTMLElement;

describe("Shell navigation", () => {
  it("exposes a skip link that targets the focusable main region", () => {
    withViewport(1440);
    render(<App backend={offlineState()} />);

    const link = document.querySelector(".ml-skip-link") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toBe("#main-content");

    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.getAttribute("tabindex")).toBe("-1");
  });

  it("collapses and expands the desktop rail", () => {
    withViewport(1440);
    render(<App backend={offlineState()} />);

    const toggle = screen.getByTestId("sidebar-toggle");
    const shell = () => document.querySelector(".ml-shell") as HTMLElement;

    expect(shell().className).not.toContain("is-collapsed");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse sidebar");

    fireEvent.click(toggle);
    expect(shell().className).toContain("is-collapsed");
    expect(toggle.getAttribute("aria-label")).toBe("Expand sidebar");

    fireEvent.click(toggle);
    expect(shell().className).not.toContain("is-collapsed");
  });

  it("navigates from the sidebar and marks the active route", () => {
    withViewport(1440);
    render(<App backend={offlineState()} />);

    const markets = within(sidebar()).getByRole("button", { name: "Markets" });
    fireEvent.click(markets);

    expect(markets.getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1, name: "Markets" })).toBeTruthy();
    expect(within(sidebar()).getByRole("button", { name: "Dashboard" }).getAttribute("aria-current")).toBeNull();
  });

  it("opens the mobile drawer, closes it with Escape and exposes it as a toggle", () => {
    withViewport(390);
    render(<App backend={offlineState()} />);

    const menu = screen.getByTestId("menu-button");
    expect(sidebar().className).not.toContain("is-open");
    expect(menu.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menu);
    expect(sidebar().className).toContain("is-open");
    expect(document.querySelector(".ml-scrim")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(sidebar().className).not.toContain("is-open");
    expect(document.querySelector(".ml-scrim")).toBeNull();
  });
});

describe("Search trigger", () => {
  it("keeps an accessible name when the visible label is hidden on mobile", () => {
    withViewport(390);
    render(
      <OfflineRootProvider onRetry={() => undefined}>
        <GlobalSearch onOpenInstrument={() => undefined} />
      </OfflineRootProvider>
    );

    const trigger = screen.getByTestId("global-search-trigger");
    expect(trigger.getAttribute("aria-label")).toBe("Search instruments");
    expect(screen.getByRole("button", { name: "Search instruments" })).toBe(trigger);
  });

  it("opens from the trigger and closes on Escape without selecting", () => {
    withViewport(390);
    const onOpen = vi.fn();
    render(
      <OfflineRootProvider onRetry={() => undefined}>
        <GlobalSearch onOpenInstrument={onOpen} />
      </OfflineRootProvider>
    );

    fireEvent.click(screen.getByTestId("global-search-trigger"));
    const input = screen.getByTestId("global-search-input");
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("Quote and empty states", () => {
  it("renders placeholder values, never NaN, when an instrument has no quote", () => {
    const model = modelFromQuote(
      {
        instrumentId: "NSE:NOQUOTE:EQUITY",
        symbol: "NOQUOTE",
        name: "No Quote Industries",
        exchange: "NSE",
        instrumentType: "EQUITY",
        isSampleData: true,
      },
      null
    );

    render(<StockCard model={model} onOpen={() => undefined} now={Date.now()} />);

    const card = screen.getByTestId("stock-card");
    expect(card.textContent).not.toMatch(/NaN|undefined/);
    expect(card.textContent).toMatch(/—/);
  });

  it("keeps the positions empty hook while showing the provided action", () => {
    render(
      <PositionsTable
        positions={[]}
        emptyAction={
          <button type="button" data-testid="empty-action">
            Place a paper order
          </button>
        }
      />
    );

    expect(screen.getByTestId("positions-empty")).toBeTruthy();
    expect(screen.getByTestId("empty-action").textContent).toBe("Place a paper order");
    expect(screen.queryByTestId("positions-table")).toBeNull();
  });
});
