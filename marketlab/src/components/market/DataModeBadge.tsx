import React from "react";
import type { DataMode, Quote } from "@/lib/marketClient";
import { modeDescription, formatAge } from "@/lib/format";

interface DataModeBadgeProps {
  mode: DataMode;
  source?: string | null;
  asOf?: number | null;
  className?: string;
}

/**
 * Freshness label shown next to every market value.
 * The label comes from the server, not from "the request succeeded".
 * When mode is DELAYED and asOf is available, shows how long ago the data was.
 */
export const DataModeBadge: React.FC<DataModeBadgeProps> = ({ mode, source, asOf, className = "" }) => {
  const delayText = mode === "DELAYED" && asOf != null
    ? `· ${formatAge(asOf, Date.now())} ago`
    : null;
  const sourceText = source ? ` · ${source}` : "";
  return (
    <span
      className={`ml-data-mode ${className}`}
      data-mode={mode}
      title={`${modeDescription(mode)}${sourceText}${delayText ? ` · data: ${delayText.slice(1)}` : ""}`}
    >
      {mode}
      {delayText}
    </span>
  );
};

export default DataModeBadge;
