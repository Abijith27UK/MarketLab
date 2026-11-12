import React from "react";
import DataModeBadge from "./DataModeBadge";
import { formatAge } from "@/lib/format";
import type { DataMode } from "@/lib/marketClient";

export interface DataFreshnessBadgeProps {
  mode: DataMode;
  source?: string | null;
  asOf?: number | null;
  now?: number;
  /** Explicit age text (e.g. "no quote available"); overrides the computed age. */
  label?: React.ReactNode;
  className?: string;
}

/**
 * Data mode plus quote age in one inline group.
 *
 * The mode never gets upgraded here: it is passed straight through to
 * DataModeBadge, so SAMPLE stays dashed and DELAYED stays amber regardless of
 * what the surrounding card looks like.
 */
export const DataFreshnessBadge: React.FC<DataFreshnessBadgeProps> = ({
  mode,
  source,
  asOf,
  now = Date.now(),
  label,
  className = "",
}) => (
  <span className={["ml-freshness", className].filter(Boolean).join(" ")}>
    <DataModeBadge mode={mode} source={source} />
    <span className="ml-freshness__age">{label ?? formatAge(asOf ?? null, now)}</span>
  </span>
);

export default DataFreshnessBadge;
