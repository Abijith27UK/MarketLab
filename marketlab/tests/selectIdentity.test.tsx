// @vitest-environment jsdom
/**
 * Regression tests for two defects found while verifying the watchlist flow
 * against the live backend:
 *
 * 1. `Select` kept a private copy of its selection, so the displayed option and
 *    the parent's value could disagree after the option list changed.
 * 2. The instrument dropdown keyed options by bare symbol. RELIANCE and TCS are
 *    listed on both NSE and BSE, so keys repeated, React reused the wrong rows
 *    and selecting a watchlist silently cleared the chosen instrument.
 */
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Select } from "@/components/ui/select";
import { DEMO_INSTRUMENTS, parseInstrumentId } from "@/lib/demoCatalogue";

afterEach(cleanup);

const crossExchange = [
  { value: "NSE:RELIANCE:EQUITY", label: "RELIANCE - Reliance Industries (NSE)" },
  { value: "BSE:RELIANCE:EQUITY", label: "RELIANCE - Reliance Industries (BSE)" },
  { value: "NSE:TCS:EQUITY", label: "TCS - Tata Consultancy Services (NSE)" },
  { value: "BSE:TCS:EQUITY", label: "TCS - Tata Consultancy Services (BSE)" },
];

describe("Select display follows the value prop", () => {
  it("shows the label for the current value, not the placeholder", () => {
    render(<Select options={crossExchange} value="BSE:TCS:EQUITY" onSelect={() => {}} />);
    expect(screen.getByRole("button").textContent).toContain("(BSE)");
  });

  it("updates when the parent changes the value", () => {
    const { rerender } = render(
      <Select options={crossExchange} value="NSE:TCS:EQUITY" onSelect={() => {}} />
    );
    expect(screen.getByRole("button").textContent).toContain("(NSE)");

    rerender(<Select options={crossExchange} value="BSE:TCS:EQUITY" onSelect={() => {}} />);
    expect(screen.getByRole("button").textContent).toContain("(BSE)");
  });

  it("falls back to the placeholder when the value is cleared", () => {
    const { rerender } = render(
      <Select
        options={crossExchange}
        value="NSE:TCS:EQUITY"
        onSelect={() => {}}
        placeholder="Select instrument"
      />
    );
    rerender(
      <Select options={crossExchange} value="" onSelect={() => {}} placeholder="Select instrument" />
    );
    expect(screen.getByRole("button").textContent).toContain("Select instrument");
  });

  it("offers one distinct row per value even when labels share a symbol", () => {
    render(<Select options={crossExchange} value="" onSelect={() => {}} />);
    fireEvent.click(screen.getByRole("button"));

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.textContent)).size).toBe(4);
  });

  it("reports the canonical id of the row that was clicked", () => {
    const onSelect = vi.fn();
    render(<Select options={crossExchange} value="" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByText("RELIANCE - Reliance Industries (BSE)"));
    expect(onSelect).toHaveBeenCalledWith("BSE:RELIANCE:EQUITY");
  });
});

describe("instrument ids are unique and canonical", () => {
  it("never repeats an instrument id across exchanges", () => {
    const ids = DEMO_INSTRUMENTS.map((instrument) => instrument.instrumentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps both RELIANCE listings as separate ids", () => {
    const reliance = DEMO_INSTRUMENTS.filter((instrument) => instrument.symbol === "RELIANCE");
    expect(reliance.length).toBeGreaterThanOrEqual(2);
    expect(reliance[0].instrumentId).not.toBe(reliance[1].instrumentId);
    expect(reliance.every((instrument) => parseInstrumentId(instrument.instrumentId) !== null)).toBe(
      true
    );
  });
});
