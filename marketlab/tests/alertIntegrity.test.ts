import { describe, expect, it } from "vitest";
import {
  isTriggerableMode,
  planAlertEvaluation,
  thresholdMet,
  type EvaluatableAlert,
  type EvaluatableQuote,
} from "../convex/alertsCore";
import { isAlertConditionMet } from "../src/lib/alerts";

/**
 * Alert integrity rules, tested against the same planner the Convex evaluation
 * action uses. Persistence-level behaviour (state stored in `priceAlerts`) is
 * covered by the browser checks in docs/RELEASE_READINESS.md, because those
 * mutations need a live deployment.
 */

const alert = (over: Partial<EvaluatableAlert> = {}): EvaluatableAlert => ({
  _id: "alert-1",
  instrumentId: "NSE:RELIANCE:EQUITY",
  direction: "ABOVE",
  threshold: 100,
  status: "ACTIVE",
  ...over,
});

const quote = (over: Partial<EvaluatableQuote> = {}): EvaluatableQuote => ({
  lastPrice: 100,
  mode: "LIVE",
  source: "fyers",
  ...over,
});

const quotes = (entries: [string, EvaluatableQuote][]) => new Map(entries);

describe("threshold comparison", () => {
  it("matches the UI helper for every mode and boundary", () => {
    const cases: [("ABOVE" | "BELOW"), number, number][] = [
      ["ABOVE", 100, 100],
      ["ABOVE", 100, 100.01],
      ["ABOVE", 100, 99.99],
      ["BELOW", 100, 100],
      ["BELOW", 100, 99.99],
      ["BELOW", 100, 100.01],
    ];
    for (const [direction, threshold, price] of cases) {
      expect(thresholdMet(direction, threshold, price)).toBe(
        isAlertConditionMet(direction, threshold, price)
      );
    }
  });

  it("treats non-finite values as unmet", () => {
    expect(thresholdMet("ABOVE", 100, Number.NaN)).toBe(false);
    expect(thresholdMet("BELOW", Number.NaN, 100)).toBe(false);
    expect(thresholdMet("BELOW", 100, Infinity)).toBe(false);
  });
});

describe("alert states", () => {
  it("evaluates only ACTIVE alerts", () => {
    const plan = planAlertEvaluation(
      [
        alert({ _id: "active" }),
        alert({ _id: "paused", status: "PAUSED" }),
        alert({ _id: "triggered", status: "TRIGGERED" }),
      ],
      quotes([["NSE:RELIANCE:EQUITY", quote()]])
    );
    expect(plan.observations.map((o) => o.alertId)).toEqual(["active"]);
    expect(plan.observations[0].crossed).toBe(true);
  });

  it("leaves a triggered alert out of a repeated evaluation", () => {
    // Evaluation #1 fires the alert; the stored row becomes TRIGGERED.
    const first = planAlertEvaluation([alert()], quotes([["NSE:RELIANCE:EQUITY", quote()]]));
    expect(first.observations[0].crossed).toBe(true);

    // Evaluation #2 sees the same quote but the alert is no longer ACTIVE, so
    // there is nothing to apply and no duplicate trigger can be recorded.
    const second = planAlertEvaluation(
      [alert({ status: "TRIGGERED" })],
      quotes([["NSE:RELIANCE:EQUITY", quote()]])
    );
    expect(second.observations).toHaveLength(0);
    expect(second.skippedNoPrice).toBe(0);
  });

  it("evaluates a re-armed alert again", () => {
    const plan = planAlertEvaluation(
      [alert({ status: "ACTIVE" })],
      quotes([["NSE:RELIANCE:EQUITY", quote({ lastPrice: 120 })]])
    );
    expect(plan.observations).toHaveLength(1);
    expect(plan.observations[0].crossed).toBe(true);
  });
});

describe("quote eligibility", () => {
  it("fires on fresh provider and delayed quotes", () => {
    expect(isTriggerableMode("LIVE")).toBe(true);
    expect(isTriggerableMode("DELAYED")).toBe(true);
  });

  it("never fires on a stale cached or historical price", () => {
    for (const mode of ["CACHED", "HISTORICAL"] as const) {
      const plan = planAlertEvaluation(
        [alert()],
        quotes([["NSE:RELIANCE:EQUITY", quote({ mode, lastPrice: 500 })]])
      );
      expect(plan.observations).toHaveLength(1);
      expect(plan.observations[0].crossed).toBe(false);
      expect(plan.observations[0].mode).toBe(mode);
      expect(plan.skippedStale).toBe(1);
      expect(plan.sampleCrossed).toBe(0);
    }
  });

  it("skips an alert with no quote or an unusable price", () => {
    const missing = planAlertEvaluation([alert()], quotes([]));
    expect(missing.observations).toHaveLength(0);
    expect(missing.skippedNoPrice).toBe(1);

    for (const lastPrice of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const plan = planAlertEvaluation(
        [alert()],
        quotes([["NSE:RELIANCE:EQUITY", quote({ lastPrice })]])
      );
      expect(plan.observations).toHaveLength(0);
      expect(plan.skippedNoPrice).toBe(1);
    }
  });

  it("does not borrow another instrument's quote", () => {
    const plan = planAlertEvaluation(
      [alert({ instrumentId: "NSE:TCS:EQUITY" })],
      quotes([["NSE:RELIANCE:EQUITY", quote({ lastPrice: 999 })]])
    );
    expect(plan.observations).toHaveLength(0);
    expect(plan.skippedNoPrice).toBe(1);
  });
});

describe("sample labelling", () => {
  it("counts SAMPLE crossings separately and keeps the label", () => {
    const plan = planAlertEvaluation(
      [alert()],
      quotes([["NSE:RELIANCE:EQUITY", quote({ mode: "SAMPLE", source: "sample" })]])
    );
    expect(plan.observations[0].crossed).toBe(true);
    expect(plan.observations[0].mode).toBe("SAMPLE");
    expect(plan.observations[0].source).toBe("sample");
    expect(plan.sampleEvaluated).toBe(1);
    expect(plan.sampleCrossed).toBe(1);
  });

  it("does not count a sample alert that did not cross", () => {
    const plan = planAlertEvaluation(
      [alert({ threshold: 101 })],
      quotes([["NSE:RELIANCE:EQUITY", quote({ mode: "SAMPLE", source: "sample" })]])
    );
    expect(plan.sampleEvaluated).toBe(1);
    expect(plan.sampleCrossed).toBe(0);
    expect(plan.observations[0].crossed).toBe(false);
  });

  it("keeps sample and provider observations distinguishable in one run", () => {
    const plan = planAlertEvaluation(
      [
        alert({ _id: "a", instrumentId: "NSE:RELIANCE:EQUITY" }),
        alert({ _id: "b", instrumentId: "NSE:TCS:EQUITY" }),
      ],
      quotes([
        ["NSE:RELIANCE:EQUITY", quote({ mode: "DELAYED", source: "tapetide" })],
        ["NSE:TCS:EQUITY", quote({ mode: "SAMPLE", source: "sample" })],
      ])
    );
    const byId = new Map(plan.observations.map((o) => [o.alertId, o]));
    expect(byId.get("a")?.mode).toBe("DELAYED");
    expect(byId.get("a")?.source).toBe("tapetide");
    expect(byId.get("b")?.mode).toBe("SAMPLE");
    expect(plan.sampleEvaluated).toBe(1);
    expect(plan.sampleCrossed).toBe(1);
  });
});

describe("counts", () => {
  it("summarizes a mixed evaluation without losing skipped alerts", () => {
    const plan = planAlertEvaluation(
      [
        alert({ _id: "fire", instrumentId: "NSE:A:EQUITY" }),
        alert({ _id: "stale", instrumentId: "NSE:B:EQUITY" }),
        alert({ _id: "none", instrumentId: "NSE:C:EQUITY" }),
        alert({ _id: "paused", status: "PAUSED" }),
      ],
      quotes([
        ["NSE:A:EQUITY", quote({ lastPrice: 150 })],
        ["NSE:B:EQUITY", quote({ mode: "CACHED", lastPrice: 150 })],
      ])
    );
    expect(plan.observations).toHaveLength(2);
    expect(plan.observations.filter((o) => o.crossed)).toHaveLength(1);
    expect(plan.skippedNoPrice).toBe(1);
    expect(plan.skippedStale).toBe(1);
  });
});
