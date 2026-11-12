import React from "react";

export type MarketSessionState = "open" | "pre" | "closed" | "unknown";

/**
 * Maps the session label the backend reports onto a visual state. The label
 * itself is always shown verbatim — the mapping only drives the dot colour.
 */
const stateOf = (label: string | null | undefined): MarketSessionState => {
  if (!label) return "unknown";
  const text = label.toLowerCase();
  if (text.includes("pre")) return "pre";
  if (text.includes("open")) return "open";
  if (text.includes("closed") || text.includes("weekend") || text.includes("holiday")) {
    return "closed";
  }
  return "unknown";
};

export interface MarketStatusBadgeProps {
  label?: string | null;
  /** Shown when the session is not available at all. */
  fallback?: string;
  className?: string;
}

/** Session label with a state dot. Never infers a session that was not reported. */
export const MarketStatusBadge: React.FC<MarketStatusBadgeProps> = ({
  label,
  fallback,
  className = "",
}) => {
  const state = stateOf(label);
  return (
    <span
      className={["ml-market-status", className].filter(Boolean).join(" ")}
      data-state={state}
      title={label ?? fallback ?? undefined}
    >
      <span className="ml-market-status__dot" aria-hidden="true" />
      {label ?? fallback ?? "Unknown session"}
    </span>
  );
};

export default MarketStatusBadge;
