/**
 * Pure rules for evaluating price alerts.
 *
 * The Convex action in `convex/alerts.ts` fetches quotes and persists the
 * outcome; everything that decides *whether* an alert may fire lives here so it
 * can be tested without a deployment or a network.
 *
 * Integrity rules encoded below:
 *  - Only ACTIVE alerts are evaluated. Paused and triggered alerts are left
 *    untouched, so repeated "check now" presses cannot re-trigger history.
 *  - A quote must carry a real price to be considered at all.
 *  - Only LIVE, DELAYED and SAMPLE quotes may cross a threshold. A stale CACHED
 *    or historical series is recorded for display with its own label but can
 *    never fire, so a frozen price cannot masquerade as a market move.
 *  - An end-of-day close (EOD-only provider) is stored as an observation but can
 *    never fire: it is yesterday's price, not a move happening now.
 *  - SAMPLE crossings are counted separately, so the UI can say plainly that a
 *    demo price satisfied the condition.
 */

import type { DataMode } from "./market/types";

export type AlertDirection = "ABOVE" | "BELOW";
export type AlertStatus = "ACTIVE" | "PAUSED" | "TRIGGERED";

/** Modes that are allowed to satisfy an alert threshold. */
export const TRIGGERABLE_MODES: DataMode[] = ["LIVE", "DELAYED", "SAMPLE"];

export function isTriggerableMode(mode: DataMode): boolean {
  return TRIGGERABLE_MODES.includes(mode);
}

/** Inclusive comparison, matching `isAlertConditionMet` in `src/lib/alerts.ts`. */
export function thresholdMet(
  direction: AlertDirection,
  threshold: number,
  price: number
): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(threshold)) return false;
  return direction === "ABOVE" ? price >= threshold : price <= threshold;
}

export interface EvaluatableAlert<IdType extends string = string> {
  _id: IdType;
  instrumentId: string;
  direction: AlertDirection;
  threshold: number;
  status: AlertStatus;
}

export interface EvaluatableQuote {
  lastPrice: number;
  mode: DataMode;
  source: string;
  /** True when the price is a completed session's close. */
  eod?: boolean;
}

export interface AlertObservation<IdType extends string = string> {
  alertId: IdType;
  price: number;
  mode: DataMode;
  source: string;
  crossed: boolean;
}

export interface AlertEvaluationPlan<IdType extends string = string> {
  observations: AlertObservation<IdType>[];
  /** Alerts skipped because no usable price was available. */
  skippedNoPrice: number;
  /** Alerts whose only price was a stale or historical label; never triggered. */
  skippedStale: number;
  /** Alerts whose only price was an end-of-day close; observed, never triggered. */
  skippedEod: number;
  /** Alerts evaluated against a SAMPLE price. */
  sampleEvaluated: number;
  /** SAMPLE evaluations that satisfied the threshold. */
  sampleCrossed: number;
}

export function planAlertEvaluation<IdType extends string>(
  alerts: EvaluatableAlert<IdType>[],
  quotesByInstrument: Map<string, EvaluatableQuote>
): AlertEvaluationPlan<IdType> {
  const plan: AlertEvaluationPlan<IdType> = {
    observations: [],
    skippedNoPrice: 0,
    skippedStale: 0,
    skippedEod: 0,
    sampleEvaluated: 0,
    sampleCrossed: 0,
  };

  for (const alert of alerts) {
    if (alert.status !== "ACTIVE") continue;

    const quote = quotesByInstrument.get(alert.instrumentId);
    if (!quote || !Number.isFinite(quote.lastPrice) || quote.lastPrice <= 0) {
      plan.skippedNoPrice += 1;
      continue;
    }

    if (quote.eod) {
      // Recorded so the UI can show what the last close was, but a threshold
      // crossed by yesterday's close is not a live alert event.
      plan.skippedEod += 1;
      plan.observations.push({
        alertId: alert._id,
        price: quote.lastPrice,
        mode: quote.mode,
        source: quote.source,
        crossed: false,
      });
      continue;
    }

    const triggerable = isTriggerableMode(quote.mode);
    if (!triggerable) plan.skippedStale += 1;

    const crossed = triggerable && thresholdMet(alert.direction, alert.threshold, quote.lastPrice);

    if (quote.mode === "SAMPLE") {
      plan.sampleEvaluated += 1;
      if (crossed) plan.sampleCrossed += 1;
    }

    plan.observations.push({
      alertId: alert._id,
      price: quote.lastPrice,
      mode: quote.mode,
      source: quote.source,
      crossed,
    });
  }

  return plan;
}
