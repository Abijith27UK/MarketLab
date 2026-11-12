import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, SearchX, RotateCw } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Button, Card, EmptyState, Input, Select, SectionHeader } from "@/components/ui";
import DataModeBadge from "@/components/market/DataModeBadge";
import DataFreshnessBadge from "@/components/market/DataFreshnessBadge";
import FinancialValue from "@/components/market/FinancialValue";
import MarketStatusBadge from "@/components/market/MarketStatusBadge";
import PriceChange from "@/components/market/PriceChange";
import StockCard from "@/components/market/StockCard";
import { DEMO_INSTRUMENTS } from "@/lib/demoCatalogue";
import { modelFromDemo, modelFromQuote } from "@/lib/stockModels";
import { useQuotes } from "@/hooks/useQuotes";
import {
  marketApi,
  type Exchange,
  type InstrumentRow,
  type InstrumentType,
} from "@/lib/marketClient";
import { formatAge, formatVolume } from "@/lib/format";

interface MarketsProps {
  onOpenInstrument: (instrumentId: string) => void;
}

type SortKey = "symbol" | "price" | "change" | "volume";

const instrumentIdOf = (row: InstrumentRow) =>
  row.instrumentId ?? `${row.exchange}:${row.symbol}:${row.instrumentType}`;

const PAGE_SIZE = 25;

const SORT_OPTIONS = [
  { value: "symbol", label: "Symbol (A–Z)" },
  { value: "price", label: "Last price" },
  { value: "change", label: "Change %" },
  { value: "volume", label: "Volume" },
];

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
  { value: "OTHER", label: "Other" },
];

/** Screen-reader friendly narrow-viewport probe; the table needs ~760px. */
const NARROW_QUERY = "(max-width: 899px)";

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

/* ------------------------------------------------------------------- live */

const MarketsLive: React.FC<MarketsProps> = ({ onOpenInstrument }) => {
  const { isAuthenticated } = useRootContext();
  const narrow = useNarrow();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [exchange, setExchange] = useState<Exchange | "ALL">("ALL");
  const [instrumentType, setInstrumentType] = useState<InstrumentType | "ALL">("ALL");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "symbol", dir: 1 });
  const [targetWatchlistId, setTargetWatchlistId] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pendingSymbol, setPendingSymbol] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setCursor(null);
    setCursorStack([]);
  }, [debounced, exchange, instrumentType]);

  const result = useQuery(marketApi.searchInstruments, {
    search: debounced,
    exchange,
    instrumentType,
    limit: PAGE_SIZE,
    cursor,
  });
  const stats = useQuery(marketApi.catalogueStats, {});
  const session = useQuery(marketApi.marketStatus, {});
  const watchlists = useQuery(api.watchlists.list, {});
  const addItem = useMutation(api.watchlists.addItem);

  const rows = result?.items ?? [];
  const ids = useMemo(() => rows.map(instrumentIdOf), [rows]);
  const { data: quoteData, loading: quotesLoading, refreshing, refresh } = useQuotes(ids);

  const quoteById = useMemo(
    () => new Map((quoteData?.quotes ?? []).map((quote) => [quote.instrumentId, quote])),
    [quoteData]
  );

  // Freshness labels are relative, so stamp "now" whenever a new quote payload lands.
  useEffect(() => {
    if (!quoteData) return;
    setNow(Date.now());
  }, [quoteData]);

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const quoteA = quoteById.get(instrumentIdOf(a));
      const quoteB = quoteById.get(instrumentIdOf(b));
      switch (sort.key) {
        case "price":
          return ((quoteA?.lastPrice ?? -Infinity) - (quoteB?.lastPrice ?? -Infinity)) * sort.dir;
        case "change":
          return (
            ((quoteA?.changePercent ?? -Infinity) - (quoteB?.changePercent ?? -Infinity)) * sort.dir
          );
        case "volume":
          return ((quoteA?.volume ?? -Infinity) - (quoteB?.volume ?? -Infinity)) * sort.dir;
        default:
          return a.symbol.localeCompare(b.symbol) * sort.dir;
      }
    });
    return list;
  }, [rows, quoteById, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: 1 }
    );

  const hasFilters = search.trim() !== "" || exchange !== "ALL" || instrumentType !== "ALL";

  const clearFilters = () => {
    setSearch("");
    setExchange("ALL");
    setInstrumentType("ALL");
    setSort({ key: "symbol", dir: 1 });
  };

  const handleAdd = async (row: InstrumentRow) => {
    if (!targetWatchlistId) {
      setStatus({ kind: "error", text: "Select a watchlist first." });
      return;
    }
    setStatus(null);
    setPendingSymbol(instrumentIdOf(row));
    try {
      await addItem({
        watchlistId: targetWatchlistId as never,
        instrumentId: instrumentIdOf(row),
      });
      setStatus({ kind: "ok", text: `${row.symbol} added to your watchlist.` });
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof Error ? error.message : "Could not add instrument.",
      });
    } finally {
      setPendingSymbol(null);
    }
  };

  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : null);

  const showWatchlistPicker = isAuthenticated && (watchlists?.length ?? 0) > 0;

  return (
    <div className="p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="ml-page-title">Markets</h1>
          <p className="ml-page-sub">
            Search the NSE and BSE instrument master, compare the latest available quote and open any
            instrument for its full chart.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {session ? <MarketStatusBadge label={session.label} /> : null}
          {session?.istTime ? (
            <span className="ml-mono text-[11px] text-[var(--text-3)]">{session.istTime} IST</span>
          ) : null}
          {quoteData ? <DataModeBadge mode={quoteData.mode} source={quoteData.source} /> : null}
        </div>
      </header>

      {session && !session.holidaysConfigured && (
        <p className="ml-detail-note ml-detail-note--warn mb-4">
          Session hours come from IST exchange timings. The exchange holiday calendar is not
          configured in this deployment, so holidays are not excluded.
        </p>
      )}

      <Card className="mb-4">
        <div className="ml-toolbar">
          <div className="ml-toolbar__field">
            <Input
              label="Search by symbol or company"
              placeholder="e.g. RELIANCE, Infosys"
              value={search}
              onChange={setSearch}
            />
          </div>
          <div className="ml-toolbar__field">
            <Select
              label="Exchange"
              value={exchange}
              onSelect={(value) => setExchange(value as Exchange | "ALL")}
              options={EXCHANGE_OPTIONS}
            />
          </div>
          <div className="ml-toolbar__field">
            <Select
              label="Instrument type"
              value={instrumentType}
              onSelect={(value) => setInstrumentType(value as InstrumentType | "ALL")}
              options={TYPE_OPTIONS}
            />
          </div>
          <div className="ml-toolbar__field">
            <Select
              label="Sort by"
              value={sort.key}
              onSelect={(value) => setSort({ key: value as SortKey, dir: sort.dir })}
              options={SORT_OPTIONS}
            />
          </div>
          <div className="ml-toolbar__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSort((current) => ({ ...current, dir: current.dir === 1 ? -1 : 1 }))}
              aria-label={`Sort ${sort.dir === 1 ? "descending" : "ascending"}`}
            >
              {sort.dir === 1 ? "Asc ↑" : "Desc ↓"}
            </Button>
            <Button variant="secondary" size="sm" onClick={clearFilters} disabled={!hasFilters}>
              Clear filters
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
              disabled={refreshing || ids.length === 0}
            >
              <RotateCw size={13} className={refreshing ? "ml-spin" : undefined} aria-hidden="true" />
              {refreshing ? "Refreshing…" : "Refresh quotes"}
            </Button>
            {showWatchlistPicker && (
              <div className="w-52">
                <Select
                  label="Add to watchlist"
                  value={targetWatchlistId}
                  onSelect={setTargetWatchlistId}
                  options={(watchlists ?? []).map((wl) => ({ value: wl._id, label: wl.name }))}
                  placeholder="Select watchlist"
                />
              </div>
            )}
          </div>
          <p className="text-[11px] text-[var(--text-3)]">
            {stats
              ? `${stats.total} instruments · ${stats.provider} from a provider · ${stats.sample} sample`
              : "Catalogue statistics unavailable"}
          </p>
        </div>

        {quoteData?.note && <p className="ml-detail-note ml-detail-note--warn mt-3">{quoteData.note}</p>}
        {quoteData?.warning && (
          <p role="alert" className="ml-detail-note ml-detail-note--warn mt-3">
            {quoteData.warning}
          </p>
        )}
        {status && (
          <p
            role={status.kind === "error" ? "alert" : "status"}
            className={`mt-3 text-xs ${status.kind === "error" ? "text-[var(--neg)]" : "text-[var(--pos)]"}`}
          >
            {status.text}
          </p>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Instruments"
          description={
            result
              ? `${rows.length} on this page · ${result.mode === "search" ? "matching your search" : "catalogue order"}`
              : "Loading the instrument master…"
          }
          actions={
            rows.length > 0 ? (
              <span className="flex items-center gap-2 text-[11px] text-[var(--text-3)]">
                {quotesLoading
                  ? "Fetching quotes…"
                  : quoteData?.quoteAsOf
                    ? `Provider quote ${formatAge(quoteData.quoteAsOf, now)}`
                    : "No provider quote timestamp"}
              </span>
            ) : null
          }
        />

        {result === undefined && (
          <div className="ml-data-table-wrap mt-3" aria-hidden="true">
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 8 }).map((_, index) => (
                <span key={index} className="skeleton" style={{ height: 34 }} />
              ))}
            </div>
          </div>
        )}

        {result && rows.length === 0 && (
          <div className="py-4">
            <EmptyState
              icon={<SearchX size={18} aria-hidden="true" />}
              title={hasFilters ? "No instruments match these filters" : "The catalogue is empty"}
              description={
                stats && stats.provider === 0
                  ? "Only the sample catalogue is loaded. Sync the instrument master from the Data Sources page."
                  : "Try a different symbol, or clear the filters to browse the full catalogue."
              }
              action={
                hasFilters ? (
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          </div>
        )}

        {rows.length > 0 && narrow && (
          <div className="ml-stock-grid mt-3">
            {sortedRows.map((row) => {
              const id = instrumentIdOf(row);
              const quote = quoteById.get(id);
              return (
                <StockCard
                  key={row._id}
                  model={modelFromQuote({ ...row, instrumentId: id }, quote ?? null)}
                  onOpen={onOpenInstrument}
                  now={now}
                />
              );
            })}
          </div>
        )}

        {rows.length > 0 && !narrow && (
          <div className="ml-data-table-wrap mt-3">
            <table className="ml-data-table">
              <thead>
                <tr>
                  <th scope="col">
                    <button type="button" onClick={() => toggleSort("symbol")}>
                      Instrument <span aria-hidden="true">{sortMark("symbol")}</span>
                    </button>
                  </th>
                  <th scope="col">Exchange</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="is-right">
                    <button type="button" onClick={() => toggleSort("price")}>
                      Last price <span aria-hidden="true">{sortMark("price")}</span>
                    </button>
                  </th>
                  <th scope="col" className="is-right">
                    <button type="button" onClick={() => toggleSort("change")}>
                      Change <span aria-hidden="true">{sortMark("change")}</span>
                    </button>
                  </th>
                  <th scope="col" className="is-right">
                    <button type="button" onClick={() => toggleSort("volume")}>
                      Volume <span aria-hidden="true">{sortMark("volume")}</span>
                    </button>
                  </th>
                  <th scope="col">Data</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const id = instrumentIdOf(row);
                  const quote = quoteById.get(id);
                  return (
                    <tr key={row._id}>
                      <td>
                        <span className="ml-data-table__instrument">
                          <button
                            type="button"
                            className="ml-data-table__symbol"
                            onClick={() => onOpenInstrument(id)}
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
                      <td className="text-[11px] uppercase tracking-wide text-[var(--text-3)]">
                        {row.instrumentType}
                      </td>
                      <td className="is-right is-num">
                        {quotesLoading && !quote ? (
                          <span className="skeleton" style={{ display: "inline-block", height: 12, width: 56 }} />
                        ) : (
                          <FinancialValue value={quote?.lastPrice} size="sm" />
                        )}
                      </td>
                      <td className="is-right">
                        {quote ? (
                          <PriceChange
                            change={quote.change}
                            changePercent={quote.changePercent}
                            showAbsolute={false}
                          />
                        ) : (
                          <span className="text-[11px] text-[var(--text-3)]">No quote</span>
                        )}
                      </td>
                      <td className="is-right is-num text-[11px] text-[var(--text-3)]">
                        {formatVolume(quote?.volume)}
                      </td>
                      <td>
                        {quote ? (
                          <DataFreshnessBadge
                            mode={quote.mode}
                            source={quote.source}
                            asOf={quote.quoteTime}
                            now={now}
                          />
                        ) : (
                          <span className="text-[11px] text-[var(--text-3)]">Unavailable</span>
                        )}
                      </td>
                      <td className="is-right">
                        <div className="flex items-center justify-end gap-3">
                          {showWatchlistPicker && (
                            <button
                              type="button"
                              className="ml-data-table__action text-[var(--text-3)] disabled:opacity-40"
                              disabled={pendingSymbol === id || !targetWatchlistId}
                              onClick={() => void handleAdd(row)}
                            >
                              Add
                            </button>
                          )}
                          <button
                            type="button"
                            className="ml-data-table__action"
                            onClick={() => onOpenInstrument(id)}
                            aria-label={`Open ${row.symbol}`}
                          >
                            Details <ArrowRight size={12} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={cursorStack.length === 0}
            onClick={() => {
              const next = [...cursorStack];
              const previous = next.pop() ?? null;
              setCursorStack(next);
              setCursor(previous);
            }}
          >
            Previous
          </Button>
          <span className="text-[11px] text-[var(--text-3)]">
            {result?.mode === "search"
              ? "Search results"
              : result?.isDone
                ? "End of catalogue"
                : `Up to ${PAGE_SIZE} per page`}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!result || result.isDone || !result.nextCursor}
            onClick={() => {
              if (!result?.nextCursor) return;
              setCursorStack([...cursorStack, cursor ?? ""]);
              setCursor(result.nextCursor);
            }}
          >
            Next
          </Button>
        </div>
      </Card>
    </div>
  );
};

/* -------------------------------------------------------------------- demo */

/**
 * Offline explorer: filters the deterministic sample catalogue in the browser.
 * Same cards and click-through as the live explorer, always labelled SAMPLE.
 */
export const MarketsDemo: React.FC<MarketsProps> = ({ onOpenInstrument }) => {
  const now = useMemo(() => Date.now(), []);
  const [search, setSearch] = useState("");
  const [exchange, setExchange] = useState<Exchange | "ALL">("ALL");
  const [instrumentType, setInstrumentType] = useState<InstrumentType | "ALL">("ALL");

  const models = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return DEMO_INSTRUMENTS.filter((instrument) => {
      if (exchange !== "ALL" && instrument.exchange !== exchange) return false;
      if (instrumentType !== "ALL" && instrument.instrumentType !== instrumentType) return false;
      if (!needle) return true;
      return (
        instrument.symbol.toUpperCase().includes(needle) ||
        instrument.name.toUpperCase().includes(needle)
      );
    }).map((instrument) => modelFromDemo(instrument, now, 20));
  }, [exchange, instrumentType, now, search]);

  const hasFilters = search.trim() !== "" || exchange !== "ALL" || instrumentType !== "ALL";

  return (
    <div className="p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="ml-page-title">Markets</h1>
          <p className="ml-page-sub">
            Sample catalogue of {DEMO_INSTRUMENTS.length} demonstration instruments. The full NSE/BSE
            instrument master syncs into Convex and returns when the backend is reachable.
          </p>
        </div>
        <DataModeBadge mode="SAMPLE" source="sample" />
      </header>

      <Card className="mb-4">
        <div className="ml-toolbar">
          <div className="ml-toolbar__field">
            <Input
              label="Search"
              placeholder="Search symbol or company"
              value={search}
              onChange={setSearch}
            />
          </div>
          <div className="ml-toolbar__field">
            <Select
              value={exchange}
              onSelect={(value) => setExchange(value as Exchange | "ALL")}
              options={EXCHANGE_OPTIONS}
              label="Exchange"
            />
          </div>
          <div className="ml-toolbar__field">
            <Select
              value={instrumentType}
              onSelect={(value) => setInstrumentType(value as InstrumentType | "ALL")}
              options={TYPE_OPTIONS.filter((option) => option.value !== "OTHER")}
              label="Instrument type"
            />
          </div>
          <div className="ml-toolbar__field">
            <p className="text-[11px] text-[var(--text-3)]">
              Sorting and pagination arrive with the synced instrument master.
            </p>
          </div>
          <div className="ml-toolbar__actions">
            <Button
              variant="secondary"
              size="sm"
              disabled={!hasFilters}
              onClick={() => {
                setSearch("");
                setExchange("ALL");
                setInstrumentType("ALL");
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--text-3)]" data-testid="demo-result-count">
          {models.length} of {DEMO_INSTRUMENTS.length} sample instruments
        </p>
        <span className="text-[11px] text-[var(--text-3)]">
          Prices are generated deterministically and are not exchange data.
        </span>
      </div>

      {models.length === 0 ? (
        <EmptyState
          icon={<SearchX size={18} aria-hidden="true" />}
          title="No sample instrument matches that search"
          description="Try a different symbol, or clear the filters to browse the sample catalogue."
          action={
            hasFilters ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setExchange("ALL");
                  setInstrumentType("ALL");
                }}
              >
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="ml-stock-grid">
          {models.map((model) => (
            <StockCard
              key={model.instrumentId}
              model={model}
              onOpen={onOpenInstrument}
              now={now}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ router */

const Markets: React.FC<MarketsProps> = (props) => {
  const { backendOnline } = useRootContext();
  return backendOnline ? <MarketsLive {...props} /> : <MarketsDemo {...props} />;
};

export default Markets;
