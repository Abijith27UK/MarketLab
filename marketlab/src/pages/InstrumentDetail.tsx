import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Button, Select } from "@/components/ui";
import PriceChart from "@/components/chart/PriceChart";
import DataModeBadge from "@/components/market/DataModeBadge";
import { InvalidInstrument } from "@/components/system/BackendRequired";
import InstrumentDetailDemo from "@/pages/InstrumentDetailDemo";
import { parseInstrumentId } from "@/lib/demoCatalogue";
import { useQuotes } from "@/hooks/useQuotes";
import {
  INTERVALS,
  INTERVAL_LABEL,
  marketApi,
  type CandleResult,
  type ChartType,
  type FundamentalsResult,
  type IndicatorConfig,
  type Interval,
  type ProviderOverview,
} from "@/lib/marketClient";
import {
  formatAge,
  formatMarketCapCrore,
  formatPercent,
  formatPrice,
  formatTimestamp,
  formatVolume,
  signGlyph,
  toneClass,
} from "@/lib/format";

interface InstrumentDetailProps {
  instrumentId: string;
  onBack: () => void;
}

const DEFAULT_INDICATORS: IndicatorConfig[] = [
  { name: "SMA", enabled: true, period: 20 },
  { name: "EMA", enabled: false, period: 20 },
  { name: "RSI", enabled: false, period: 14 },
  { name: "MACD", enabled: false, fast: 12, slow: 26, signal: 9 },
  { name: "BOLLINGER", enabled: false, period: 20, multiplier: 2 },
  { name: "VWAP", enabled: false },
];

const InstrumentDetailLive: React.FC<InstrumentDetailProps> = ({ instrumentId, onBack }) => {
  const { isAuthenticated } = useRootContext();
  const instrument = useQuery(marketApi.getInstrument, { instrumentId });
  const preferences = useQuery(marketApi.chartPreferences, { instrumentId });
  const overview = useAction(marketApi.providerOverview);
  const getCandles = useAction(marketApi.getCandles);
  const getFundamentals = useAction(marketApi.getFundamentals);
  const importCsv = useAction(marketApi.importCsv);
  const savePreferences = useMutation(marketApi.saveChartPreferences);
  const watchlists = useQuery(api.watchlists.list, {});
  const addItem = useMutation(api.watchlists.addItem);

  const [interval, setInterval] = useState<Interval>("1d");
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(DEFAULT_INDICATORS);
  const [series, setSeries] = useState<CandleResult | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalsResult | null>(null);
  const [fundamentalsLoading, setFundamentalsLoading] = useState(false);
  const [overviewState, setOverviewState] = useState<ProviderOverview | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [targetWatchlistId, setTargetWatchlistId] = useState("");
  const [watchlistStatus, setWatchlistStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preferencesHydrated = useRef(false);

  const { data: quoteData } = useQuotes([instrumentId]);
  const quote = quoteData?.quotes[0] ?? null;

  useEffect(() => {
    void overview().then(setOverviewState).catch(() => setOverviewState(null));
  }, [overview]);

  // Adopt the saved preferences for this instrument once.
  useEffect(() => {
    if (preferencesHydrated.current) return;
    if (!preferences) return;
    preferencesHydrated.current = true;
    setInterval(preferences.interval);
    setChartType(preferences.chartType);
    setIndicators(
      preferences.indicators.length > 0 ? preferences.indicators : DEFAULT_INDICATORS
    );
  }, [preferences]);

  const persist = useCallback(
    async (
      nextInterval: Interval,
      nextType: ChartType,
      nextIndicators: IndicatorConfig[]
    ) => {
      if (!isAuthenticated) return;
      try {
        await savePreferences({
          instrumentId,
          interval: nextInterval,
          chartType: nextType,
          indicators: nextIndicators,
        });
      } catch (error) {
        console.warn("Could not save chart preferences", error);
      }
    },
    [instrumentId, isAuthenticated, savePreferences]
  );

  const loadSeries = useCallback(
    async (nextInterval: Interval) => {
      setSeriesLoading(true);
      setSeriesError(null);
      try {
        const result = await getCandles({ instrumentId, interval: nextInterval });
        setSeries(result);
      } catch (error) {
        setSeries(null);
        setSeriesError(error instanceof Error ? error.message : "Could not load candles");
      } finally {
        setSeriesLoading(false);
      }
    },
    [getCandles, instrumentId]
  );

  useEffect(() => {
    void loadSeries(interval);
  }, [interval, loadSeries]);

  const intervalChoices = useMemo(() => {
    if (overviewState?.hasConfiguredProvider && overviewState.availableIntervals.length > 0) {
      return overviewState.availableIntervals;
    }
    return INTERVALS;
  }, [overviewState]);

  const toggleIndicator = (name: IndicatorConfig["name"]) => {
    const next = indicators.map((indicator) =>
      indicator.name === name ? { ...indicator, enabled: !indicator.enabled } : indicator
    );
    setIndicators(next);
    void persist(interval, chartType, next);
  };

  const setIndicatorPeriod = (name: IndicatorConfig["name"], period: number) => {
    const next = indicators.map((indicator) =>
      indicator.name === name ? { ...indicator, period } : indicator
    );
    setIndicators(next);
    void persist(interval, chartType, next);
  };

  const changeInterval = (nextInterval: Interval) => {
    setInterval(nextInterval);
    void persist(nextInterval, chartType, indicators);
  };

  const changeChartType = (nextType: ChartType) => {
    setChartType(nextType);
    void persist(interval, nextType, indicators);
  };

  const loadFundamentals = async () => {
    setFundamentalsLoading(true);
    try {
      setFundamentals(await getFundamentals({ instrumentId }));
    } catch (error) {
      setFundamentals({
        fundamentals: null,
        note: error instanceof Error ? error.message : "Could not load fundamentals",
      });
    } finally {
      setFundamentalsLoading(false);
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setImportStatus(null);
    setImportError(null);
    try {
      const text = await file.text();
      if (text.length > 5 * 1024 * 1024) throw new Error("CSV is larger than the 5 MB limit");
      const result = await importCsv({
        instrumentId,
        interval,
        fileName: file.name,
        csvText: text,
      });
      setImportStatus(
        `Imported ${result.accepted} rows (${result.summary.rejectedRows} rejected, ${
          result.summary.duplicatesRemoved
        } duplicates). ${result.rejected[0]?.reason ?? ""}`
      );
      await loadSeries(interval);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAddToWatchlist = async () => {
    if (!targetWatchlistId) return;
    setWatchlistStatus(null);
    try {
      await addItem({ watchlistId: targetWatchlistId as never, instrumentId });
      setWatchlistStatus("Added to watchlist.");
    } catch (error) {
      setWatchlistStatus(error instanceof Error ? error.message : "Could not add to watchlist");
    }
  };

  if (instrument === undefined) {
    return <div className="p-6 text-gray-400">Loading instrument…</div>;
  }
  if (instrument === null) {
    return (
      <div className="p-6">
        <p className="text-gray-400">This instrument is not in the catalogue.</p>
        <Button variant="secondary" className="mt-3" onClick={onBack}>
          Back to markets
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <button className="mb-3 text-xs text-gray-400 hover:text-white" onClick={onBack}>
        ← Back
      </button>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-bold">{instrument.symbol}</h1>
            <span className="text-sm text-gray-500">
              {instrument.exchange} · {instrument.instrumentType}
              {instrument.segment ? ` · ${instrument.segment}` : ""}
            </span>
            {quote && <DataModeBadge mode={quote.mode} source={quote.source} />}
          </div>
          <p className="text-gray-400">{instrument.name}</p>
          {quote?.eod && quote.quoteTime ? (
            <p className="mt-1 text-xs text-gray-500">
              End-of-day close · {new Date(quote.quoteTime).toLocaleDateString("en-IN")} — not a live
              quote.
            </p>
          ) : null}
          {instrument.isSampleData && (
            <p className="mt-1 text-xs text-amber-400/80">
              Listed in the built-in sample catalogue rather than a synced exchange master.
              {quote && quote.source !== "sample"
                ? ` Prices and candles come from ${quote.source} and keep its freshness label.`
                : " Prices shown are sample data."}
            </p>
          )}
        </div>

        {quote && (
          <div className="text-right">
            <p className={`text-2xl font-bold ${toneClass(quote.change)}`}>
              ₹{formatPrice(quote.lastPrice)}
            </p>
            <p className={`text-sm ${toneClass(quote.changePercent)}`}>
              {signGlyph(quote.changePercent)} {formatPrice(quote.change)} (
              {formatPercent(quote.changePercent)})
            </p>
            <p className="text-xs text-gray-500">
              Vol {formatVolume(quote.volume)} · updated {formatAge(quote.quoteTime, Date.now())}
            </p>
          </div>
        )}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Timeframe">
          {intervalChoices.map((choice) => (
            <button
              key={choice}
              onClick={() => changeInterval(choice)}
              className={`rounded border px-2.5 py-1 text-xs ${
                interval === choice
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                  : "border-gray-700 text-gray-400 hover:bg-gray-800"
              }`}
              aria-pressed={interval === choice}
            >
              {INTERVAL_LABEL[choice]}
            </button>
          ))}
        </div>

        <div className="w-40">
          <Select
            value={chartType}
            onSelect={(value) => changeChartType(value as ChartType)}
            options={[
              { value: "candlestick", label: "Candlesticks" },
              { value: "bar", label: "OHLC bars" },
              { value: "line", label: "Line" },
            ]}
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {indicators.map((indicator) => (
          <label
            key={indicator.name}
            className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
              indicator.enabled
                ? "border-emerald-500/60 text-emerald-300"
                : "border-gray-700 text-gray-400"
            }`}
          >
            <input
              type="checkbox"
              checked={indicator.enabled}
              onChange={() => toggleIndicator(indicator.name)}
            />
            {indicator.name}
            {(indicator.name === "SMA" || indicator.name === "EMA" || indicator.name === "RSI") && (
              <input
                type="number"
                min={2}
                max={200}
                value={indicator.period ?? 20}
                onChange={(event) =>
                  setIndicatorPeriod(indicator.name, Number(event.target.value) || 2)
                }
                className="w-14 rounded border border-gray-700 bg-gray-900 px-1 py-0.5 text-gray-200"
                aria-label={`${indicator.name} period`}
              />
            )}
          </label>
        ))}
      </div>

      <PriceChart
        title={`${instrument.symbol} · ${INTERVAL_LABEL[interval]}`}
        subtitle={
          series
            ? `${series.quality.rowCount} candles · ${series.quality.gaps} gaps detected · ${formatTimestamp(
                series.quality.firstTs,
                interval
              )} → ${formatTimestamp(series.quality.lastTs, interval)}`
            : undefined
        }
        candles={series?.candles ?? []}
        interval={interval}
        chartType={chartType}
        indicators={indicators}
        mode={series?.mode ?? "SAMPLE"}
        source={series?.source ?? "sample"}
        loading={seriesLoading}
        error={seriesError}
        emptyMessage={`No candles for ${INTERVAL_LABEL[interval]} yet. Import a CSV or configure a provider.`}
        toolbar={
          <Button variant="secondary" size="sm" onClick={() => void loadSeries(interval)}>
            Reload
          </Button>
        }
      />

      {series?.warning && <p className="mt-2 text-xs text-red-400">{series.warning}</p>}
      {series?.note && <p className="mt-2 text-xs text-amber-400/80">{series.note}</p>}
      {series && series.mode !== "SAMPLE" && series.quality.lastTs ? (
        <p className="mt-1 text-xs text-gray-500">
          Latest available session: {formatTimestamp(series.quality.lastTs, interval)} · source{" "}
          {series.source}
        </p>
      ) : null}
      {series && series.mode === "SAMPLE" && instrument.instrumentType === "INDEX" ? (
        <p className="mt-1 text-xs text-amber-400/80">
          No real data for this index: the keyless TejHQ feed publishes an equity bhavcopy, which
          does not include index levels. The series above is the deterministic SAMPLE fallback, not
          market data.
        </p>
      ) : null}
      {series && series.mode !== "SAMPLE" && series.adjusted === "unknown" && (
        <p className="mt-1 text-xs text-gray-500">
          The provider does not document whether these prices are split/bonus adjusted.
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Company fundamentals</h2>
            <Button variant="secondary" size="sm" onClick={() => void loadFundamentals()} disabled={fundamentalsLoading}>
              {fundamentalsLoading ? "Loading…" : "Load"}
            </Button>
          </div>
          {!fundamentals && (
            <p className="text-sm text-gray-500">
              Fundamentals require a configured Tapetide token. Nothing is requested until you press
              Load.
            </p>
          )}
          {fundamentals?.fundamentals && (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-gray-500">P/E (TTM)</dt>
                <dd className="text-gray-200">{fundamentals.fundamentals.peTtm ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Market cap</dt>
                <dd className="text-gray-200">
                  {formatMarketCapCrore(fundamentals.fundamentals.marketCapCrore)}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500">52-week high</dt>
                <dd className="text-gray-200">{formatPrice(fundamentals.fundamentals.high52w)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">52-week low</dt>
                <dd className="text-gray-200">{formatPrice(fundamentals.fundamentals.low52w)}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-gray-500">Statement sections</dt>
                <dd className="text-gray-200">
                  {fundamentals.fundamentals.sections.length === 0
                    ? "None returned"
                    : fundamentals.fundamentals.sections
                        .map((section) => `${section.name} (${section.periodCount})`)
                        .join(", ")}
                </dd>
              </div>
              <div className="col-span-2 text-xs text-gray-500">
                Source {fundamentals.fundamentals.source} · <DataModeBadge mode={fundamentals.fundamentals.mode} />{" "}
                fetched {formatAge(fundamentals.fundamentals.fetchedAt, Date.now())}
              </div>
            </dl>
          )}
          {fundamentals?.note && <p className="mt-2 text-xs text-amber-400/80">{fundamentals.note}</p>}
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Historical data</h2>
          <p className="text-sm text-gray-400">
            Import an OHLCV CSV for {instrument.symbol} at the selected timeframe. Rows are validated
            (timestamps, OHLC consistency, duplicates) and rejected rows are reported. Imports are
            private to your account.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="mt-3 block w-full text-xs text-gray-400"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <p className="mt-2 text-xs text-gray-600">
            Expected columns: timestamp, open, high, low, close, volume (header optional). Naive
            timestamps are read as IST.
          </p>
          {importStatus && <p className="mt-2 text-xs text-emerald-400">{importStatus}</p>}
          {importError && <p className="mt-2 text-xs text-red-400">{importError}</p>}

          {isAuthenticated && (watchlists?.length ?? 0) > 0 && (
            <div className="mt-5 border-t border-gray-800 pt-4">
              <label className="mb-1 block text-sm text-gray-300">Add to watchlist</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Select
                    value={targetWatchlistId}
                    onSelect={setTargetWatchlistId}
                    options={(watchlists ?? []).map((wl) => ({ value: wl._id, label: wl.name }))}
                    placeholder="Select watchlist"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void handleAddToWatchlist()}
                  disabled={!targetWatchlistId}
                >
                  Add
                </Button>
              </div>
              {watchlistStatus && <p className="mt-2 text-xs text-emerald-400">{watchlistStatus}</p>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ router */

/**
 * Validates the id, then picks the backend-backed view or the sample view.
 * A malformed id never reaches a Convex query.
 */
const InstrumentDetail: React.FC<InstrumentDetailProps> = ({ instrumentId, onBack }) => {
  const { backendOnline } = useRootContext();

  if (!parseInstrumentId(instrumentId)) {
    return <InvalidInstrument instrumentId={instrumentId} onBack={onBack} />;
  }
  if (!backendOnline) {
    return <InstrumentDetailDemo instrumentId={instrumentId} onBack={onBack} />;
  }
  return <InstrumentDetailLive instrumentId={instrumentId} onBack={onBack} />;
};

export default InstrumentDetail;
