import React, { useMemo } from "react";

interface SparklineProps {
  values: number[];
  /** Direction of the move the sparkline accompanies (drives colour only). */
  direction: "up" | "down" | "flat";
  width?: number;
  height?: number;
  /** Accessible description, e.g. "Reliance Industries, last 24 closes". */
  label: string;
}

const COLORS: Record<SparklineProps["direction"], string> = {
  up: "#00d4aa",
  down: "#ff4757",
  flat: "#8b8b9e",
};

/**
 * Mini price line. Purely decorative context for the numeric values shown next
 * to it, so it is hidden from assistive tech when the numbers already convey
 * the change; the trend is also stated in words on the card.
 */
export const Sparkline: React.FC<SparklineProps> = ({
  values,
  direction,
  width = 132,
  height = 38,
  label,
}) => {
  const geometry = useMemo(() => {
    const clean = values.filter((value) => Number.isFinite(value));
    if (clean.length < 2) return null;

    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;
    const pad = 2;
    const usableWidth = width - pad * 2;
    const usableHeight = height - pad * 2;

    const points = clean.map((value, index) => {
      const x = pad + (index / (clean.length - 1)) * usableWidth;
      const y = pad + (1 - (value - min) / span) * usableHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    return { line: points.join(" "), area: `${points.join(" ")} ${width - pad},${height - pad} ${pad},${height - pad}` };
  }, [height, values, width]);

  if (!geometry) return null;

  const color = COLORS[direction];

  return (
    <svg
      className="ml-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      focusable="false"
    >
      <polygon points={geometry.area} fill={color} opacity={0.08} />
      <polyline
        points={geometry.line}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default Sparkline;
