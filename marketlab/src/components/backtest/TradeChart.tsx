import React from "react";
import type { RunPricePoint, RunTrade } from "@/lib/backtestTypes";
import { formatPrice, formatTimestamp } from "@/lib/format";

interface TradeChartProps {
  prices: RunPricePoint[];
  trades: RunTrade[];
  symbol: string;
}

const WIDTH = 720;
const HEIGHT = 220;

/**
 * Close-price path for the tested range with entry/exit markers.
 *
 * Markers are placed at the trade's own execution timestamps, so a marker can
 * only appear where the engine actually executed. Trades whose timestamps were
 * downsampled out of the stored curve snap to the nearest stored point.
 */
export const TradeChart: React.FC<TradeChartProps> = ({ prices, trades, symbol }) => {
  if (prices.length === 0) {
    return <p className="ml-empty">No price series was stored for this run.</p>;
  }

  const min = Math.min(...prices.map((point) => point.close));
  const max = Math.max(...prices.map((point) => point.close));
  const span = max - min || 1;
  const pad = 12;
  const usable = HEIGHT - pad * 2;
  const xAt = (index: number) =>
    prices.length === 1 ? WIDTH / 2 : (index / (prices.length - 1)) * WIDTH;
  const yAt = (price: number) => pad + usable - ((price - min) / span) * usable;

  const firstTs = prices[0].ts;
  const lastTs = prices[prices.length - 1].ts;
  const xForTs = (ts: number) => {
    if (lastTs === firstTs) return WIDTH / 2;
    return ((ts - firstTs) / (lastTs - firstTs)) * WIDTH;
  };

  const path = prices
    .map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(point.close).toFixed(2)}`)
    .join(" ");

  return (
    <figure className="ml-backtest-chart" data-testid="trade-chart">
      <figcaption className="ml-backtest-chart-head">
        <span>{symbol} · execution markers</span>
        <span className="ml-backtest-legend">
          <span className="ml-backtest-legend-item">
            <span className="ml-backtest-dot is-entry" aria-hidden="true" /> Entry
          </span>
          <span className="ml-backtest-legend-item">
            <span className="ml-backtest-dot is-exit-profit" aria-hidden="true" /> Exit (profit)
          </span>
          <span className="ml-backtest-legend-item">
            <span className="ml-backtest-dot is-exit-loss" aria-hidden="true" /> Exit (loss)
          </span>
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="ml-backtest-svg"
        role="img"
        aria-label={`${symbol} close price with ${trades.length} trade markers`}
        preserveAspectRatio="none"
      >
        <path d={path} fill="none" stroke="var(--color-text-secondary)" strokeWidth={1.4} />
        {trades.map((trade, index) => (
          <g key={`${trade.entryTs}-${index}`}>
            <circle
              cx={xForTs(trade.entryTs)}
              cy={HEIGHT - pad - 2}
              r={4}
              fill="var(--color-accent)"
            >
              <title>{`Entry ${formatTimestamp(trade.entryTs)} @ ${formatPrice(trade.entryPrice)}`}</title>
            </circle>
            <circle
              cx={xForTs(trade.exitTs)}
              cy={pad + 2}
              r={4}
              fill={trade.netPnl >= 0 ? "#34d399" : "var(--color-red)"}
            >
              <title>{`Exit ${formatTimestamp(trade.exitTs)} @ ${formatPrice(trade.exitPrice)} (${trade.exitReason})`}</title>
            </circle>
            <line
              x1={xForTs(trade.entryTs)}
              x2={xForTs(trade.exitTs)}
              y1={HEIGHT / 2}
              y2={HEIGHT / 2}
              stroke="rgba(0, 212, 170, 0.25)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
          </g>
        ))}
      </svg>

      <div className="ml-backtest-chart-axis">
        <span>{formatTimestamp(firstTs)}</span>
        <span>{formatTimestamp(lastTs)}</span>
      </div>
    </figure>
  );
};

export default TradeChart;
