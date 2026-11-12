import React from "react";
import FinancialValue from "./FinancialValue";
import PriceChange from "./PriceChange";
import DataFreshnessBadge from "./DataFreshnessBadge";
import Sparkline from "./Sparkline";
import { formatPercent, formatPrice, isFiniteNumber, toneOf } from "@/lib/format";
import type { StockCardModel } from "@/lib/stockModels";

export interface IndexSummaryCardProps {
  model: StockCardModel;
  onOpen: (instrumentId: string) => void;
  now: number;
}

/**
 * Index summary: name first (that is what a reader scans for), then the level,
 * the movement and — only when a real series exists — a sparkline.
 */
export const IndexSummaryCard: React.FC<IndexSummaryCardProps> = ({ model, onOpen, now }) => {
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
    model.name,
    model.symbol,
    hasPrice ? formatPrice(model.lastPrice) : "value unavailable",
    isFiniteNumber(model.changePercent) ? formatPercent(model.changePercent) : "change unavailable",
    `${model.mode} data`,
    "open details",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      className="ml-index-card"
      onClick={() => onOpen(model.instrumentId)}
      aria-label={ariaLabel}
      data-testid="index-summary-card"
      data-instrument-id={model.instrumentId}
      data-mode={model.mode}
      data-direction={direction}
    >
      <span className="ml-index-card__head">
        <span className="ml-index-card__name" title={model.name}>
          {model.name}
        </span>
        <span className="ml-index-card__meta">
          <span className="ml-index-card__symbol">{model.symbol}</span>
          <span className="ml-index-card__exchange">{model.exchange}</span>
        </span>
      </span>

      <span className="ml-index-card__quote">
        {/* Index levels are points, never rupees. */}
        <FinancialValue value={model.lastPrice} size="lg" withCurrency={false} />
        <PriceChange change={model.change} changePercent={model.changePercent} />
      </span>

      {hasSparkline ? (
        <span className="ml-index-card__spark">
          <Sparkline
            values={model.sparkline}
            direction={direction}
            label={`${model.symbol} recent closes, ${model.mode} series`}
            width={132}
            height={34}
          />
        </span>
      ) : null}

      <span className="ml-index-card__foot">
        <DataFreshnessBadge
          mode={model.mode}
          source={model.source}
          asOf={model.quoteTime}
          now={now}
          label={ageLabel}
        />
        <span className="ml-stock-card__cta" aria-hidden="true">
          Details →
        </span>
      </span>
    </button>
  );
};

export default IndexSummaryCard;
