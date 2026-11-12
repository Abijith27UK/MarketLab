import React, { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  ChevronDown,
  Filter,
  RotateCcw,
  SearchX,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useRootContext } from "@/context/RootContext";
import { Button, Card, EmptyState, Input, Select, SectionHeader } from "@/components/ui";
import BackendRequired from "@/components/system/BackendRequired";
import DataModeBadge from "@/components/market/DataModeBadge";
import {
  INTERVALS,
  INTERVAL_LABEL,
  marketApi,
  type Exchange,
  type InstrumentType,
  type Interval,
  type ScreenerFilters,
  type ScreenerResult,
  type ScreenerRow,
} from "@/lib/marketClient";
import {
  formatMarketCapCrore,
  formatPercent,
  formatPrice,
  formatVolume,
  toneClass,
} from "@/lib/format";

interface ScreenerProps {
  onOpenInstrument: (instrumentId: string) => void;
}

type SortKey = "symbol" | "price" | "change" | "volume" | "pe" | "marketCap" | "technical";

const emptyFilters: ScreenerFilters = {
  exchange: "ALL",
  instrumentType: "ALL",
  limit: 50,
};

const DEFAULT_LIMIT = 50;

const EXCHANGE_OPTIONS = [
  { value: "ALL", label: "All exchanges" },
  { value: "NSE", label: "NSE" },
  { value: "BSE", label: "BSE" },
];

const TYPE_OPTIONS = [
  { value: "ALL", label: "All types" },
  { value: "EQUITY", label: "Equity" },
  { value: "ETF", label: "ETF" },
  { value: "INDEX", label: "Index" },
];

const SORT_OPTIONS = [
  { value: "symbol", label: "Symbol" },
  { value: "price", label: "Price" },
  { value: "change", label: "Change %" },
  { value: "volume", label: "Volume" },
  { value: "pe", label: "P/E" },
  { value: "marketCap", label: "Market cap" },
  { value: "technical", label: "Technical value" },
];

const toNumber = (value: string): number | undefined => {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** Screen-reader friendly narrow-viewport probe for the filter panel. */
const NARROW_QUERY = "(max-width: 1179px)";

const useNarrow = (): boolean => {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(NARROW_QUERY).matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return narrow;
};

/**
 * Starting points for the filter form. They only pre-fill documented filters —
 * the backend validates every value again, and none of them asserts a provider
 * or live data is available.
 */
const PRESETS: { id: string; label: string; hint: string; filters: ScreenerFilters }[] = [
  {
    id: "gainers",
    label: "Gainers",
    hint: "Up more than 1% on the latest available price",
    filters: { minChangePercent: 1 },
  },
  {
    id: "losers",
    label: "Losers",
    hint: "Down more than 1% on the latest available price",
    filters: { maxChangePercent: -1 },
  },
  {
    id: "largecap",
    label: "Large cap",
    hint: "Market cap above ₹20,000 crore",
    filters: { minMarketCapCrore: 20_000 },
  },
  {
    id: "value",
    label: "Low P/E",
    hint: "P/E below 25 where fundamentals exist",
    filters: { maxPe: 25 },
  },
  {
    id: "liquid",
    label: "Liquid",
    hint: "Volume above 1,00,000",
    filters: { minVolume: 100_000 },
  },
];

/** Row metric used for client-side sorting; nulls always sort last. */
const metricOf = (row: ScreenerRow, key: SortKey): number | string | null => {
  switch (key) {
    case "price":
      return row.lastPrice;
    case "change":
      return row.changePercent;
    case "volume":
      return row.volume;
    case "pe":
      return row.peTtm;
    case "marketCap":
      return row.marketCapCrore;
    case "technical":
      return row.technicalValue;
    default:
      return row.symbol;
  }
};

const ScreenerLive: React.FC<ScreenerProps> = ({ onOpenInstrument }) => {
  const { isAuthenticated } = useRootContext();
  const narrow = useNarrow();
  const runScreener = useAction(marketApi.screenerRun);
  const availability = useQuery(marketApi.screenerAvailability, {});
  const saved = useQuery(marketApi.savedScreeners, {});
  const saveScreener = useMutation(marketApi.saveScreener);
  const renameScreener = useMutation(marketApi.renameScreener);
  const removeScreener = useMutation(marketApi.removeScreener);

  const [filters, setFilters] = useState<ScreenerFilters>(emptyFilters);
  const [technicalEnabled, setTechnicalEnabled] = useState(false);
  const [technicalIndicator, setTechnicalIndicator] = useState<"RSI" | "PRICE_VS_SMA">("RSI");
  const [technicalPeriod, setTechnicalPeriod] = useState("14");
  const [technicalInterval, setTechnicalInterval] = useState<Interval>("1d");
  const [technicalMin, setTechnicalMin] = useState("60");
  const [technicalMax, setTechnicalMax] = useState("100");
  const [excludeSample, setExcludeSample] = useState(false);
  const [result, setResult] = useState<ScreenerResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "symbol", dir: 1 });

  const update = <K extends keyof ScreenerFilters,>(key: K, value: ScreenerFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const effectiveFilters = (): ScreenerFilters => ({
    ...filters,
    excludeSample,
    technical: technicalEnabled
      ? {
          indicator: technicalIndicator,
          period: Number(technicalPeriod) || 14,
          interval: technicalInterval,
          min: toNumber(technicalMin),
          max: toNumber(technicalMax),
        }
      : undefined,
  });

  const run = async (override?: ScreenerFilters) => {
    setRunning(true);
    setError(null);
    try {
      const payload = override ?? effectiveFilters();
      setResult(await runScreener({ filters: payload }));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Screener failed");
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const save = async () => {
    setSaveStatus(null);
    if (!saveName.trim()) {
      setSaveStatus("Enter a name for this screen.");
      return;
    }
    try {
      await saveScreener({
        name: saveName.trim(),
        filtersJson: JSON.stringify(effectiveFilters()),
        resultCount: result?.matched ?? 0,
      });
      setSaveName("");
      setSaveStatus("Saved.");
    } catch (err) {
      setSaveStatus(err instanceof Error ? err.message : "Could not save");
    }
  };

  const loadSaved = (json: string) => {
    try {
      const parsed = JSON.parse(json) as ScreenerFilters;
      setFilters({
        ...emptyFilters,
        ...parsed,
        technical: undefined,
      });
      setExcludeSample(parsed.excludeSample === true);
      if (parsed.technical) {
        setTechnicalEnabled(true);
        setTechnicalIndicator(parsed.technical.indicator);
        setTechnicalPeriod(String(parsed.technical.period));
        setTechnicalInterval(parsed.technical.interval);
        setTechnicalMin(parsed.technical.min !== undefined ? String(parsed.technical.min) : "");
        setTechnicalMax(parsed.technical.max !== undefined ? String(parsed.technical.max) : "");
      } else {
        setTechnicalEnabled(false);
      }
      void run(parsed);
    } catch {
      setSaveStatus("Saved screen could not be parsed.");
    }
  };

  /* ---- active filter chips ---- */

  const activeChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    if (filters.search) chips.push({ key: "search", label: `“${filters.search}”` });
    if (filters.exchange && filters.exchange !== "ALL") {
      chips.push({ key: "exchange", label: filters.exchange });
    }
    if (filters.instrumentType && filters.instrumentType !== "ALL") {
      chips.push({ key: "instrumentType", label: filters.instrumentType });
    }
    if (filters.minPrice !== undefined) chips.push({ key: "minPrice", label: `Price ≥ ${filters.minPrice}` });
    if (filters.maxPrice !== undefined) chips.push({ key: "maxPrice", label: `Price ≤ ${filters.maxPrice}` });
    if (filters.minChangePercent !== undefined) {
      chips.push({ key: "minChangePercent", label: `Change ≥ ${filters.minChangePercent}%` });
    }
    if (filters.maxChangePercent !== undefined) {
      chips.push({ key: "maxChangePercent", label: `Change ≤ ${filters.maxChangePercent}%` });
    }
    if (filters.minVolume !== undefined) {
      chips.push({ key: "minVolume", label: `Volume ≥ ${formatVolume(filters.minVolume)}` });
    }
    if (filters.minPe !== undefined) chips.push({ key: "minPe", label: `P/E ≥ ${filters.minPe}` });
    if (filters.maxPe !== undefined) chips.push({ key: "maxPe", label: `P/E ≤ ${filters.maxPe}` });
    if (filters.minMarketCapCrore !== undefined) {
      chips.push({
        key: "minMarketCapCrore",
        label: `Mkt cap ≥ ${formatMarketCapCrore(filters.minMarketCapCrore)}`,
      });
    }
    if (filters.maxMarketCapCrore !== undefined) {
      chips.push({
        key: "maxMarketCapCrore",
        label: `Mkt cap ≤ ${formatMarketCapCrore(filters.maxMarketCapCrore)}`,
      });
    }
    if (technicalEnabled) {
      chips.push({
        key: "technical",
        label: `${technicalIndicator} ${technicalPeriod} · ${INTERVAL_LABEL[technicalInterval]}`,
      });
    }
    if (excludeSample) chips.push({ key: "excludeSample", label: "Real data only" });
    if (filters.limit !== undefined && filters.limit !== DEFAULT_LIMIT) {
      chips.push({ key: "limit", label: `Limit ${filters.limit}` });
    }
    return chips;
  }, [
    excludeSample,
    filters,
    technicalEnabled,
    technicalIndicator,
    technicalInterval,
    technicalPeriod,
  ]);

  const clearChip = (key: string) => {
    switch (key) {
      case "search":
        update("search", undefined);
        break;
      case "exchange":
        update("exchange", "ALL");
        break;
      case "instrumentType":
        update("instrumentType", "ALL");
        break;
      case "minPrice":
        update("minPrice", undefined);
        break;
      case "maxPrice":
        update("maxPrice", undefined);
        break;
      case "minChangePercent":
        update("minChangePercent", undefined);
        break;
      case "maxChangePercent":
        update("maxChangePercent", undefined);
        break;
      case "minVolume":
        update("minVolume", undefined);
        break;
      case "minPe":
        update("minPe", undefined);
        break;
      case "maxPe":
        update("maxPe", undefined);
        break;
      case "minMarketCapCrore":
        update("minMarketCapCrore", undefined);
        break;
      case "maxMarketCapCrore":
        update("maxMarketCapCrore", undefined);
        break;
      case "limit":
        update("limit", DEFAULT_LIMIT);
        break;
      case "technical":
        setTechnicalEnabled(false);
        break;
      case "excludeSample":
        setExcludeSample(false);
        break;
      default:
        break;
    }
    setActivePreset(null);
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setTechnicalEnabled(false);
    setExcludeSample(false);
    setActivePreset(null);
    setSaveStatus(null);
    void run({ ...emptyFilters, excludeSample: false });
  };

  /* ---- sorting ---- */

  const sortedRows = useMemo(() => {
    const rows = result?.rows ?? [];
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const left = metricOf(a, sort.key);
      const right = metricOf(b, sort.key);
      if (left === null && right === null) return 0;
      if (left === null) return 1;
      if (right === null) return -1;
      if (typeof left === "string" || typeof right === "string") {
        return String(left).localeCompare(String(right)) * sort.dir;
      }
      return (left - right) * sort.dir;
    });
    return sorted;
  }, [result, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: 1 }
    );

  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : null);

  const panelCollapsed = narrow && !panelOpen;
  const hasRows = Boolean(result && result.rows.length > 0);

  return (
    <div className="p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="ml-page-title">Stock Screener</h1>
          <p className="ml-page-sub">
            Filter the instruments MarketLab has stored — quotes, fundamentals and any candle history
            you have imported. No provider quota is consumed per row.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {result ? (
            <span className="ml-badge" data-testid="screener-result-count">
              {result.matched} of {result.evaluated} matched
            </span>
          ) : null}
          {result ? <DataModeBadge mode={result.mode} /> : null}
        </div>
      </header>

      {availability && (
        <p className="ml-account-note mb-4">
          <SlidersHorizontal size={12} aria-hidden="true" />
          <span>
            {availability.instrumentCount} instruments ·{" "}
            {availability.quoteFields ? "quote filters ready" : "no stored quotes yet"} ·{" "}
            {availability.fundamentalFields ? "fundamentals available" : "no fundamentals"} ·{" "}
            {availability.technicalFields ? "candle history available" : "no candle history"}
          </span>
        </p>
      )}

      {!isAuthenticated && (
        <p className="ml-ticket__hint ml-ticket__hint--warn mb-4">
          Sign in to run the screener and save configurations. Filters stay editable, but nothing is
          evaluated until you do.
        </p>
      )}

      {narrow && (
        <Button
          variant="secondary"
          className="mb-4 w-full"
          aria-expanded={panelOpen}
          aria-controls="screener-filters"
          onClick={() => setPanelOpen((open) => !open)}
        >
          <Filter size={13} aria-hidden="true" />
          Filters{activeChips.length > 0 ? ` (${activeChips.length})` : ""}
          <ChevronDown
            size={13}
            aria-hidden="true"
            style={{ transform: panelOpen ? "rotate(180deg)" : undefined }}
          />
        </Button>
      )}

      <div className="ml-screener">
        <div className="ml-screener__side">
          <Card className={panelCollapsed ? "is-collapsed" : undefined}>
            <div id="screener-filters">
              <div className="ml-filter-panel__head">
                <h2 className="ml-section-title">Filters</h2>
                <span className="ml-metric__hint">
                  {activeChips.length} active
                </span>
              </div>

              {activeChips.length > 0 && (
                <div className="ml-active-filters">
                  {activeChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      className="ml-filter-chip"
                      onClick={() => clearChip(chip.key)}
                      aria-label={`Remove filter ${chip.label}`}
                    >
                      {chip.label}
                      <X size={11} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}

              <div className="ml-chip-row mt-3">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`ml-chip${activePreset === preset.id ? " is-active" : ""}`}
                    title={preset.hint}
                    onClick={() => {
                      setTechnicalEnabled(false);
                      setFilters({ ...emptyFilters, ...preset.filters });
                      setActivePreset(preset.id);
                      setSaveStatus(null);
                      void run(preset.filters);
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <form
                className="mt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run();
                }}
              >
                <fieldset className="ml-filter-group">
                  <legend>Universe</legend>
                  <div className="ml-filter-grid">
                    <div className="is-full">
                      <Input
                        label="Symbol or company"
                        placeholder="e.g. BANK"
                        value={filters.search ?? ""}
                        onChange={(value) => update("search", value || undefined)}
                      />
                    </div>
                    <Select
                      label="Exchange"
                      value={filters.exchange ?? "ALL"}
                      onSelect={(value) => update("exchange", value as Exchange | "ALL")}
                      options={EXCHANGE_OPTIONS}
                    />
                    <Select
                      label="Instrument type"
                      value={filters.instrumentType ?? "ALL"}
                      onSelect={(value) =>
                        update("instrumentType", value as InstrumentType | "ALL")
                      }
                      options={TYPE_OPTIONS}
                    />
                  </div>
                </fieldset>

                <fieldset className="ml-filter-group">
                  <legend>Price &amp; movement</legend>
                  <div className="ml-filter-grid">
                    <Input
                      label="Min price (₹)"
                      value={filters.minPrice !== undefined ? String(filters.minPrice) : ""}
                      onChange={(value) => update("minPrice", toNumber(value))}
                    />
                    <Input
                      label="Max price (₹)"
                      value={filters.maxPrice !== undefined ? String(filters.maxPrice) : ""}
                      onChange={(value) => update("maxPrice", toNumber(value))}
                    />
                    <Input
                      label="Min change %"
                      value={
                        filters.minChangePercent !== undefined
                          ? String(filters.minChangePercent)
                          : ""
                      }
                      onChange={(value) => update("minChangePercent", toNumber(value))}
                    />
                    <Input
                      label="Max change %"
                      value={
                        filters.maxChangePercent !== undefined
                          ? String(filters.maxChangePercent)
                          : ""
                      }
                      onChange={(value) => update("maxChangePercent", toNumber(value))}
                    />
                  </div>
                </fieldset>

                <fieldset className="ml-filter-group">
                  <legend>Liquidity &amp; size</legend>
                  <div className="ml-filter-grid">
                    <div className="is-full">
                      <Input
                        label="Min volume"
                        value={filters.minVolume !== undefined ? String(filters.minVolume) : ""}
                        onChange={(value) => update("minVolume", toNumber(value))}
                      />
                    </div>
                    <Input
                      label="Min P/E"
                      value={filters.minPe !== undefined ? String(filters.minPe) : ""}
                      onChange={(value) => update("minPe", toNumber(value))}
                    />
                    <Input
                      label="Max P/E"
                      value={filters.maxPe !== undefined ? String(filters.maxPe) : ""}
                      onChange={(value) => update("maxPe", toNumber(value))}
                    />
                    <Input
                      label="Min mkt cap (₹ Cr)"
                      value={
                        filters.minMarketCapCrore !== undefined
                          ? String(filters.minMarketCapCrore)
                          : ""
                      }
                      onChange={(value) => update("minMarketCapCrore", toNumber(value))}
                    />
                    <Input
                      label="Max mkt cap (₹ Cr)"
                      value={
                        filters.maxMarketCapCrore !== undefined
                          ? String(filters.maxMarketCapCrore)
                          : ""
                      }
                      onChange={(value) => update("maxMarketCapCrore", toNumber(value))}
                    />
                  </div>
                  <p className="ml-metric__hint mt-2">
                    P/E and market cap only match instruments with stored fundamentals.
                  </p>
                </fieldset>

                <fieldset className="ml-filter-group">
                  <legend>Technical &amp; data</legend>
                  <label className="ml-switch">
                    <input
                      type="checkbox"
                      checked={technicalEnabled}
                      onChange={(event) => setTechnicalEnabled(event.target.checked)}
                    />
                    <span>
                      Technical filter
                      <span className="ml-metric__hint">Uses locally stored candles only.</span>
                    </span>
                  </label>

                  {technicalEnabled && (
                    <div className="ml-filter-grid mt-2">
                      <Select
                        label="Indicator"
                        value={technicalIndicator}
                        onSelect={(value) =>
                          setTechnicalIndicator(value as "RSI" | "PRICE_VS_SMA")
                        }
                        options={[
                          { value: "RSI", label: "RSI" },
                          { value: "PRICE_VS_SMA", label: "Price vs SMA (%)" },
                        ]}
                      />
                      <Input
                        label="Period"
                        value={technicalPeriod}
                        onChange={setTechnicalPeriod}
                      />
                      <div className="is-full">
                        <Select
                          label="Interval"
                          value={technicalInterval}
                          onSelect={(value) => setTechnicalInterval(value as Interval)}
                          options={INTERVALS.map((value) => ({
                            value,
                            label: INTERVAL_LABEL[value],
                          }))}
                        />
                      </div>
                      <Input label="Minimum" value={technicalMin} onChange={setTechnicalMin} />
                      <Input label="Maximum" value={technicalMax} onChange={setTechnicalMax} />
                    </div>
                  )}

                  <label className="ml-switch mt-3">
                    <input
                      type="checkbox"
                      checked={excludeSample}
                      onChange={(event) => setExcludeSample(event.target.checked)}
                    />
                    <span>
                      Hide SAMPLE rows
                      <span className="ml-metric__hint">
                        Drops any row whose price or technical value would come from the synthetic
                        series.
                      </span>
                    </span>
                  </label>
                </fieldset>

                <fieldset className="ml-filter-group">
                  <legend>Result size</legend>
                  <div className="ml-filter-grid">
                    <div className="is-full">
                      <Input
                        label="Maximum rows"
                        value={filters.limit !== undefined ? String(filters.limit) : ""}
                        onChange={(value) => update("limit", toNumber(value))}
                      />
                    </div>
                  </div>
                </fieldset>

                <div className="ml-filter-panel__foot">
                  <Button type="submit" disabled={running || !isAuthenticated}>
                    {running ? "Screening…" : "Run screen"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={resetFilters}
                    disabled={running || (!isAuthenticated && activeChips.length === 0)}
                  >
                    <RotateCcw size={13} aria-hidden="true" />
                    Reset
                  </Button>
                </div>
              </form>
            </div>
          </Card>
        </div>

        <div className="ml-screener__main">
          <Card>
            <SectionHeader
              title="Results"
              description={
                result
                  ? `${result.matched} of ${result.evaluated} evaluated instruments${
                      result.asOf ? ` · as of ${new Date(result.asOf).toLocaleString("en-IN")}` : ""
                    }`
                  : "Run a screen to see results."
              }
              actions={
                hasRows ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="w-40">
                      <Select
                        label="Sort by"
                        value={sort.key}
                        onSelect={(value) => setSort({ key: value as SortKey, dir: sort.dir })}
                        options={SORT_OPTIONS}
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        setSort((current) => ({ ...current, dir: current.dir === 1 ? -1 : 1 }))
                      }
                      aria-label={`Sort ${sort.dir === 1 ? "descending" : "ascending"}`}
                    >
                      {sort.dir === 1 ? "Asc ↑" : "Desc ↓"}
                    </Button>
                  </div>
                ) : null
              }
            />

            {result?.note && (
              <p className="ml-detail-note ml-detail-note--warn mt-3">{result.note}</p>
            )}
            {result?.excludedNote && <p className="ml-detail-note mt-2">{result.excludedNote}</p>}
            {result && result.rows.length > 0 && result.rows.every((row) => row.eod) && (
              <p className="ml-detail-note mt-2">
                Every price here is an end-of-day close (latest session {result.rows[0].quoteDate}) —
                not an intraday or live quote.
              </p>
            )}
            {(result?.skippedNoQuote ?? 0) > 0 && (
              <p className="ml-detail-note mt-2">
                {result?.skippedNoQuote} instruments skipped for missing quotes.
              </p>
            )}
            {(result?.skippedNoHistory ?? 0) > 0 && (
              <p className="ml-detail-note mt-2">
                {result?.skippedNoHistory} instruments skipped for missing candle history.
              </p>
            )}
            {(result?.samplePriced ?? 0) > 0 && (
              <p className="ml-detail-note ml-detail-note--warn mt-2">
                {result?.samplePriced} row{result?.samplePriced === 1 ? "" : "s"} priced from the
                deterministic SAMPLE series — no provider quote is stored for those instruments.
              </p>
            )}

            <div className="mt-3">
              {running ? (
                <div className="flex flex-col gap-2" aria-busy="true" data-testid="screener-loading">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <span key={index} className="skeleton" style={{ height: 30 }} />
                  ))}
                </div>
              ) : error ? (
                <div className="ml-empty-block" role="alert">
                  <p className="ml-empty-block__title">The screen could not run</p>
                  <p className="ml-empty-block__body">{error}</p>
                  <Button variant="secondary" size="sm" onClick={() => void run()}>
                    Try again
                  </Button>
                </div>
              ) : !result ? (
                <EmptyState
                  icon={<SlidersHorizontal size={18} aria-hidden="true" />}
                  title="No screen has run yet"
                  description="Set the filters on the left — or start from a preset — then run the screen."
                  action={
                    <Button variant="primary" size="sm" onClick={() => void run()} disabled={!isAuthenticated}>
                      Run screen
                    </Button>
                  }
                />
              ) : result.rows.length === 0 ? (
                <EmptyState
                  icon={<SearchX size={18} aria-hidden="true" />}
                  title="No instruments matched"
                  description="Loosen the filters. Screens run on stored quotes, so you can also load quotes on the Markets page or import candle history first."
                  action={
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                      Reset filters
                    </Button>
                  }
                />
              ) : (
                <div className="ml-table-scroll">
                  <table className="ml-data-table" data-testid="screener-table">
                    <thead>
                      <tr>
                        <th scope="col">
                          <button type="button" onClick={() => toggleSort("symbol")}>
                            Instrument <span aria-hidden="true">{sortMark("symbol")}</span>
                          </button>
                        </th>
                        <th scope="col">Exchange</th>
                        <th scope="col" className="is-right">
                          <button type="button" onClick={() => toggleSort("price")}>
                            Price <span aria-hidden="true">{sortMark("price")}</span>
                          </button>
                        </th>
                        <th scope="col" className="is-right">
                          <button type="button" onClick={() => toggleSort("change")}>
                            Change <span aria-hidden="true">{sortMark("change")}</span>
                          </button>
                        </th>
                        <th scope="col" className="is-right ml-cell-hide-sm">
                          <button type="button" onClick={() => toggleSort("volume")}>
                            Volume <span aria-hidden="true">{sortMark("volume")}</span>
                          </button>
                        </th>
                        <th scope="col" className="is-right">
                          <button type="button" onClick={() => toggleSort("pe")}>
                            P/E <span aria-hidden="true">{sortMark("pe")}</span>
                          </button>
                        </th>
                        <th scope="col" className="is-right ml-cell-hide-sm">
                          <button type="button" onClick={() => toggleSort("marketCap")}>
                            Mkt cap <span aria-hidden="true">{sortMark("marketCap")}</span>
                          </button>
                        </th>
                        <th scope="col" className="is-right">
                          <button type="button" onClick={() => toggleSort("technical")}>
                            Technical <span aria-hidden="true">{sortMark("technical")}</span>
                          </button>
                        </th>
                        <th scope="col">Data</th>
                        <th scope="col">
                          <span className="sr-only">Details</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedRows.map((row) => (
                        <tr key={row.instrumentId}>
                          <td>
                            <span className="ml-data-table__instrument">
                              <button
                                type="button"
                                className="ml-data-table__symbol"
                                onClick={() => onOpenInstrument(row.instrumentId)}
                              >
                                {row.symbol}
                              </button>
                              <span className="ml-data-table__name" title={row.name}>
                                {row.name}
                              </span>
                            </span>
                          </td>
                          <td>
                            <span className="ml-data-table__exchange">{row.exchange}</span>
                          </td>
                          <td className="is-right is-num">
                            {row.hasQuote ? formatPrice(row.lastPrice) : "—"}
                          </td>
                          <td className={`is-right is-num ${toneClass(row.changePercent)}`}>
                            {formatPercent(row.changePercent)}
                          </td>
                          <td className="is-right is-num ml-cell-hide-sm">
                            {formatVolume(row.volume)}
                          </td>
                          <td className="is-right is-num">{row.peTtm ?? "—"}</td>
                          <td className="is-right is-num ml-cell-hide-sm">
                            {formatMarketCapCrore(row.marketCapCrore)}
                          </td>
                          <td className="is-right is-num">
                            {row.technicalValue === null
                              ? "—"
                              : row.technicalValue.toFixed(2)}
                            {row.technicalNote ? (
                              <span className="ml-data-table__name">{row.technicalNote}</span>
                            ) : null}
                          </td>
                          <td>
                            <span className="flex flex-col gap-1">
                              <DataModeBadge mode={row.mode} source={row.source} />
                              <span className="text-[10px] text-[var(--text-3)]">
                                {row.quoteDate ?? "—"}
                                {row.eod ? " · EOD" : ""}
                              </span>
                            </span>
                          </td>
                          <td className="is-right">
                            <button
                              type="button"
                              className="ml-data-table__action"
                              onClick={() => onOpenInstrument(row.instrumentId)}
                              aria-label={`Open ${row.symbol} details`}
                            >
                              <ArrowUpRight size={13} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Card>

          {isAuthenticated && (
            <Card className="mt-4">
              <SectionHeader
                title="Saved screens"
                description="Configurations are stored per account and re-run with the filters you saved."
              />
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <Input label="Screen name" placeholder="e.g. Liquid gainers" value={saveName} onChange={setSaveName} />
                </div>
                <Button variant="secondary" size="sm" onClick={() => void save()}>
                  Save current filters
                </Button>
              </div>
              {saveStatus && (
                <p role="status" className="ml-metric__hint mt-2">
                  {saveStatus}
                </p>
              )}
              {saved && saved.length === 0 && (
                <p className="ml-empty-block__body mt-3">No saved screens yet.</p>
              )}
              <ul className="mt-3 space-y-2">
                {(saved ?? []).map((screen) => (
                  <li key={screen._id} className="ml-saved-screen">
                    <span className="min-w-0">
                      <span className="ml-data-table__symbol">{screen.name}</span>
                      <span className="ml-data-table__name">
                        {screen.lastResultCount} matches
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <button
                        type="button"
                        className="ml-row-action"
                        onClick={() => loadSaved(screen.filtersJson)}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="ml-row-action"
                        onClick={() => {
                          const next = prompt("Rename screen", screen.name);
                          if (next && next.trim()) {
                            void renameScreener({ id: screen._id, name: next.trim() });
                          }
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="ml-row-action is-danger"
                        onClick={() => {
                          if (confirm(`Delete screen "${screen.name}"?`)) {
                            void removeScreener({ id: screen._id });
                          }
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};

/* Backend-gated: server-side filtering and saved configurations need Convex. */
const Screener: React.FC<ScreenerProps> = ({ onOpenInstrument }) => {
  const { backendOnline } = useRootContext();
  if (!backendOnline) {
    return (
      <BackendRequired
        feature="Stock Screener"
        description="Quote, fundamentals and technical filters run on the server and saved screens belong to your account."
      />
    );
  }
  return <ScreenerLive onOpenInstrument={onOpenInstrument} />;
};

export default Screener;
