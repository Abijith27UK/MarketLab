import React from "react";

export interface InstrumentLabelProps {
  symbol: string;
  name?: string | null;
  exchange?: string | null;
  instrumentType?: string | null;
  /** Show the instrument type next to the exchange (indices, ETFs). */
  showType?: boolean;
  className?: string;
}

/**
 * Symbol, name and exchange/type as three distinct aligned elements.
 *
 * Nothing is concatenated into one string: the symbol truncates on its own, the
 * exchange chip never shrinks, and the name gets its own line with an ellipsis
 * plus a `title` so the full company name stays reachable.
 */
export const InstrumentLabel: React.FC<InstrumentLabelProps> = ({
  symbol,
  name,
  exchange,
  instrumentType,
  showType = false,
  className = "",
}) => (
  <span className={["ml-instrument", className].filter(Boolean).join(" ")}>
    <span className="ml-instrument__line">
      <span className="ml-instrument__symbol" title={symbol}>
        {symbol}
      </span>
      {exchange ? <span className="ml-instrument__exchange">{exchange}</span> : null}
      {showType && instrumentType ? (
        <span className="ml-instrument__type">{instrumentType}</span>
      ) : null}
    </span>
    {name ? (
      <span className="ml-instrument__name" title={name}>
        {name}
      </span>
    ) : null}
  </span>
);

export default InstrumentLabel;
