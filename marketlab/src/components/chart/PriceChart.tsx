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
        textColor: "#a0a0b0",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(42, 42, 58, 0.5)" },
        horzLines: { color: "rgba(42, 42, 58, 0.5)" },
      },
      rightPriceScale: { borderColor: "#2a2a3a" },
      timeScale: {
        borderColor: "#2a2a3a",
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
            upColor: "#00d4aa",
            downColor: "#ff4757",
            borderUpColor: "#00d4aa",
            borderDownColor: "#ff4757",
            wickUpColor: "#00d4aa",
            wickDownColor: "#ff4757",
          })
        : chartType === "bar"
          ? chart.addSeries(BarSeries, { upColor: "#00d4aa", downColor: "#ff4757" })
          : chart.addSeries(LineSeries, { color: "#00d4aa", lineWidth: 2 });

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
      color: "rgba(122, 162, 247, 0.4)",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volumeSeries.setData(
      candles
        .filter((candle) => candle.volume !== null)
        .map((candle) => ({
          time: toChartTime(candle.ts),
          value: candle.volume as number,
          color: candle.close >= candle.open ? "rgba(0, 212, 170, 0.35)" : "rgba(255, 71, 87, 0.35)",
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
          addLine(sma(closes, period || 20), { color: "#f0b429" });
          break;
        case "EMA":
          addLine(ema(closes, period || 20), { color: "#7aa2f7" });
          break;
        case "BOLLINGER": {
          const bands = bollinger(closes, period || 20, indicator.multiplier ?? 2);
          addLine(bands.upper, { color: "#b48ead", dashed: true });
          addLine(bands.middle, { color: "#b48ead" });
          addLine(bands.lower, { color: "#b48ead", dashed: true });
          break;
        }
        case "VWAP":
          addLine(vwap(candles), { color: "#ffb86c" });
          break;
        case "RSI": {
          addLine(rsi(closes, period || 14), { color: "#f0b429", pane: 1 });
          addLine(closes.map(() => 70), { color: "#4a4a5e", dashed: true, pane: 1 });
          addLine(closes.map(() => 30), { color: "#4a4a5e", dashed: true, pane: 1 });
          break;
        }
        case "MACD": {
          const result = macd(closes, indicator.fast ?? 12, indicator.slow ?? 26, indicator.signal ?? 9);
          addLine(result.macd, { color: "#7aa2f7", pane: 2 });
          addLine(result.signal, { color: "#f0b429", pane: 2 });
          addLine(result.histogram, { color: "#5b6b8c", pane: 2 });
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
    <section className="ml-chart-wrap" ref={wrapperRef}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            <DataModeBadge mode={mode} />
          </div>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-800"
            aria-label={isFullscreen ? "Exit full screen" : "Enter full screen"}
          >
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </header>

      {shown && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 text-xs text-gray-400">
          <span>O <b className="text-gray-200">{formatPrice(shown.open)}</b></span>
          <span>H <b className="text-gray-200">{formatPrice(shown.high)}</b></span>
          <span>L <b className="text-gray-200">{formatPrice(shown.low)}</b></span>
          <span>C <b className="text-gray-200">{formatPrice(shown.close)}</b></span>
          <span>Vol <b className="text-gray-200">{formatVolume(shown.volume)}</b></span>
          {enabled.size > 0 && (
            <span className="text-gray-600">
              Overlays: {[...enabled].join(", ")}
            </span>
          )}
        </div>
      )}

      <div className="relative">
        <div className="ml-chart-plot" ref={containerRef} style={{ height }} />

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-gray-300">
            Loading candles…
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 p-6 text-center text-sm text-red-400">
            {error}
          </div>
        )}
        {!loading && !error && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-gray-400">
            {emptyMessage}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 px-4 py-2 text-xs text-gray-500">
        <span>Source: {source === "sample" ? "sample catalogue" : source} · times in IST</span>
        <span>{candles.length} candles</span>
      </footer>
    </section>
  );
};

export default PriceChart;
