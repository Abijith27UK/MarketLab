import { describe, expect, it } from "vitest";
import { filterDemoInstruments, nextIndex } from "../src/lib/search";
import {
  ALERT_DIRECTION_LABEL,
  formatAlertCondition,
  isAlertConditionMet,
  validateAlertDraft,
} from "../src/lib/alerts";

describe("Global search matching", () => {
  it("returns a bounded default list for an empty query", () => {
    const rows = filterDemoInstruments("", 6);
    expect(rows.length).toBe(6);
  });

  it("prefers symbol prefix matches over name contains matches", () => {
    const rows = filterDemoInstruments("REL");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].symbol.startsWith("REL")).toBe(true);
  });

  it("matches company names case-insensitively", () => {
    const rows = filterDemoInstruments("tata consultancy");
    expect(rows.some((row) => row.symbol === "TCS")).toBe(true);
  });

  it("returns nothing for a query that matches no instrument", () => {
    expect(filterDemoInstruments("ZZZZZZ-NOT-A-STOCK")).toEqual([]);
  });

  it("honours the result limit", () => {
    expect(filterDemoInstruments("", 3).length).toBe(3);
  });
});

describe("Global search keyboard navigation", () => {
  it("moves forward and wraps at the end", () => {
    expect(nextIndex(-1, 4, 1)).toBe(0);
    expect(nextIndex(0, 4, 1)).toBe(1);
    expect(nextIndex(3, 4, 1)).toBe(0);
  });

  it("moves backward and wraps at the start", () => {
    expect(nextIndex(0, 4, -1)).toBe(3);
    expect(nextIndex(-1, 4, -1)).toBe(3);
  });

  it("returns -1 for an empty result set", () => {
    expect(nextIndex(0, 0, 1)).toBe(-1);
  });
});

describe("Alert validation and conditions", () => {
  const base = { instrumentId: "NSE:RELIANCE:EQUITY", direction: "ABOVE" as const, threshold: "1500" };

  it("accepts a well-formed draft", () => {
    expect(validateAlertDraft(base)).toBeNull();
  });

  it("requires an instrument", () => {
    expect(validateAlertDraft({ ...base, instrumentId: "" })).toMatch(/instrument/i);
  });

  it("rejects non-numeric and non-positive thresholds", () => {
    expect(validateAlertDraft({ ...base, threshold: "abc" })).toMatch(/numeric/i);
    expect(validateAlertDraft({ ...base, threshold: "0" })).toMatch(/greater than zero/i);
    expect(validateAlertDraft({ ...base, threshold: "-5" })).toMatch(/greater than zero/i);
  });

  it("rejects an unrealistically large threshold", () => {
    expect(validateAlertDraft({ ...base, threshold: "9999999" })).toMatch(/large/i);
  });

  it("rejects an over-long note", () => {
    expect(validateAlertDraft({ ...base, note: "x".repeat(200) })).toMatch(/note/i);
  });

  it("evaluates ABOVE and BELOW thresholds inclusively", () => {
    expect(isAlertConditionMet("ABOVE", 100, 100)).toBe(true);
    expect(isAlertConditionMet("ABOVE", 100, 99.99)).toBe(false);
    expect(isAlertConditionMet("BELOW", 100, 100)).toBe(true);
    expect(isAlertConditionMet("BELOW", 100, 100.01)).toBe(false);
  });

  it("treats non-finite prices as unmet rather than triggered", () => {
    expect(isAlertConditionMet("ABOVE", 100, Number.NaN)).toBe(false);
    expect(isAlertConditionMet("BELOW", 100, Infinity)).toBe(false);
  });

  it("formats the condition with the direction wording", () => {
    expect(formatAlertCondition("ABOVE", 1500)).toContain("≥");
    expect(formatAlertCondition("BELOW", 1500)).toContain("≤");
    expect(ALERT_DIRECTION_LABEL.ABOVE).toMatch(/above/i);
  });
});

describe("Friendly error formatting", () => {
  it("strips Convex transport metadata and keeps the handler message", async () => {
    const { friendlyError } = await import("../src/lib/errors");
    const wrapped = new Error(
      "[CONVEX M(alerts:create)] [Request ID: abc123] Server Error\nUncaught Error: Instrument not found\n    at handler (../convex/alerts.ts:80:19)"
    );
    expect(friendlyError(wrapped)).toBe("Instrument not found");
  });

  it("falls back instead of echoing an opaque server error line", async () => {
    const { friendlyError } = await import("../src/lib/errors");
    expect(friendlyError(new Error("Server Error"), "Try again")).toBe("Try again");
    expect(friendlyError(new Error("[CONVEX M(x)] [Request ID: 1] Server Error"), "Try again")).toBe(
      "Try again"
    );
  });

  it("handles non-Error values", async () => {
    const { friendlyError } = await import("../src/lib/errors");
    expect(friendlyError("plain message")).toBe("plain message");
    expect(friendlyError(null, "fallback")).toBe("fallback");
  });
});
