import React from "react";
import type { DataMode } from "@/lib/marketClient";
import { formatAge } from "@/lib/format";

/** 
 * Freshness label shown next to every market value. 
 * Shows mode and how long ago the data was (for DELAYED mode).
 * Source is accepted for compatibility but not displayed.
 */
export const DataModeBadge = React.forwardRef<HTMLElement, {mode: DataMode; asOf?: number | null; source?: string | null; className?: string}>(({mode, asOf, source, className = ""}, ref) => {
  // formatAge already reads "5s ago", so it is used verbatim (never "5s ago ago").
  const delayText = mode === "DELAYED" && asOf != null ? formatAge(asOf, Date.now()) : null;
  
  // Source is accepted for compatibility but intentionally not displayed
  // The badge shows only mode + delay time
  
  return (
    <span 
      className={`ml-data-mode ${className}`}
      ref={ref}
      data-mode={mode}
    >
      {mode}
      {delayText ? <span className="ml-data-mode__age">· {delayText}</span> : null}
    </span>
  );
});

DataModeBadge.displayName = "DataModeBadge";

/** Default export for compatibility */
export default DataModeBadge;