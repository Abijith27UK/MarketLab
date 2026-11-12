import React from "react";

export type StatTone = "neutral" | "pos" | "neg" | "warn";

export interface StatProps {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatTone;
  align?: "left" | "right";
  className?: string;
}

/**
 * Label / value / hint stack used by every summary strip.
 * Figures should be rendered with `ml-num` or `ml-mono` for tabular alignment.
 */
export const Stat: React.FC<StatProps> = ({
  label,
  value,
  hint,
  tone = "neutral",
  align = "left",
  className = "",
}) => (
  <div
    className={[
      "ml-stat",
      tone === "neutral" ? "" : `ml-stat--${tone}`,
      align === "right" ? "ml-stat--right" : "",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  >
    <span className="ml-stat__label">{label}</span>
    <span className="ml-stat__value">{value}</span>
    {hint ? <span className="ml-stat__hint">{hint}</span> : null}
  </div>
);

export default Stat;
