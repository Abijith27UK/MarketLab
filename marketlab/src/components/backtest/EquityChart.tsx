import React from "react";
import type { RunEquityPoint } from "@/lib/backtestTypes";
import { formatInr, formatTimestamp } from "@/lib/format";

interface EquityChartProps {
  points: RunEquityPoint[];
  initialCapital: number;
  height?: number;
}

const WIDTH = 720;

/**
 * Equity curve and drawdown, drawn as plain SVG.
 *
 * Deterministic and dependency-free: no canvas, no chart library state, so the
 * same stored run always renders the same picture. Handles a single point and a
 * perfectly flat curve without dividing by zero.
 */
export const EquityChart: React.FC<EquityChartProps> = ({
  points,
  initialCapital,
  height = 180,
}) => {
  if (points.length === 0) {
    return <p className="ml-empty">No equity points were recorded for this run.</p>;
  }

  const min = Math.min(...points.map((point) => point.equity));
  const max = Math.max(...points.map((point) => point.equity));
  const span = max - min || 1;
  const chartHeight = height;
  const padTop = 10;
  const usable = chartHeight - padTop * 2;
  const xAt = (index: number) =>
    points.length === 1 ? WIDTH / 2 : (index / (points.length - 1)) * WIDTH;
  const yAt = (equity: number) => padTop + usable - ((equity - min) / span) * usable;

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(point.equity).toFixed(2)}`)
    .join(" ");

  const areaPath =
    points.length === 1
      ? ""
      : `${linePath} L${WIDTH},${chartHeight - padTop} L0,${chartHeight - padTop} Z`;

  const maxDrawdown = Math.min(0, ...points.map((point) => point.drawdownPct));
  const drawdownHeight = 70;
  const drawdownScale = Math.abs(maxDrawdown) || 1;

  const first = points[0];
  const last = points[points.length - 1];

  return (
    <figure className="ml-backtest-chart" data-testid="equity-chart">
      <figcaption className="ml-backtest-chart-head">
        <span>Equity curve</span>
        <span className="ml-mono text-xs text-gray-400">
          {formatInr(min)} – {formatInr(max)}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${chartHeight}`}
        className="ml-backtest-svg"
        role="img"
        aria-label={`Equity curve from ${formatInr(first.equity)} to ${formatInr(last.equity)}`}
        preserveAspectRatio="none"
      >
        <line
          x1={0}
          x2={WIDTH}
          y1={yAt(initialCapital)}
          y2={yAt(initialCapital)}
          stroke="var(--color-border)"
          strokeDasharray="4 4"
          strokeWidth={1}
        />
        {areaPath && <path d={areaPath} fill="rgba(0, 212, 170, 0.12)" stroke="none" />}
        <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
      </svg>

      <div className="ml-backtest-chart-axis">
        <span>{formatTimestamp(first.ts)}</span>
        <span>{formatTimestamp(last.ts)}</span>
      </div>

      <figcaption className="ml-backtest-chart-head mt-3">
        <span>Drawdown</span>
        <span className="ml-mono text-xs text-gray-400">{maxDrawdown.toFixed(2)}% max</span>
      </figcaption>

      <svg
        viewBox={`0 0 ${WIDTH} ${drawdownHeight}`}
        className="ml-backtest-svg is-drawdown"
        role="img"
        aria-label={`Drawdown curve, deepest ${maxDrawdown.toFixed(2)} percent`}
        preserveAspectRatio="none"
      >
        <path
          d={
            points
              .map((point, index) => {
                const y = (Math.abs(point.drawdownPct) / drawdownScale) * (drawdownHeight - 6);
                return `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${y.toFixed(2)}`;
              })
              .join(" ") +
            ` L${WIDTH},0 L0,0 Z`
          }
          fill="rgba(255, 71, 87, 0.18)"
          stroke="var(--color-red)"
          strokeWidth={1.5}
        />
      </svg>
    </figure>
  );
};

export default EquityChart;
