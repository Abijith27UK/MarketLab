/**
 * Pure alert helpers shared by the Alerts page and its tests.
 *
 * The backend re-validates everything here; these rules exist so the form can
 * explain a problem before a round-trip, not to enforce it.
 */

export type AlertDirection = "ABOVE" | "BELOW";

export const ALERT_DIRECTION_LABEL: Record<AlertDirection, string> = {
  ABOVE: "Rises above",
  BELOW: "Falls below",
};

export const MAX_ALERT_THRESHOLD = 1_000_000;

export interface AlertDraft {
  instrumentId: string;
  direction: AlertDirection;
  threshold: string;
  note?: string;
}

export function formatAlertCondition(direction: AlertDirection, threshold: number): string {
  return `Price ${direction === "ABOVE" ? "≥" : "≤"} ₹${threshold.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** True when `price` satisfies the threshold in the given direction. */
export function isAlertConditionMet(
  direction: AlertDirection,
  threshold: number,
  price: number
): boolean {
  if (!Number.isFinite(price) || !Number.isFinite(threshold)) return false;
  return direction === "ABOVE" ? price >= threshold : price <= threshold;
}

/** Returns a human-readable problem, or null when the draft can be submitted. */
export function validateAlertDraft(draft: AlertDraft): string | null {
  if (!draft.instrumentId.trim()) return "Choose an instrument first.";
  const threshold = Number(draft.threshold);
  if (!draft.threshold.trim() || !Number.isFinite(threshold)) {
    return "Enter a numeric threshold price.";
  }
  if (threshold <= 0) return "Threshold must be greater than zero.";
  if (threshold > MAX_ALERT_THRESHOLD) return "Threshold is unrealistically large.";
  if ((draft.note ?? "").trim().length > 160) return "Keep the note under 160 characters.";
  return null;
}
