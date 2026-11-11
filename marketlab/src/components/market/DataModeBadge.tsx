import React from "react";
import type { DataMode } from "@/lib/marketClient";
import { modeDescription } from "@/lib/format";

interface DataModeBadgeProps {
  mode: DataMode;
  source?: string | null;
  className?: string;
}

/**
 * Freshness label shown next to every market value.
 * The label comes from the server, not from "the request succeeded".
 */
export const DataModeBadge: React.FC<DataModeBadgeProps> = ({ mode, source, className = "" }) => (
  <span
    className={`ml-data-mode ${className}`}
    data-mode={mode}
    title={`${modeDescription(mode)}${source ? ` · source: ${source}` : ""}`}
  >
    {mode}
    {source ? <span className="ml-1 opacity-70 normal-case">· {source}</span> : null}
  </span>
);

export default DataModeBadge;
