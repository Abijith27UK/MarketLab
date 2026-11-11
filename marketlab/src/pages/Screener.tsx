import React, { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRootContext } from "@/context/RootContext";
import { Card, Button, Input, Select } from "@/components/ui";
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
} from "@/lib/marketClient";
import { formatMarketCapCrore, formatPercent, formatPrice, formatVolume, toneClass } from "@/lib/format";

interface ScreenerProps {
  onOpenInstrument: (instrumentId: string) => void;
}

const emptyFilters: ScreenerFilters = {
  exchange: "ALL",
  instrumentType: "ALL",
  limit: 50,
};

const toNumber = (value: string): number | undefined => {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

const ScreenerLive: React.FC<ScreenerProps> = ({ onOpenInstrument }) => {
  const { isAuthenticated } = useRootContext();
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

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Stock Screener</h1>
        <p className="text-gray-400">
          Screens run on the market data MarketLab has stored — quotes, fundamentals and any candle
          history you have imported. No provider quota is consumed per row.
        </p>
      </header>

      {!isAuthenticated && (
        <Card className="mb-6">
          <p className="text-sm text-gray-300">Sign in to run the screener and save configurations.</p>
        </Card>
      )}

      <Card className="mb-6">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">Presets</h2>
            <p className="ml-section-sub">
              Pre-fill a validated filter set, then adjust it. Each preset runs immediately.
            </p>
          </div>
        </div>
        <div className="ml-filter-row">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`ml-row-action${activePreset === preset.id ? " is-active" : ""}`}
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
          {activePreset && (
            <button
              type="button"
              className="ml-row-action"
              onClick={() => {
                setFilters(emptyFilters);
                setActivePreset(null);
                void run(emptyFilters);
              }}
            >
              Clear preset
            </button>
          )}
        </div>
      </Card>

      <Card className="mb-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Input
            label="Symbol or company"
            placeholder="e.g. BANK"
            value={filters.search ?? ""}
            onChange={(value) => update("search", value)}
          />
          <Select
            label="Exchange"
            value={filters.exchange ?? "ALL"}
            onSelect={(value) => update("exchange", value as Exchange | "ALL")}
            options={[
              { value: "ALL", label: "All exchanges" },
              { value: "NSE", label: "NSE" },
              { value: "BSE", label: "BSE" },
            ]}
          />
          <Select
            label="Instrument type"
            value={filters.instrumentType ?? "ALL"}
            onSelect={(value) => update("instrumentType", value as InstrumentType | "ALL")}
            options={[
              { value: "ALL", label: "All types" },
              { value: "EQUITY", label: "Equity" },
              { value: "ETF", label: "ETF" },
              { value: "INDEX", label: "Index" },
            ]}
          />
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
            label="Min volume"
            value={filters.minVolume !== undefined ? String(filters.minVolume) : ""}
            onChange={(value) => update("minVolume", toNumber(value))}
          />
          <Input
            label="Min change %"
            value={filters.minChangePercent !== undefined ? String(filters.minChangePercent) : ""}
            onChange={(value) => update("minChangePercent", toNumber(value))}
          />
          <Input
            label="Max change %"
            value={filters.maxChangePercent !== undefined ? String(filters.maxChangePercent) : ""}
            onChange={(value) => update("maxChangePercent", toNumber(value))}
          />
          <Input
            label="Result limit"
            value={filters.limit !== undefined ? String(filters.limit) : "50"}
            onChange={(value) => update("limit", toNumber(value))}
          />
          <Input
            label="Min P/E (needs fundamentals)"
            value={filters.minPe !== undefined ? String(filters.minPe) : ""}
            onChange={(value) => update("minPe", toNumber(value))}
          />
          <Input
            label="Max P/E (needs fundamentals)"
            value={filters.maxPe !== undefined ? String(filters.maxPe) : ""}
            onChange={(value) => update("maxPe", toNumber(value))}
          />
          <Input
            label="Min market cap (₹ Cr)"
            value={
              filters.minMarketCapCrore !== undefined ? String(filters.minMarketCapCrore) : ""
            }
            onChange={(value) => update("minMarketCapCrore", toNumber(value))}
          />
        </div>

        <div className="mt-4 rounded border border-gray-800 p-3">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={technicalEnabled}
              onChange={(event) => setTechnicalEnabled(event.target.checked)}
            />
            Technical filter (uses locally stored candles only)
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={excludeSample}
              onChange={(event) => setExcludeSample(event.target.checked)}
            />
            <span>
              Hide SAMPLE rows (real data only)
              <span className="ml-1 block text-[11px] text-gray-500">
                Drops any row whose price or technical value would come from the synthetic series.
              </span>
            </span>
          </label>
          {technicalEnabled && (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
              <Select
                label="Indicator"
                value={technicalIndicator}
                onSelect={(value) => setTechnicalIndicator(value as "RSI" | "PRICE_VS_SMA")}
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
              <Select
                label="Interval"
                value={technicalInterval}
                onSelect={(value) => setTechnicalInterval(value as Interval)}
                options={INTERVALS.map((value) => ({
                  value,
                  label: INTERVAL_LABEL[value],
                }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <Input label="Min" value={technicalMin} onChange={setTechnicalMin} />
                <Input label="Max" value={technicalMax} onChange={setTechnicalMax} />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => void run()} disabled={running || !isAuthenticated}>
            {running ? "Screening…" : "Run screen"}
          </Button>
          {availability && (
            <span className="text-xs text-gray-500">
              {availability.quoteFields ? "Quote filters ready" : "No stored quotes yet"} ·{" "}
              {availability.fundamentalFields ? "fundamentals available" : "no fundamentals"} ·{" "}
              {availability.technicalFields ? "candle history available" : "no candle history"}
            </span>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
      </Card>

      {isAuthenticated && (
        <Card className="mb-6">
          <h2 className="mb-3 text-lg font-semibold">Saved screens</h2>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-48 flex-1">
              <Input placeholder="Screen name" value={saveName} onChange={setSaveName} />
            </div>
            <Button variant="secondary" onClick={() => void save()}>
              Save current filters
            </Button>
          </div>
          {saveStatus && <p className="mt-2 text-xs text-emerald-400">{saveStatus}</p>}
          {saved && saved.length === 0 && (
            <p className="mt-3 text-sm text-gray-500">No saved screens yet.</p>
          )}
          <ul className="mt-3 space-y-2">
            {(saved ?? []).map((screen) => (
              <li
                key={screen._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-800 px-3 py-2 text-sm"
              >
                <span>
                  {screen.name}{" "}
                  <span className="text-xs text-gray-500">{screen.lastResultCount} matches</span>
                </span>
                <span className="flex gap-3 text-xs">
                  <button
                    className="text-emerald-400 hover:text-emerald-300"
                    onClick={() => loadSaved(screen.filtersJson)}
                  >
                    Load
                  </button>
                  <button
                    className="text-gray-300 hover:text-white"
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
                    className="text-red-400 hover:text-red-300"
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

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Results</h2>
          {result && (
            <span className="flex items-center gap-2 text-xs text-gray-500">
              {result.matched} of {result.evaluated} evaluated
              <DataModeBadge mode={result.mode} />
            </span>
          )}
        </div>

        {result?.note && <p className="mb-3 text-xs text-amber-400/80">{result.note}</p>}
        {result?.excludedNote && (
          <p className="mb-3 text-xs text-gray-500">{result.excludedNote}</p>
        )}
        {result && result.rows.length > 0 && result.rows.every((row) => row.eod) && (
          <p className="mb-3 text-xs text-gray-500">
            Every price here is an end-of-day close (latest session {result.rows[0].quoteDate}) —
            not an intraday or live quote.
          </p>
        )}
        {(result?.skippedNoQuote ?? 0) > 0 && (
          <p className="mb-3 text-xs text-gray-500">
            {result?.skippedNoQuote} instruments skipped for missing quotes.
          </p>
        )}
        {(result?.samplePriced ?? 0) > 0 && (
          <p className="mb-3 text-xs text-amber-400/80">
            {result?.samplePriced} row{result?.samplePriced === 1 ? "" : "s"} priced from the
            deterministic SAMPLE series — no provider quote is stored for those instruments.
          </p>
        )}
        {(result?.skippedNoHistory ?? 0) > 0 && (
          <p className="mb-3 text-xs text-gray-500">
            {result?.skippedNoHistory} instruments skipped for missing candle history.
          </p>
        )}

        {!result && <p className="text-sm text-gray-500">Run a screen to see results.</p>}

        {result && result.rows.length === 0 && (
          <p className="text-sm text-gray-500">
            No instruments matched. Loosen the filters. Screens run on stored quotes, so you can also
            load quotes on the Markets page or import candle history first.
          </p>
        )}

        {result && result.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="ml-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th className="is-right">LTP</th>
                  <th className="is-right">Change</th>
                  <th className="is-right">Volume</th>
                  <th className="is-right">P/E</th>
                  <th className="is-right">Mkt cap</th>
                  <th className="is-right">Technical</th>
                  <th>Data</th>
                  <th>Session</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.instrumentId}>
                    <td>
                      <button
                        className="font-medium text-gray-100 hover:text-emerald-300"
                        onClick={() => onOpenInstrument(row.instrumentId)}
                      >
                        {row.symbol}
                      </button>
                    </td>
                    <td className="max-w-56 truncate">{row.name}</td>
                    <td className="is-right ml-mono">{formatPrice(row.lastPrice)}</td>
                    <td className={`is-right ml-mono ${toneClass(row.changePercent)}`}>
                      {formatPercent(row.changePercent)}
                    </td>
                    <td className="is-right ml-mono">{formatVolume(row.volume)}</td>
                    <td className="is-right ml-mono">{row.peTtm ?? "—"}</td>
                    <td className="is-right ml-mono">{formatMarketCapCrore(row.marketCapCrore)}</td>
                    <td className="is-right ml-mono">
                      {row.technicalValue === null
                        ? "—"
                        : `${row.technicalValue.toFixed(2)}${row.technicalNote ? ` ${row.technicalNote}` : ""}`}
                    </td>
                    <td>
                      <DataModeBadge mode={row.mode} source={row.source} />
                    </td>
                    <td className="whitespace-nowrap text-xs text-gray-500">
                      {row.quoteDate ?? "—"}
                      {row.eod ? " · EOD close" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
