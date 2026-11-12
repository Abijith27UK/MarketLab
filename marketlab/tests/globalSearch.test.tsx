// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The offline path intentionally touches no Convex hooks; stub both modules so
// this test exercises the demo search and keyboard handling only.
vi.mock("@/context/RootContext", () => ({
  useRootContext: () => ({ backendOnline: false, isAuthenticated: false, loading: false }),
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => async () => undefined,
  useAction: () => async () => undefined,
}));
vi.mock("@/convex/_generated/api", () => ({ api: {} }));

import GlobalSearch from "@/components/system/GlobalSearch";

afterEach(cleanup);

const openDialog = () => {
  fireEvent.click(screen.getByTestId("global-search-trigger"));
  return screen.getByTestId("global-search-input");
};

describe("GlobalSearch", () => {
  it("opens with the trigger and focuses the input", () => {
    render(<GlobalSearch onOpenInstrument={() => undefined} />);
    const input = openDialog();
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("filters the sample catalogue and shows SAMPLE labels while offline", () => {
    render(<GlobalSearch onOpenInstrument={() => undefined} />);
    const input = openDialog();
    fireEvent.change(input, { target: { value: "RELIANCE" } });

    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options[0].textContent).toContain("RELIANCE");
    expect(screen.getAllByText("SAMPLE").length).toBeGreaterThan(0);
  });

  it("shows an explicit no-results message", () => {
    render(<GlobalSearch onOpenInstrument={() => undefined} />);
    const input = openDialog();
    fireEvent.change(input, { target: { value: "NOTAREALSTOCK" } });
    expect(screen.getByTestId("global-search-empty").textContent).toMatch(/no sample instrument/i);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("opens the first match on Enter", () => {
    const onOpen = vi.fn();
    render(<GlobalSearch onOpenInstrument={onOpen} />);
    const input = openDialog();
    fireEvent.change(input, { target: { value: "TCS" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatch(/^NSE:TCS:EQUITY$/);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves the highlight with the arrow keys before opening", () => {
    const onOpen = vi.fn();
    render(<GlobalSearch onOpenInstrument={onOpen} />);
    const input = openDialog();
    fireEvent.change(input, { target: { value: "TCS" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onOpen).toHaveBeenCalledTimes(1);
    // The catalogue holds an NSE and a BSE listing, so the second row is the BSE one.
    expect(onOpen.mock.calls[0][0]).toBe("BSE:TCS:EQUITY");
  });

  it("closes on Escape without opening anything", () => {
    const onOpen = vi.fn();
    render(<GlobalSearch onOpenInstrument={onOpen} />);
    const input = openDialog();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("toggles with Ctrl+K", () => {
    render(<GlobalSearch onOpenInstrument={() => undefined} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("renders the palette outside the sidebar so navigation is never pushed", () => {
    const { container } = render(<GlobalSearch onOpenInstrument={() => undefined} />);
    openDialog();
    const dialog = screen.getByRole("dialog");
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it("clears the query from the clear button and keeps focus in the input", () => {
    render(<GlobalSearch onOpenInstrument={() => undefined} />);
    const input = openDialog();
    fireEvent.change(input, { target: { value: "TCS" } });

    fireEvent.click(screen.getByTestId("global-search-clear"));

    const cleared = screen.getByTestId("global-search-input") as HTMLInputElement;
    expect(cleared.value).toBe("");
    expect(document.activeElement).toBe(cleared);
    expect(screen.queryByTestId("global-search-clear")).toBeNull();
  });

  it("returns focus to the trigger when the palette closes", () => {
    render(<GlobalSearch onOpenInstrument={() => undefined} />);
    const trigger = screen.getByTestId("global-search-trigger");
    trigger.focus();
    fireEvent.click(trigger);
    const input = screen.getByTestId("global-search-input");
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

});
