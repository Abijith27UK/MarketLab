/**
 * Provenance rules shared by the pipeline, the UI contract and the tests.
 *
 * The central fact this module encodes: some providers are *end-of-day only*.
 * Their "quote" is the close of the most recent completed session, so it may be
 * displayed and used for valuation, but it must never be presented or executed
 * as a current market price.
 */

import type { DataMode } from "./types";
import type { Interval } from "./types";

/**
 * Providers whose newest price is always a completed session's close.
 * TejHQ's open tier publishes a bhavcopy once per trading day, so every value it
 * returns is EOD by construction.
 */
export const END_OF_DAY_SOURCES: string[] = ["tejhq"];

export function isEndOfDaySource(source: string): boolean {
  return END_OF_DAY_SOURCES.includes(source);
}

/** Human label for a source's cadence, used in UI copy and run metadata. */
export function sourceCadenceLabel(source: string): string {
  return isEndOfDaySource(source) ? "EOD close (completed session)" : "provider quote";
}

/**
 * A dataset that may back a REAL_ONLY backtest: provider-sourced cache, or the
 * signed-in user's own import. Sample series, another user's import and unknown
 * sources are never eligible.
 */
export function isGenuineDatasetCandidate(
  dataset: { kind: "cache" | "import"; source: string; ownerId?: string | null },
  userId: string
): boolean {
  if (dataset.source === "sample") return false;
  if (dataset.kind === "import") return dataset.ownerId === userId;
  return true;
}

/**
 * True when a screener row's price is synthetic rather than a stored provider
 * price. Such a row is still shown by default (labelled SAMPLE), but callers can
 * exclude it explicitly.
 */
export function isSamplePricedRow(input: {
  hasStoredQuote: boolean;
  mode: DataMode | null | undefined;
}): boolean {
  return !input.hasStoredQuote || input.mode === "SAMPLE";
}

/** EOD rows can never become a LIVE badge, whatever their age. */
export function eodSafeMode(mode: DataMode, source: string): DataMode {
  if (!isEndOfDaySource(source)) return mode;
  return mode === "LIVE" ? "DELAYED" : mode;
}

/**
 * Whether a stored dataset can answer the request without another provider call.
 *
 * An import is always preferred (the user supplied it deliberately). A cache is
 * reused only while it is young enough and its newest bar reaches back into the
 * requested window — otherwise a stale cache would silently hide new sessions.
 */
export function isCandleCacheFresh(
  dataset: {
    kind: "cache" | "import";
    updatedAt: number;
    lastTs: number | null;
    rowCount: number;
  },
  context: { nowMs: number; toMs: number; intervalMs: number; ttlMs: number }
): boolean {
  if (dataset.rowCount === 0) return false;
  if (dataset.kind === "import") return true;
  const youngEnough = dataset.updatedAt > context.nowMs - context.ttlMs;
  const recentEnough = (dataset.lastTs ?? 0) > context.toMs - 3 * context.intervalMs;
  return youngEnough && recentEnough;
}

export type FeatureMode = DataMode | "UNAVAILABLE";

export interface CoverageSummary {
  providerQuotes: number;
  eodQuotes: number;
  cachedCandleSeries: number;
  importedCandleSeries: number;
  latestQuoteSessionDate: string | null;
  latestCandleDate: string | null;
  candleSources: string[];
}

export interface FeatureAvailability {
  key: string;
  label: string;
  mode: FeatureMode;
  detail: string;
}

/**
 * Per-feature data availability, derived only from what is stored.
 *
 * EOD prices are usable for display, screening and historical backtests, but they
 * are not executable: paper orders and alert triggers need a live/delayed tick.
 */
export function featureDataModes(
  coverage: CoverageSummary,
  intervals: Interval[] = []
): FeatureAvailability[] {
  const hasQuotes = coverage.providerQuotes > 0;
  const quotesAreEodOnly = hasQuotes && coverage.eodQuotes === coverage.providerQuotes;
  const quoteDate = coverage.latestQuoteSessionDate ?? "no stored session";
  const hasHistory = coverage.cachedCandleSeries > 0 || coverage.importedCandleSeries > 0;
  const historyDate = coverage.latestCandleDate ?? "no stored bars";
  const intradayIntervals: Interval[] = ["1m", "5m", "15m", "1h"];
  const noIntraday = intervals.length > 0 && !intervals.some((i) => intradayIntervals.includes(i));

  return [
    {
      key: "charts",
      label: "Charts & indicators",
      mode: hasHistory ? "HISTORICAL" : "SAMPLE",
      detail: hasHistory
        ? `Daily bars cached from ${coverage.candleSources.join(", ") || "imports"}; latest bar ${historyDate}. Intraday intervals are synthetic.`
        : "No provider history cached yet — charts fall back to SAMPLE series.",
    },
    {
      key: "quotes",
      label: "Watchlists, portfolio prices & screener",
      mode: hasQuotes ? "DELAYED" : "SAMPLE",
      detail: hasQuotes
        ? `${coverage.providerQuotes} stored prices, session ${quoteDate}${
            quotesAreEodOnly ? " (end-of-day close)" : ""
          }. Rows without a stored price are labelled SAMPLE.`
        : "No real prices stored — these screens show SAMPLE prices.",
    },
    {
      key: "backtests",
      label: "Backtests",
      mode: hasHistory ? "HISTORICAL" : "SAMPLE",
      detail: hasHistory
        ? `REAL_ONLY can use ${coverage.cachedCandleSeries} cached series and ${coverage.importedCandleSeries} imports; newest bar ${historyDate}.`
        : "No real candles yet — only SAMPLE backtests are possible.",
    },
    {
      key: "paper",
      label: "Paper trading fills",
      mode: quotesAreEodOnly ? "UNAVAILABLE" : hasQuotes ? "DELAYED" : "SAMPLE",
      detail: quotesAreEodOnly
        ? "Unavailable from this feed: EOD closes cannot price a paper fill. Orders are rejected rather than filled at yesterday's close."
        : hasQuotes
          ? `Fills use stored prices (session ${quoteDate}); stale prices are rejected.`
          : "No real prices stored — only SAMPLE fills (clearly labelled).",
    },
    {
      key: "alerts",
      label: "Price alerts",
      mode: quotesAreEodOnly ? "UNAVAILABLE" : hasQuotes ? "DELAYED" : "SAMPLE",
      detail: quotesAreEodOnly
        ? "EOD closes are recorded as observations but never fire an alert — they are yesterday's price, not now's."
        : hasQuotes
          ? `Alerts evaluate against stored prices (session ${quoteDate}).`
          : "Only SAMPLE prices exist, so any trigger is labelled SAMPLE.",
    },
    ...(noIntraday
      ? [
          {
            key: "intraday",
            label: "Intraday candles",
            mode: "UNAVAILABLE" as FeatureMode,
            detail:
              "The configured provider has no intraday endpoint. Daily bars are never resampled into intraday candles.",
          },
        ]
      : []),
  ];
}
