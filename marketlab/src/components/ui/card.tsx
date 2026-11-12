import React from "react";

type CardPadding = "none" | "sm" | "md" | "lg";
type CardTone = "default" | "elevated" | "inset";

export interface CardProps {
  /** Inner padding on the 4px scale. Defaults to `md` (20px). */
  padding?: CardPadding;
  /** Surface treatment, for nesting a card inside another surface. */
  tone?: CardTone;
  className?: string;
  children: React.ReactNode;
}

const PADDING_CLASS: Record<Exclude<CardPadding, "none">, string> = {
  sm: "ml-card--pad-sm",
  md: "ml-card--pad-md",
  lg: "ml-card--pad-lg",
};

/** The single surface primitive: border, radius, elevation and padding. */
export const Card: React.FC<CardProps> = ({
  padding = "md",
  tone = "default",
  className = "",
  children,
}) => (
  <div
    className={[
      "ml-card",
      padding === "none" ? "" : PADDING_CLASS[padding],
      tone === "default" ? "" : `ml-card--${tone}`,
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  >
    {children}
  </div>
);

export default Card;
