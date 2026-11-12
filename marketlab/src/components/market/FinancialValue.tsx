import React from "react";
import { formatInr, formatPrice, isFiniteNumber } from "@/lib/format";

export type FinancialValueSize = "sm" | "md" | "lg" | "xl";

export interface FinancialValueProps {
  value: number | null | undefined;
  /** Prefix with ₹ (default true). Set false for ratios and counts. */
  withCurrency?: boolean;
  size?: FinancialValueSize;
  className?: string;
}

/**
 * A single financial figure.
 *
 * Every path goes through `formatInr` / `formatPrice`, so `undefined`, `NaN`,
 * `Infinity` and `null` all render as a neutral em dash — a malformed value can
 * never reach the DOM as a price.
 */
export const FinancialValue: React.FC<FinancialValueProps> = ({
  value,
  withCurrency = true,
  size = "md",
  className = "",
}) => {
  const available = isFiniteNumber(value);
  return (
    <span
      className={[
        "ml-fin-value",
        `ml-fin-value--${size}`,
        available ? "" : "ml-fin-value--unavailable",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-unavailable={available ? undefined : "true"}
    >
      {withCurrency ? formatInr(value) : formatPrice(value)}
    </span>
  );
};

export default FinancialValue;
