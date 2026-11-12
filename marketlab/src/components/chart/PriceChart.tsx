import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { Maximize2, Minimize2 } from "lucide-react";
import { bollinger, ema, macd, rsi, sma, vwap } from "@quant/indicators";
import type {
  Candle,
  ChartType,
  DataMode,
  IndicatorConfig,
  Interval,
} from "@/lib/marketClient";
import { formatPrice, formatVolume } from "@/lib/format";
import DataModeBadge from "@/components/market/DataModeBadge";

/** IST is UTC+05:30; shifting the axis lets the library print IST wall clock. */
const IST_SHIFT_SECONDS = 5.5 * 3600;

const toChartTime = (ts: number) => (ts / 1000 + IST_SHIFT_SECONDS) as UTCTimestamp;

/** Canvas colours mirror the CSS tokens; lightweight-charts needs literals. */
const COLOR = {
  up: "#22c55e",
  down: "#f87171",
  line: "#2dd4bf",
  text: "#94a3b8",
  grid: "rgba(38, 52, 73, 0.55)",
  border: "#263449",
  volumeUp: "rgba(34, 197, 94, 0.32)",
  volumeDown: "rgba(248, 113, 113, 0.32)",
  volumeNeutral: "rgba(125, 155, 190, 0.32)",
};

export interface PriceChartProps {
  title: string;
  subtitle?: string;
  candles: Candle[];
  interval: Interval;
  chartType: ChartType;
  indicators: IndicatorConfig[];
  mode: DataMode;
  source: string;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  toolbar?: React.ReactNode;
  height?: number;
}

interface HoverState {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/**
 * Candlestick / line / OHLC-bar chart with volume, crosshair values, zoom, pan
 * and full screen. Indicator math is shared with the backend (`@quant/indicators`)
 * so the plotted values are the tested ones.
 *
 * The chart instance is created once per mount/height/interval and every series
 * is removed in the same effect that added it, so switching instruments never
 * leaks a second canvas.
 */
export const PriceChart: React.FC<PriceChartProps> = ({
  title,
  subtitle,
  candles,
  interval,
  chartType,
  indicators,
  mode,
  source,
  loading = false,
  error = null,
  emptyMessage = "No candles available for this range.",
  toolbar,
  height = 420,
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const enabled = useMemo(
    () => new Set(indicators.filter((indicator) => indicator.enabled).map((i) => i.name)),
    [indicators]
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: COLOR.text,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: COLOR.grid },
        horzLines: { color: COLOR.grid },
      },
      rightPriceScale: { borderColor: COLOR.border },
      timeScale: {
        borderColor: COLOR.border,
        timeVisible: interval !== "1d" && interval !== "1w" && interval !== "1M",
        secondsVisible: false,
      },
      crosshair: { mode: 1 },
      localization: {
        priceFormatter: (price: number) => price.toFixed(2),
      },
    });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [height, interval]);

  // Series are rebuilt whenever the data, type or indicator selection changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const priceSeriesMap: ISeriesApi<any>[] = [];
    const paneSeries: ISeriesApi<any>[] = [];

    const priceSeries =
      chartType === "candlestick"
        ? chart.addSeries(CandlestickSeries, {
            upColor: COLOR.up,
            downColor: COLOR.down,
            borderUpColor: COLOR.up,
            borderDownColor: COLOR.down,
            wickUpColor: COLOR.up,
            wickDownColor: COLOR.down,
          })
        : chartType === "bar"
          ? chart.addSeries(BarSeries, { upColor: COLOR.up, downColor: COLOR.down })
          : chart.addSeries(LineSeries, { color: COLOR.line, lineWidth: 2 });

    priceSeries.setData(
      candles.map((candle) => ({
        time: toChartTime(candle.ts),
        ...(chartType === "line"
          ? { value: candle.close }
          : {
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
            }),
      })) as any
    );
    priceSeriesMap.push(priceSeries);

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: COLOR.volumeNeutral,
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      candles
        .filter((candle) => candle.volume !== null)
        .map((candle) => ({
          time: toChartTime(candle.ts),
          value: candle.volume as number,
          color:
            candle.close > candle.open
              ? COLOR.volumeUp
              : candle.close < candle.open
                ? COLOR.volumeDown
                : COLOR.volumeNeutral,
        }))
    );

    const closes = candles.map((candle) => candle.close);
    const times = candles.map((candle) => candle.ts);

    const addLine = (
      values: (number | null)[],
      options: { color: string; width?: number; dashed?: boolean; pane?: number }
    ) => {
      const series = chart.addSeries(
        LineSeries,
        {
          color: options.color,
          lineWidth: (options.width ?? 1) as 1 | 2 | 3 | 4,
          lineStyle: options.dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
        },
        options.pane ?? 0
      );
      series.setData(
        values
          .map((value, index) =>
            value === null ? null : { time: toChartTime(times[index]), value }
          )
          .filter((point): point is { time: UTCTimestamp; value: number } => point !== null)
      );
      if ((options.pane ?? 0) > 0) paneSeries.push(series);
      else priceSeriesMap.push(series);
      return series;
    };

    for (const indicator of indicators) {
      if (!indicator.enabled) continue;
      const period = indicator.period ?? 14;
      switch (indicator.name) {
        case "SMA":
          addLine(sma(closes, period || 20), { color: "#fbbf24" });
          break;
        case "EMA":
          addLine(ema(closes, period || 20), { color: "#60a5fa" });
          break;
        case "BOLLINGER": {
          const bands = bollinger(closes, period || 20, indicator.multiplier ?? 2);
          addLine(bands.upper, { color: "#c084fc", dashed: true });
          addLine(bands.middle, { color: "#c084fc" });
          addLine(bands.lower, { color: "#c084fc", dashed: true });
          break;
        }
        case "VWAP":
          addLine(vwap(candles), { color: "#fb923c" });
          break;
        case "RSI": {
          addLine(rsi(closes, period || 14), { color: "#fbbf24", pane: 1 });
          addLine(closes.map(() => 70), { color: "#334155", dashed: true, pane: 1 });
          addLine(closes.map(() => 30), { color: "#334155", dashed: true, pane: 1 });
          break;
        }
        case "MACD": {
          const result = macd(closes, indicator.fast ?? 12, indicator.slow ?? 26, indicator.signal ?? 9);
          addLine(result.macd, { color: "#60a5fa", pane: 2 });
          addLine(result.signal, { color: "#fbbf24", pane: 2 });
          addLine(result.histogram, { color: "#475569", pane: 2 });
          break;
        }
        default:
          break;
      }
    }

    const byTimestamp = new Map(candles.map((candle) => [Math.round(toChartTime(candle.ts)), candle]));
    const handleCrosshair = (param: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) => {
      if (!param.time) {
        setHover(null);
        return;
      }
      const candle = byTimestamp.get(param.time as number);
      if (!candle) {
        setHover(null);
        return;
      }
      setHover({
        ts: candle.ts,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    chart.timeScale().fitContent();

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      for (const series of [...priceSeriesMap, ...paneSeries, volumeSeries]) {
        try {
          chart.removeSeries(series);
        } catch {
          /* series may already be gone with its pane */
        }
      }
    };
  }, [candles, chartType, indicators]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    const element = wrapperRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen?.();
  };

  const latest = candles[candles.length - 1];
  const shown = hover ?? (latest
    ? {
        ts: latest.ts,
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latest.volume,
      }
    : null);

  return (
    <section className="ml-chart-wrap" ref={wrapperRef} aria-label={`${title} price chart`}>
      <header className="ml-chart__head">
        <div className="ml-chart__titles">
          <h2 className="ml-chart__title">
            {title}
            <DataModeBadge mode={mode} />
          </h2>
          {subtitle && <p className="ml-chart__subtitle">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="ml-data-table__action text-[var(--text-3)]"
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            <span>{isFullscreen ? "Exit" : "Full screen"}</span>
          </button>
        </div>
      </header>

      {shown && (
        <div className="ml-chart__legend">
          <span>
            O <b>{formatPrice(shown.open)}</b>
          </span>
          <span>
            H <b>{formatPrice(shown.high)}</b>
          </span>
          <span>
            L <b>{formatPrice(shown.low)}</b>
          </span>
          <span>
            C <b>{formatPrice(shown.close)}</b>
          </span>
          <span>
            Vol <b>{formatVolume(shown.volume)}</b>
          </span>
          {enabled.size > 0 && <span>Overlays: {[...enabled].join(", ")}</span>}
        </div>
      )}

      <div className="relative">
        <div className="ml-chart-plot" ref={containerRef} style={{ height }} />

        {loading && (
          <div className="ml-chart__state" role="status">
            Loading candles…
          </div>
        )}
        {!loading && error && (
          <div className="ml-chart__state ml-chart__state--error" role="alert">
            {error}
          </div>
        )}
        {!loading && !error && candles.length === 0 && (
          <div className="ml-chart__state">{emptyMessage}</div>
        )}
      </div>

      <footer className="ml-chart__foot">
        <span>Source: {source === "sample" ? "sample catalogue" : source} · times in IST</span>
        <span>
          {candles.length} candles · {chartType === "line" ? "line" : chartType === "bar" ? "OHLC bars" : "candlesticks"}
        </span>
      </footer>
    </section>
  );
};

export default PriceChart;
