import React from "react";
import { useQuery } from "convex/react";
import { marketApi } from "@/lib/marketClient";
import { useRootContext } from "@/context/RootContext";

/**
 * Session / data-freshness indicator for the top bar.
 *
 * The backend label is shown verbatim. When no deployment is reachable the
 * pill says SAMPLE rather than implying a live session.
 */
/** Colour driver only — the reported label is always rendered verbatim. */
const stateOf = (label: string | null | undefined): string => {
  if (!label) return "unknown";
  const text = label.toLowerCase();
  if (text.includes("pre")) return "pre";
  if (text.includes("open")) return "open";
  if (text.includes("closed") || text.includes("weekend") || text.includes("holiday")) {
    return "closed";
  }
  return "unknown";
};

/** One word for narrow top bars, where the full sentence cannot fit. */
const shortOf = (label: string): string => {
  const state = stateOf(label);
  if (state === "pre") return "Pre-open";
  if (state === "open") return "Open";
  if (state === "closed") return "Closed";
  return label;
};

const LiveStatus: React.FC = () => {
  const session = useQuery(marketApi.marketStatus, {});

  if (!session) {
    return (
      <span className="ml-status" title="Reading session status">
        <span className="ml-status-dot" aria-hidden="true" />
        <span className="ml-status-text">Session…</span>
      </span>
    );
  }

  return (
    <span
      className="ml-status ml-status--session"
      data-state={stateOf(session.label)}
      title={`${session.label} · ${session.istDate} ${session.istTime} IST`}
    >
      <span className="ml-status-dot" aria-hidden="true" />
      <span className="ml-status-text">{session.label}</span>
      <span className="ml-status-short">{shortOf(session.label)}</span>
      <span className="ml-status-time ml-mono">{session.istTime} IST</span>
    </span>
  );
};

const SampleStatus: React.FC = () => (
  <span className="ml-status" data-tone="sample" title="Backend unreachable — deterministic sample data">
    <span className="ml-status-dot" aria-hidden="true" />
    <span className="ml-status-text">SAMPLE</span>
  </span>
);

/**
 * Rendered only when a Convex client exists, so the offline provider (which
 * calls no Convex hooks) never reaches `useQuery`.
 */
const MarketStatusPill: React.FC = () => {
  const { backendOnline } = useRootContext();
  return backendOnline ? <LiveStatus /> : <SampleStatus />;
};

export default MarketStatusPill;
