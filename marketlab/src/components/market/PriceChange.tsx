import React from "react";
import { formatPercent, formatSigned, isFiniteNumber, signGlyph, toneOf } from "@/lib/format";

export interface PriceChangeProps {
  /** Absolute change in ₹ (or index points). */
  change: number | null | undefined;
  changePercent: number | null | undefined;
  /** Append the plain-language direction word used for non-colour meaning. */
  showWord?: boolean;
  /** Show the absolute value alongside the percentage (default true). */
  showAbsolute?: boolean;
  className?: string;
}

/**
 * Movement block: arrow, absolute change and percentage change as separate
 * spans, coloured from the single `toneOf` decision.
 *
 * The percentage can never be glued to the absolute figure (the old card
 * rendered `+31.20+1.11%`), and the direction is also stated in words so the
 * information does not depend on colour.
 */
export const PriceChange: React.FC<PriceChangeProps> = ({
  change,
  changePercent,
  showWord = true,
  showAbsolute = true,
  className = "",
}) => {
  const hasChange = isFiniteNumber(change);
  const hasPercent = isFiniteNumber(changePercent);

  if (!hasChange && !hasPercent) {
    return (
      <span className={["ml-price-change", "ml-price-change--unavailable", className].filter(Boolean).join(" ")}>
        change unavailable
      </span>
    );
  }

  const movement = hasChange ? change : changePercent;
  const tone = toneOf(movement);
  const word = tone === "up" ? "up" : tone === "down" ? "down" : "unchanged";
  const glyph = signGlyph(movement);

  return (
    <span className={["ml-price-change", `ml-tone--${tone}`, className].filter(Boolean).join(" ")}>
      {glyph ? (
        <span className="ml-price-change__arrow" aria-hidden="true">
          {glyph}
        </span>
      ) : null}
      {showAbsolute && hasChange ? (
        <span className="ml-price-change__abs">{formatSigned(change)}</span>
      ) : null}
      {hasPercent ? (
        <span className="ml-price-change__pct">{formatPercent(changePercent)}</span>
      ) : null}
      {showWord ? <span className="ml-price-change__word">{word}</span> : null}
    </span>
  );
};

export default PriceChange;
