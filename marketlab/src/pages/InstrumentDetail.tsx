import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronDown, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Button, EmptyState, Select } from "@/components/ui";
import PriceChart from "@/components/chart/PriceChart";
import DataModeBadge from "@/components/market/DataModeBadge";
import DataFreshnessBadge from "@/components/market/DataFreshnessBadge";
import PriceChange from "@/components/market/PriceChange";
import { InvalidInstrument } from "@/components/system/BackendRequired";
import InstrumentDetailDemo from "@/pages/InstrumentDetailDemo";
import { parseInstrumentId } from "@/lib/demoCatalogue";
import { useQuotes } from "@/hooks/useQuotes";
import {
  INTERVALS,
  INTERVAL_LABEL,
  marketApi,
  type CandleResult,
  type ChartSource,
  type ChartType,
  type IndicatorConfig,
  type Interval,
  type ProviderOverview,
} from "@/lib/marketClient";
import {
  researchApi,
  type ResearchResult,
  type ResearchSection,
} from "@/lib/researchClient";
import {
  EventsPanel,
  FinancialsPanel,
  MetricGrid,
  NewsPanel,
  OverviewPanel,
  PeersPanel,
  ResearchUnavailable,
  ShareholdingPanel,
  formatPercent,
  type MetricItem,
} from "@/components/research/ResearchPanels";
import {
  formatAge,
  formatMarketCapCrore,
  formatPrice,
  formatTimestamp,
  formatVolume,
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

const CHART_TYPES = [
  { value: "candlestick", label: "Candlesticks" },
  { value: "bar", label: "OHLC bars" },
  { value: "line", label: "Line" },
];

/** Ranges only make sense on daily candles: no provider here serves intraday. */
const RANGES = [
  { key: "1M", months: 1 },
  { key: "3M", months: 3 },
  { key: "6M", months: 6 },
  { key: "1Y", months: 12 },
  { key: "5Y", months: 60 },
  { key: "MAX", months: 0 },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "charts", label: "Charts" },
  { id: "financials", label: "Financials" },
  { id: "shareholding", label: "Shareholding" },
  { id: "news", label: "News & Events" },
  { id: "peers", label: "Peers" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const RANGE_SECTIONS: Record<TabId, ResearchSection[]> = {
  overview: ["profile", "financials", "news"],
  charts: [],
  financials: ["financials"],
  shareholding: ["shareholding"],
  news: ["news", "events"],
  peers: ["profile"],
};

/** Merges a lazy section response into the research already on screen. */
function mergeResearch(previous: ResearchResult | null, next: ResearchResult): ResearchResult {
  if (!previous) return next;
  return {
    ...next,
    profile: next.profile ?? previous.profile,
    financials: next.financials ?? previous.financials,
    shareholding:
      next.shareholding.length > 0 ? next.shareholding : previous.shareholding,
    news: next.news ?? previous.news,
    events: next.events.length > 0 ? next.events : previous.events,
    ratios: next.ratios ?? previous.ratios,
    priceStats:
      next.priceStats.coverageDays !== null ? next.priceStats : previous.priceStats,
    errors: { ...previous.errors, ...next.errors },
  };
}

const InstrumentDetailLive: React.FC<InstrumentDetailProps> = ({ instrumentId, onBack }) => {
  const { isAuthenticated } = useRootContext();
  const instrument = useQuery(marketApi.getInstrument, { instrumentId });
  const preferences = useQuery(marketApi.chartPreferences, { instrumentId });
  const overview = useAction(marketApi.providerOverview);
  const getCandles = useAction(marketApi.getCandles);
  const getResearch = useAction(researchApi.getResearch);
  const importCsv = useAction(marketApi.importCsv);
  const savePreferences = useMutation(marketApi.saveChartPreferences);
  const saveChartSource = useMutation(api.users.setChartSource);
  const watchlists = useQuery(api.watchlists.list, {});
  const addItem = useMutation(api.watchlists.addItem);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [interval, setInterval] = useState<Interval>("1d");
  const [range, setRange] = useState<RangeKey>("1Y");
  const [chartSource, setChartSourceState] = useState<ChartSource>("tejhq");
  const chartSourceHydrated = useRef(false);
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [indicators, setIndicators] = useState<IndicatorConfig[]>(DEFAULT_INDICATORS);
  const [series, setSeries] = useState<CandleResult | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [chartsMounted, setChartsMounted] = useState(false);
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchFailure, setResearchFailure] = useState<string | null>(null);
  const [overviewState, setOverviewState] = useState<ProviderOverview | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [targetWatchlistId, setTargetWatchlistId] = useState("");
  const [watchlistStatus, setWatchlistStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preferencesHydrated = useRef(false);
  const loadedSections = useRef(new Set<ResearchSection>());
  const inFlightSections = useRef(new Set<ResearchSection>());

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

  const loadResearch = useCallback(
    async (sections: ResearchSection[]) => {
      const pending = sections.filter(
        (section) =>
          !loadedSections.current.has(section) && !inFlightSections.current.has(section)
      );
      if (pending.length === 0) return;
      for (const section of pending) inFlightSections.current.add(section);
      setResearchLoading(true);
      try {
        const result = await getResearch({ instrumentId, sections: pending });
        setResearch((previous) => mergeResearch(previous, result));
        setResearchFailure(null);
        for (const section of pending) {
          // A provider error still means "asked"; don't retry on every render.
          if (!result.errors[section]) loadedSections.current.add(section);
        }
      } catch (error) {
        setResearchFailure(
          error instanceof Error ? error.message : "Could not load company research"
        );
      } finally {
        for (const section of pending) inFlightSections.current.delete(section);
        setResearchLoading(false);
      }
    },
    [getResearch, instrumentId]
  );

  useEffect(() => {
    void loadResearch(RANGE_SECTIONS[activeTab]);
  }, [activeTab, loadResearch]);

  useEffect(() => {
    if (activeTab === "charts") setChartsMounted(true);
  }, [activeTab]);

  // Adopt the saved chart source once, without overriding a manual choice.
  useEffect(() => {
    if (chartSourceHydrated.current) return;
    const saved = overviewState?.preferredChartSource;
    if (!saved) return;
    chartSourceHydrated.current = true;
    if (saved === "nsemcp" || saved === "tejhq") setChartSourceState(saved);
  }, [overviewState]);

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
    async (nextInterval: Interval, nextRange: RangeKey, nextSource: ChartSource) => {
      setSeriesLoading(true);
      setSeriesError(null);
      const now = Date.now();
      const months = RANGES.find((entry) => entry.key === nextRange)?.months ?? 12;
      const fromMs = months === 0 ? undefined : now - months * 30 * 24 * 60 * 60 * 1000;
      try {
        const result = await getCandles({
          instrumentId,
          interval: nextInterval,
          source: nextSource,
          ...(nextInterval === "1d" && fromMs ? { fromMs, toMs: now } : {}),
        });
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
    if (!chartsMounted) return;
    void loadSeries(interval, range, chartSource);
  }, [chartsMounted, interval, range, chartSource, loadSeries]);

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

  const changeChartSource = (nextSource: ChartSource) => {
    if (nextSource === chartSource) return;
    setChartSourceState(nextSource);
    chartSourceHydrated.current = true;
    if (!isAuthenticated) return;
    void saveChartSource({ source: nextSource }).catch((error: unknown) => {
      console.warn("Could not save chart source", error);
    });
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
      await loadSeries(interval, range, chartSource);
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
    return (
      <div className="p-4 md:p-6" aria-busy="true">
        <span className="skeleton" style={{ display: "block", height: 22, width: 120 }} />
        <span className="skeleton mt-3" style={{ display: "block", height: 34, width: 260 }} />
        <span className="skeleton mt-6" style={{ display: "block", height: 460 }} />
      </div>
    );
  }
  if (instrument === null) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState
          title="Not in the catalogue"
          description={`${instrumentId} is not part of the synced instrument master.`}
          action={
            <Button variant="secondary" size="sm" onClick={onBack}>
              Back to markets
            </Button>
          }
        />
      </div>
    );
  }

  const profile = research?.profile ?? null;
  const ratios = research?.ratios ?? null;
  const financials = research?.financials ?? null;
  const latestAnnual = financials?.annual[financials.annual.length - 1] ?? null;
  const latestQuarter = financials?.quarterly[financials.quarterly.length - 1] ?? null;
  const stats = research?.priceStats ?? null;
  const showWatchlistPicker = isAuthenticated && (watchlists?.length ?? 0) > 0;

  /* Valuation: provider value first, otherwise price ÷ positive TTM EPS. */
  const derivedPe =
    quote && ratios?.eps && ratios.eps > 0 ? quote.lastPrice / ratios.eps : null;
  const peValue = ratios?.peTtm ?? derivedPe;
  const peIsCalculated = ratios?.peTtm === null && peValue !== null;
  const eps = ratios?.eps ?? latestAnnual?.eps ?? null;

  const valuationMetrics: MetricItem[] = [
    {
      label: "Market cap",
      value: formatMarketCapCrore(ratios?.marketCap ?? null),
      hint: "As reported by the research provider. Requires a provider share count; never estimated.",
    },
    {
      label: "P/E (TTM)",
      value:
        ratios?.eps !== null && ratios?.eps !== undefined && ratios.eps <= 0
          ? "Not meaningful"
          : peValue === null
            ? "—"
            : peValue.toFixed(2),
      hint: peIsCalculated
        ? "Calculated as current price ÷ provider TTM EPS."
        : "Provider-reported trailing P/E. Hidden when earnings are negative.",
      tone: ratios?.eps !== null && ratios?.eps !== undefined && ratios.eps <= 0 ? "muted" : undefined,
    },
    {
      label: "P/B",
      value: ratios?.pb === null || ratios?.pb === undefined ? "—" : ratios.pb.toFixed(2),
      hint: "Provider-reported price-to-book.",
    },
    {
      label: "EPS (TTM)",
      value: eps === null ? "—" : `₹${eps.toFixed(2)}`,
      hint: "Provider-reported trailing earnings per share. The latest reported annual figure is used when TTM is not supplied.",
    },
    {
      label: "Book value / share",
      value:
        ratios?.bookValuePerShare === null || ratios?.bookValuePerShare === undefined
          ? "—"
          : `₹${ratios.bookValuePerShare.toFixed(2)}`,
      hint: "Provider-reported book value per share.",
    },
    {
      label: "Dividend yield",
      value:
        ratios?.dividendYieldPct === null || ratios?.dividendYieldPct === undefined
          ? "—"
          : `${ratios.dividendYieldPct.toFixed(2)}%`,
      hint: "Provider-reported dividend yield. Not annualised by MarketLab.",
    },
  ];

  const healthMetrics: MetricItem[] = [
    {
      label: "ROE",
      value:
        ratios?.roePct === null || ratios?.roePct === undefined
          ? "—"
          : `${ratios.roePct.toFixed(2)}%`,
      hint: "Provider-reported return on equity.",
    },
    {
      label: "ROCE",
      value:
        ratios?.rocePct === null || ratios?.rocePct === undefined
          ? "—"
          : `${ratios.rocePct.toFixed(2)}%`,
      hint: "Provider-reported return on capital employed. Not meaningful for banks; not shown as zero.",
    },
    {
      label: "Debt / equity",
      value:
        ratios?.debtToEquity === null || ratios?.debtToEquity === undefined
          ? "—"
          : ratios.debtToEquity.toFixed(2),
      hint: "Provider-reported total debt ÷ shareholders' equity.",
    },
    {
      label: "Operating margin",
      value:
        ratios?.operatingMarginPct !== null && ratios?.operatingMarginPct !== undefined
          ? `${ratios.operatingMarginPct.toFixed(2)}%`
          : (latestAnnual?.operatingMarginPct ?? null) === null
            ? "—"
            : `${latestAnnual?.operatingMarginPct?.toFixed(2)}%`,
      hint: "From provider ratios, otherwise calculated from reported operating profit ÷ revenue.",
    },
    {
      label: "Net margin",
      value:
        ratios?.netMarginPct !== null && ratios?.netMarginPct !== undefined
          ? `${ratios.netMarginPct.toFixed(2)}%`
          : latestAnnual?.revenue && latestAnnual.netProfit !== null
            ? formatPercent((latestAnnual.netProfit / latestAnnual.revenue) * 100)
            : "—",
      hint: "Net profit ÷ revenue for the latest reported period.",
    },
  ];

  const marketMetrics: MetricItem[] = [
    {
      label: "Open",
      value: quote ? `₹${formatPrice(quote.open)}` : "—",
    },
    {
      label: "Previous close",
      value: quote ? `₹${formatPrice(quote.previousClose)}` : "—",
    },
    {
      label: "Day high",
      value: quote ? `₹${formatPrice(quote.high)}` : "—",
    },
    {
      label: "Day low",
      value: quote ? `₹${formatPrice(quote.low)}` : "—",
    },
    {
      label: stats?.fullYear ? "52-week high" : "Range high",
      value: stats?.high52w === null || stats?.high52w === undefined ? "—" : `₹${formatPrice(stats.high52w)}`,
      hint:
        stats?.high52w === null || stats?.high52w === undefined
          ? undefined
          : stats.fullYear
            ? "Highest traded price in the stored daily series over the last 52 weeks."
            : `Highest stored price across ${stats.coverageDays ?? 0} days of candles — not a full 52-week range.`,
    },
    {
      label: stats?.fullYear ? "52-week low" : "Range low",
      value: stats?.low52w === null || stats?.low52w === undefined ? "—" : `₹${formatPrice(stats.low52w)}`,
      hint:
        stats?.low52w === null || stats?.low52w === undefined
          ? undefined
          : stats.fullYear
            ? "Lowest traded price in the stored daily series over the last 52 weeks."
            : "Partial-range low from stored candles, not a 52-week low.",
    },
    {
      label: "Volume",
      value: quote ? formatVolume(quote.volume) : "—",
    },
    {
      label: "Average volume",
      value: stats?.averageVolume === null || stats?.averageVolume === undefined ? "—" : formatVolume(stats.averageVolume),
      hint: stats?.averageVolumeWindows
        ? `Mean of the last ${stats.averageVolumeWindows} stored sessions.`
        : "Needs at least five stored sessions.",
    },
  ];

  return (
    <div className="p-4 md:p-6">
      <button
        type="button"
        className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-3)] transition-colors hover:text-[var(--text)]"
        onClick={onBack}
      >
        <ArrowLeft size={13} aria-hidden="true" /> Markets
      </button>

      <header className="ml-detail-head mb-4">
        <div className="ml-detail-head__id min-w-0">
          <h1 className="truncate text-xl font-semibold text-[var(--text)] md:text-2xl">
            {profile?.name ?? instrument.name}
          </h1>
          <div className="ml-detail-tags mt-1">
            <span className="ml-mono text-[12px] font-medium text-[var(--text-2)]">
              {instrument.symbol}
            </span>
            <span className="ml-data-table__exchange">{instrument.exchange}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
              {instrument.instrumentType}
            </span>
            <span className="text-[11px] text-[var(--text-3)]">
              {profile?.sector ?? instrument.segment ?? "Sector not reported"}
              {profile?.industry ? ` · ${profile.industry}` : ""}
            </span>
            {quote ? <DataModeBadge mode={quote.mode} source={quote.source} /> : null}
          </div>

          {instrument.isSampleData && (
            <p className="ml-detail-note ml-detail-note--warn mt-1">
              Sample catalogue listing — prices keep their provider freshness label.
            </p>
          )}

          {showWatchlistPicker && (
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="w-44">
                <Select
                  label="Watchlist"
                  value={targetWatchlistId}
                  onSelect={setTargetWatchlistId}
                  options={(watchlists ?? []).map((wl) => ({ value: wl._id, label: wl.name }))}
                  placeholder="Select watchlist"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleAddToWatchlist()}
                disabled={!targetWatchlistId}
              >
                Add to watchlist
              </Button>
              {watchlistStatus && (
                <span role="status" className="text-[11px] text-[var(--text-3)]">
                  {watchlistStatus}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="ml-detail-quote">
          <span className={`ml-detail-quote__price ml-mono ${toneClass(quote?.change)}`}>
            {quote ? `₹${formatPrice(quote.lastPrice)}` : "—"}
          </span>
          {quote ? (
            <PriceChange
              change={quote.change}
              changePercent={quote.changePercent}
              showAbsolute
            />
          ) : (
            <span className="text-[11px] text-[var(--text-3)]">No quote available right now</span>
          )}
          {quote && (
            <>
              <span className="ml-detail-quote__meta">
                Source {quote.source === "sample" ? "sample catalogue" : quote.source} ·{" "}
                {quote.eod ? "end-of-day close" : "provider-delayed"}
              </span>
              <span className="ml-detail-quote__meta">
                {quote.quoteTime
                  ? `Session ${new Date(quote.quoteTime).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })} IST`
                  : "Timestamp unavailable"}
              </span>
              <span className="ml-detail-quote__meta">
                Vol {formatVolume(quote.volume)}
              </span>
              <DataFreshnessBadge
                mode={quote.mode}
                source={quote.source}
                asOf={quote.quoteTime}
                className="mt-1"
              />
            </>
          )}
        </div>
      </header>

      {researchFailure ? (
        <p role="alert" className="mb-3 rounded-md border border-[var(--neg)] px-3 py-2 text-[11px] text-[var(--neg)]">
          {researchFailure}
        </p>
      ) : null}

      {research && !research.configured ? (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
          <p className="text-xs font-medium text-[var(--text)]">Company research not configured</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-3)]">
            {research.reason} The Data sources page reports provider health; set
            <span className="ml-mono"> TAPETIDE_API_TOKEN </span>
            on the Convex deployment to enable company profile, financial statements, shareholding
            and news.
          </p>
        </div>
      ) : null}

      <section aria-label="Key metrics" className="space-y-3">
        <div>
          <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            Valuation
          </h2>
          <MetricGrid items={valuationMetrics} label="Valuation metrics" />
        </div>
        <div>
          <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            Profitability & financial health
          </h2>
          <MetricGrid items={healthMetrics} label="Profitability metrics" />
        </div>
        <div>
          <h2 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">
            Market statistics
          </h2>
          <MetricGrid items={marketMetrics} label="Market statistics" />
        </div>
        <p className="text-[10px] text-[var(--text-3)]">
          Quote figures use the selected market provider. Ratios come from the research provider and
          are never filled in from a different company or a different period.
        </p>
      </section>

      <div
        role="tablist"
        aria-label="Stock research sections"
        className="mt-5 flex gap-1 overflow-x-auto border-b border-[var(--border)]"
        onKeyDown={(event) => {
          if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
          event.preventDefault();
          const index = TABS.findIndex((tab) => tab.id === activeTab);
          const delta = event.key === "ArrowRight" ? 1 : -1;
          const next = TABS[(index + delta + TABS.length) % TABS.length];
          setActiveTab(next.id);
          document.getElementById(`research-tab-${next.id}`)?.focus();
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`research-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`research-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            className={`shrink-0 border-b-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
              activeTab === tab.id
                ? "border-[var(--accent)] text-[var(--text)]"
                : "border-transparent text-[var(--text-3)] hover:text-[var(--text)]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {activeTab === "overview" && (
          <div role="tabpanel" id="research-panel-overview" aria-labelledby="research-tab-overview">
            {researchLoading && !research ? (
              <p className="text-xs text-[var(--text-3)]">Loading company research…</p>
            ) : (
              <OverviewPanel
                profile={profile}
                financials={financials}
                news={research?.news ?? null}
                newsError={research?.errors.news ?? null}
                onOpenNews={() => setActiveTab("news")}
              />
            )}

            <details className="mt-4 rounded-lg border border-[var(--border)] px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-[var(--text-2)]">
                Catalogue record
                <ChevronDown size={13} aria-hidden="true" />
              </summary>
              <dl className="ml-kv mt-2">
                <div>
                  <dt>Exchange</dt>
                  <dd>{instrument.exchange}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{instrument.instrumentType}</dd>
                </div>
                <div>
                  <dt>Trading symbol</dt>
                  <dd className="ml-mono">{instrument.tradingSymbol ?? instrument.symbol}</dd>
                </div>
                <div>
                  <dt>ISIN</dt>
                  <dd className="ml-mono">{profile?.isin ?? instrument.isin ?? "—"}</dd>
                </div>
                <div>
                  <dt>Catalogue source</dt>
                  <dd>{instrument.isSampleData ? "sample catalogue" : "exchange master"}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{formatAge(instrument.lastUpdated, Date.now())}</dd>
                </div>
              </dl>
            </details>

            <details className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2">
              <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-medium text-[var(--text-2)]">
                Import historical data (CSV)
                <ChevronDown size={13} aria-hidden="true" />
              </summary>
              <div className="mt-2">
                <p className="text-[11px] leading-relaxed text-[var(--text-3)]">
                  Adds private OHLCV rows for {instrument.symbol} at the selected timeframe. Rows are
                  validated (timestamps, OHLC consistency, duplicates) and rejects are reported.
                </p>
                <label className="mt-2 block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-3)]">
                    CSV file
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="ml-file-input"
                    onChange={(event) => void handleFile(event.target.files?.[0])}
                  />
                </label>
                <p className="mt-1.5 flex items-start gap-1.5 text-[10px] text-[var(--text-3)]">
                  <Upload size={12} aria-hidden="true" className="mt-0.5" />
                  Columns: timestamp, open, high, low, close, volume (header optional). Naive
                  timestamps are read as IST. Limit 5 MB.
                </p>
                {importStatus && (
                  <p role="status" className="mt-2 text-xs text-[var(--pos)]">
                    {importStatus}
                  </p>
                )}
                {importError && (
                  <p role="alert" className="mt-2 text-xs text-[var(--neg)]">
                    {importError}
                  </p>
                )}
              </div>
            </details>
          </div>
        )}

        {activeTab === "charts" && (
          <div role="tabpanel" id="research-panel-charts" aria-labelledby="research-tab-charts">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <div className="ml-chip-row" role="group" aria-label="Historical range">
                {RANGES.map((entry) => {
                  const beyondBhavcopy =
                    chartSource === "nsemcp" && (entry.key === "5Y" || entry.key === "MAX");
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      className={`ml-chip ${range === entry.key ? "is-active" : ""}`}
                      aria-pressed={range === entry.key}
                      disabled={interval !== "1d" || beyondBhavcopy}
                      title={
                        interval !== "1d"
                          ? "Ranges apply to daily candles"
                          : beyondBhavcopy
                            ? "NSE Bhavcopy history is capped at 12 months per chart request"
                            : undefined
                      }
                      onClick={() => setRange(entry.key)}
                    >
                      {entry.key}
                    </button>
                  );
                })}
              </div>
              <div className="ml-chip-row" role="group" aria-label="Chart history source">
                <button
                  type="button"
                  className={`ml-chip ${chartSource === "tejhq" ? "is-active" : ""}`}
                  aria-pressed={chartSource === "tejhq"}
                  disabled={!isAuthenticated || overviewState?.chartSources?.tejhq === false}
                  title={isAuthenticated ? undefined : "Sign in to choose a chart source"}
                  onClick={() => changeChartSource("tejhq")}
                >
                  TejHQ EOD
                </button>
                <button
                  type="button"
                  className={`ml-chip ${chartSource === "nsemcp" ? "is-active" : ""}`}
                  aria-pressed={chartSource === "nsemcp"}
                  disabled={!isAuthenticated || overviewState?.chartSources?.nsemcp !== true}
                  title={
                    !isAuthenticated
                      ? "Sign in to choose a chart source"
                      : overviewState?.chartSources?.nsemcp === true
                        ? "Daily OHLCV from the NSE Bhavcopy MCP server (unadjusted)"
                        : "NSE Bhavcopy history is unavailable in this deployment"
                  }
                  onClick={() => changeChartSource("nsemcp")}
                >
                  NSE Bhavcopy EOD
                </button>
              </div>
              <div className="ml-chip-row" role="group" aria-label="Timeframe">
                {intervalChoices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className="ml-chip"
                    aria-pressed={interval === choice}
                    onClick={() => changeInterval(choice)}
                  >
                    {INTERVAL_LABEL[choice]}
                  </button>
                ))}
              </div>
              <div className="w-36">
                <Select
                  label="Chart type"
                  value={chartType}
                  onSelect={(value) => changeChartType(value as ChartType)}
                  options={CHART_TYPES}
                />
              </div>
            </div>

            <div className="ml-chip-row mb-3" role="group" aria-label="Indicators">
              {indicators.map((indicator) => (
                <label
                  key={indicator.name}
                  className={`ml-chip ${indicator.enabled ? "is-active" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={indicator.enabled}
                    onChange={() => toggleIndicator(indicator.name)}
                    className="accent-[var(--accent)]"
                  />
                  {indicator.name}
                  {(indicator.name === "SMA" ||
                    indicator.name === "EMA" ||
                    indicator.name === "RSI") && (
                    <input
                      type="number"
                      min={2}
                      max={200}
                      value={indicator.period ?? 20}
                      onChange={(event) =>
                        setIndicatorPeriod(indicator.name, Number(event.target.value) || 2)
                      }
                      className="ml-chip__input"
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
                  ? `${series.quality.rowCount} candles · ${series.quality.gaps} gaps · ${formatTimestamp(
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
              emptyMessage={`No candles for ${INTERVAL_LABEL[interval]} in this range. Import a CSV or configure a provider.`}
              height={460}
              toolbar={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadSeries(interval, range, chartSource)}
                >
                  Reload
                </Button>
              }
            />

            <div className="mt-2 space-y-1">
              {series?.warning && (
                <p role="alert" className="ml-detail-note ml-detail-note--warn">
                  {series.warning}
                </p>
              )}
              {series?.note && <p className="ml-detail-note ml-detail-note--warn">{series.note}</p>}
              {series && series.mode !== "SAMPLE" && series.quality.lastTs ? (
                <p className="ml-detail-note">
                  Latest available session: {formatTimestamp(series.quality.lastTs, interval)} ·
                  source {series.source}
                </p>
              ) : null}
              {series && series.mode === "SAMPLE" && instrument.instrumentType === "INDEX" ? (
                <p className="ml-detail-note ml-detail-note--warn">
                  No real data for this index: the keyless TejHQ feed publishes an equity bhavcopy,
                  which does not include index levels. The series above is the deterministic SAMPLE
                  fallback, not market data.
                </p>
              ) : null}
              {series && series.mode !== "SAMPLE" && series.adjusted === "unknown" && (
                <p className="ml-detail-note">
                  The provider does not document whether these prices are split/bonus adjusted.
                </p>
              )}
            </div>
          </div>
        )}

        {activeTab === "financials" && (
          <div
            role="tabpanel"
            id="research-panel-financials"
            aria-labelledby="research-tab-financials"
          >
            <FinancialsPanel
              financials={financials}
              loading={researchLoading}
              error={research?.errors.financials ?? null}
              reason={research?.reason ?? null}
            />
          </div>
        )}

        {activeTab === "shareholding" && (
          <div
            role="tabpanel"
            id="research-panel-shareholding"
            aria-labelledby="research-tab-shareholding"
          >
            <ShareholdingPanel
              periods={research?.shareholding ?? []}
              loading={researchLoading}
              error={research?.errors.shareholding ?? null}
              reason={research?.reason ?? null}
            />
          </div>
        )}

        {activeTab === "news" && (
          <div role="tabpanel" id="research-panel-news" aria-labelledby="research-tab-news">
            <h3 className="text-sm font-semibold text-[var(--text)]">Company news</h3>
            <p className="mb-2 mt-0.5 text-[10px] text-[var(--text-3)]">
              Headlines, summaries and links are supplied by the configured news provider. MarketLab
              never generates or rewrites an article.
            </p>
            <NewsPanel
              feed={research?.news ?? null}
              loading={researchLoading}
              error={research?.errors.news ?? null}
              gnewsDelayed={research?.gnewsDelayed ?? false}
            />

            <h3 className="mt-6 text-sm font-semibold text-[var(--text)]">
              Official filings & corporate events
            </h3>
            <p className="mb-2 mt-0.5 text-[10px] text-[var(--text-3)]">
              Regulatory filings are kept separate from press coverage and are never shown as
              confirmed unless the source says so.
            </p>
            <EventsPanel
              events={research?.events ?? []}
              error={research?.errors.events ?? null}
            />
          </div>
        )}

        {activeTab === "peers" && (
          <div role="tabpanel" id="research-panel-peers" aria-labelledby="research-tab-peers">
            <PeersPanel profile={profile} reason={research?.reason ?? null} />
            {!profile && research?.configured ? (
              <ResearchUnavailable
                title="Peer comparison unavailable"
                reason={
                  research.errors.profile ??
                  "The provider did not return a peer list for this company."
                }
              />
            ) : null}
          </div>
        )}
      </div>

      <p className="mt-6 text-[10px] leading-relaxed text-[var(--text-3)]">
        Research and educational tool only. Fundamentals and news are third-party data shown with
        their source and reporting period; nothing here is investment advice and no orders are placed
        from this page.
      </p>
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
