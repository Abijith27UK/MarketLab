import React from "react";
import InstrumentLabel from "./InstrumentLabel";
import FinancialValue from "./FinancialValue";
import PriceChange from "./PriceChange";
import DataFreshnessBadge from "./DataFreshnessBadge";
import Sparkline from "./Sparkline";
import { formatAge, formatInr, formatPercent, isFiniteNumber, signGlyph, toneOf } from "@/lib/format";
import type { StockCardModel } from "@/lib/stockModels";

export interface StockQuoteCardProps {
  model: StockCardModel;
  onOpen: (instrumentId: string) => void;
  /** Reference "now" for freshness text; pass one value per render pass. */
  now: number;
  compact?: boolean;
}

/**
 * A stock quote card in three real regions: identity, figures, provenance.
 *
 * The whole card is one button, so it is keyboard operable and announces a
 * single action. Every number is formatted by the shared helpers — the card
 * itself contains no currency or percentage logic.
 */
export const StockQuoteCard: React.FC<StockQuoteCardProps> = ({
  model,
  onOpen,
  now,
  compact = false,
}) => {
  const hasPrice = isFiniteNumber(model.lastPrice);
  const movement = isFiniteNumber(model.change) ? model.change : model.changePercent;
  const tone = toneOf(movement);
  const direction = tone === "none" ? "flat" : tone;
  const hasSparkline = model.sparkline.length >= 2;

  const ageLabel = !hasPrice
    ? "no quote available"
    : model.quoteTime === null
      ? "no quote timestamp"
      : undefined;

  const ariaLabel = [
    `${model.name} (${model.symbol}, ${model.exchange})`,
    hasPrice ? formatInr(model.lastPrice) : "price unavailable",
    isFiniteNumber(model.changePercent)
      ? `${signGlyph(model.changePercent)}${formatPercent(model.changePercent)}`.trim()
      : "change unavailable",
    `${model.mode} data`,
    `from ${model.source}`,
    ageLabel ?? (model.quoteTime !== null ? `quoted ${formatAge(model.quoteTime, now)}` : "no quote timestamp"),
    "open details",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      className={`ml-stock-card${compact ? " is-compact" : ""}`}
      onClick={() => onOpen(model.instrumentId)}
      aria-label={ariaLabel}
      data-testid="stock-card"
      data-instrument-id={model.instrumentId}
      data-mode={model.mode}
      data-direction={direction}
    >
      <span className="ml-stock-card__head">
        <InstrumentLabel
          symbol={model.symbol}
          name={model.name}
          exchange={model.exchange}
          instrumentType={model.instrumentType}
        />
      </span>

      <span className="ml-stock-card__quote">
        <FinancialValue value={model.lastPrice} size={compact ? "lg" : "xl"} />
        <PriceChange change={model.change} changePercent={model.changePercent} />
      </span>

      {hasSparkline ? (
        <span className="ml-stock-card__spark">
          <Sparkline
            values={model.sparkline}
            direction={direction}
            label={`${model.symbol} recent closes, ${model.mode} series`}
            width={compact ? 108 : 148}
            height={compact ? 30 : 38}
          />
        </span>
      ) : null}

      <span className="ml-stock-card__foot">
        <DataFreshnessBadge
          mode={model.mode}
          source={model.source}
          asOf={model.quoteTime}
          now={now}
          label={ageLabel}
        />
        <span className="ml-stock-card__cta" aria-hidden="true">
          View details →
        </span>
      </span>
    </button>
  );
};

export default StockQuoteCard;
