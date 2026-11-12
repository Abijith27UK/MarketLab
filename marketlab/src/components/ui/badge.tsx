import React from "react";

export type BadgeTone = "neutral" | "outline" | "accent" | "pos" | "neg" | "warn";

export interface BadgeProps {
  tone?: BadgeTone;
  /** Tabular, monospaced figures — for counts, modes and codes. */
  mono?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

/** Small status/label pill. Semantic tones only; no decorative colours. */
export const Badge: React.FC<BadgeProps> = ({
  tone = "neutral",
  mono = false,
  className = "",
  title,
  children,
}) => (
  <span
    className={["ml-tag", `ml-tag--${tone}`, mono ? "ml-tag--mono" : "", className]
      .filter(Boolean)
      .join(" ")}
    title={title}
  >
    {children}
  </span>
);

export default Badge;
