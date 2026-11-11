import React from "react";
import DataModeBadge from "@/components/market/DataModeBadge";
import Sparkline from "@/components/market/Sparkline";
import {
  formatAge,
  formatPercent,
  formatPrice,
  signGlyph,
  toneClass,
} from "@/lib/format";
import type { StockCardModel } from "@/lib/stockModels";

interface StockCardProps {
  model: StockCardModel;
  onOpen: (instrumentId: string) => void;
  /** Reference "now" for freshness text; pass one value per render pass. */
  now: number;
  /** Compact variant is used for indices. */
  compact?: boolean;
}

const directionOf = (change: number | null): "up" | "down" | "flat" => {
  if (change === null || !Number.isFinite(change) || change === 0) return "flat";
  return change > 0 ? "up" : "down";
};

const trendWord = (model: StockCardModel): string => {
  const direction = directionOf(model.change);
  if (direction === "flat") return "unchanged";
  return direction === "up" ? "up" : "down";
};

/**
 * A single stock card: name, symbol, exchange, price, change, optional
 * sparkline and the server-provided freshness label. The whole card is one
 * button so it is keyboard operable and announces one action.
 */
export const StockCard: React.FC<StockCardProps> = ({ model, onOpen, now, compact = false }) => {
  const direction = directionOf(model.change);
  const hasPrice = model.lastPrice !== null && Number.isFinite(model.lastPrice);
  const hasSparkline = model.sparkline.length >= 2;

  const priceText = hasPrice ? `₹${formatPrice(model.lastPrice)}` : "price unavailable";
  const changeText =
    model.change === null && model.changePercent === null
      ? "change unavailable"
      : `${signGlyph(model.changePercent)}${formatPercent(model.changePercent)}`;
  const freshness =
    model.quoteTime !== null ? `quoted ${formatAge(model.quoteTime, now)}` : "no quote timestamp";

  const ariaLabel = [
    `${model.name} (${model.symbol}, ${model.exchange})`,
    priceText,
    changeText,
    `${model.mode} data`,
    `from ${model.source}`,
    freshness,
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
      <span className="ml-stock-card-top">
        <span className="ml-stock-symbol">{model.symbol}</span>
        <span className="ml-stock-meta">
          <span className="ml-stock-exchange">{model.exchange}</span>
          <DataModeBadge mode={model.mode} source={model.source} />
        </span>
      </span>

      <span className="ml-stock-name" title={model.name}>
        {model.name}
      </span>

      <span className="ml-stock-figures">
        <span className="ml-stock-price ml-mono">{hasPrice ? priceText : "—"}</span>
        <span className={`ml-stock-change ml-mono ${toneClass(model.changePercent)}`}>
          <span aria-hidden="true">{signGlyph(model.changePercent)}</span>
          <span>{formatPercent(model.changePercent)}</span>
          <span className="ml-stock-change-word">{trendWord(model)}</span>
        </span>
      </span>

      {hasSparkline && (
        <span className="ml-stock-spark">
          <Sparkline
            values={model.sparkline}
            direction={direction}
            label={`${model.symbol} recent closing prices, sample series`}
            width={compact ? 108 : 150}
            height={compact ? 30 : 38}
          />
        </span>
      )}

      <span className="ml-stock-footer">
        <span className="ml-stock-freshness">
          {hasPrice ? freshness : "no quote available"}
        </span>
        <span className="ml-stock-cta" aria-hidden="true">
          Details →
        </span>
      </span>
    </button>
  );
};

export default StockCard;
