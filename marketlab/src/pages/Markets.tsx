import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Button, Input, Select } from "@/components/ui";
import DataModeBadge from "@/components/market/DataModeBadge";
import StockCard from "@/components/market/StockCard";
import { DEMO_INSTRUMENTS } from "@/lib/demoCatalogue";
import { modelFromDemo } from "@/lib/stockModels";
import { useQuotes } from "@/hooks/useQuotes";
import {
  marketApi,
  type Exchange,
  type InstrumentRow,
  type InstrumentType,
} from "@/lib/marketClient";
import { formatAge, formatPercent, formatPrice, formatVolume, signGlyph, toneClass } from "@/lib/format";

interface MarketsProps {
  onOpenInstrument: (instrumentId: string) => void;
}

type SortKey = "symbol" | "price" | "change" | "volume";

const instrumentIdOf = (row: InstrumentRow) =>
  row.instrumentId ?? `${row.exchange}:${row.symbol}:${row.instrumentType}`;

const PAGE_SIZE = 25;

const MarketsLive: React.FC<MarketsProps> = ({ onOpenInstrument }) => {
  const { isAuthenticated } = useRootContext();

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

  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "");

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Markets</h1>
        <p className="text-gray-400">
          NSE &amp; BSE instrument explorer
          {session ? ` · ${session.label} · ${session.istTime} IST` : ""}
        </p>
      </header>

      {session && !session.holidaysConfigured && (
        <p className="mb-4 text-xs text-amber-400/80">
          Session hours are derived from IST exchange timings. The exchange holiday calendar is not
          configured in this deployment, so holidays are not excluded.
        </p>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input
              label="Search by symbol or company"
              placeholder="e.g. RELIANCE, Infosys"
              value={search}
              onChange={setSearch}
            />
          </div>
          <div className="w-36">
            <Select
              label="Exchange"
              value={exchange}
              onSelect={(value) => setExchange(value as Exchange | "ALL")}
              options={[
                { value: "ALL", label: "All exchanges" },
                { value: "NSE", label: "NSE" },
                { value: "BSE", label: "BSE" },
              ]}
            />
          </div>
          <div className="w-40">
            <Select
              label="Instrument type"
              value={instrumentType}
              onSelect={(value) => setInstrumentType(value as InstrumentType | "ALL")}
              options={[
                { value: "ALL", label: "All types" },
                { value: "EQUITY", label: "Equity" },
                { value: "ETF", label: "ETF" },
                { value: "INDEX", label: "Index" },
                { value: "OTHER", label: "Other" },
              ]}
            />
          </div>
          <Button variant="secondary" onClick={() => void refresh()} disabled={refreshing || ids.length === 0}>
            {refreshing ? "Refreshing…" : "Refresh quotes"}
          </Button>
        </div>

        {isAuthenticated && (watchlists?.length ?? 0) > 0 && (
          <div className="mt-4 max-w-xs">
            <Select
              label="Add to watchlist"
              value={targetWatchlistId}
              onSelect={setTargetWatchlistId}
              options={(watchlists ?? []).map((wl) => ({ value: wl._id, label: wl.name }))}
              placeholder="Select watchlist"
            />
          </div>
        )}

        {quoteData?.note && <p className="mt-3 text-xs text-amber-400/80">{quoteData.note}</p>}
        {quoteData?.warning && <p className="mt-2 text-xs text-red-400">{quoteData.warning}</p>}
        {status && (
          <p
            role={status.kind === "error" ? "alert" : "status"}
            className={`mt-3 text-sm ${status.kind === "error" ? "text-red-400" : "text-emerald-400"}`}
          >
            {status.text}
          </p>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Instruments</h2>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            {stats && (
              <span>
                {stats.total} instruments · {stats.provider} provider · {stats.sample} sample
              </span>
            )}
            {quoteData && <DataModeBadge mode={quoteData.mode} source={quoteData.source} />}
          </div>
        </div>

        {result === undefined && <p className="text-gray-400">Loading instruments…</p>}

        {result && rows.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-gray-400">No instruments match these filters.</p>
            <p className="mt-1 text-sm text-gray-600">
              {stats && stats.provider === 0
                ? "Only the sample catalogue is loaded. Sync the instrument master from the Data Sources page."
                : "Try a different symbol or clear the filters."}
            </p>
          </div>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="ml-table">
              <thead>
                <tr>
                  <th>
                    <button onClick={() => toggleSort("symbol")} className="hover:text-white">
                      Symbol{sortMark("symbol")}
                    </button>
                  </th>
                  <th>Name</th>
                  <th>Exchange</th>
                  <th className="is-right">
                    <button onClick={() => toggleSort("price")} className="hover:text-white">
                      LTP{sortMark("price")}
                    </button>
                  </th>
                  <th className="is-right">
                    <button onClick={() => toggleSort("change")} className="hover:text-white">
                      Change{sortMark("change")}
                    </button>
                  </th>
                  <th className="is-right">
                    <button onClick={() => toggleSort("volume")} className="hover:text-white">
                      Volume{sortMark("volume")}
                    </button>
                  </th>
                  <th>Data</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => {
                  const id = instrumentIdOf(row);
                  const quote = quoteById.get(id);
                  return (
                    <tr key={row._id}>
                      <td className="font-medium text-gray-100">{row.symbol}</td>
                      <td className="max-w-64 truncate">{row.name}</td>
                      <td>
                        {row.exchange} · {row.instrumentType}
                      </td>
                      <td className="is-right ml-mono">
                        {quotesLoading && !quote ? "…" : formatPrice(quote?.lastPrice)}
                      </td>
                      <td className={`is-right ml-mono ${toneClass(quote?.changePercent)}`}>
                        {quote
                          ? `${signGlyph(quote.changePercent)} ${formatPercent(quote.changePercent)}`
                          : "—"}
                      </td>
                      <td className="is-right ml-mono">{formatVolume(quote?.volume)}</td>
                      <td>
                        {quote ? (
                          <span className="flex items-center gap-2">
                            <DataModeBadge mode={quote.mode} />
                            <span className="text-xs text-gray-500">
                              {formatAge(quote.quoteTime, Date.now())}
                            </span>
                          </span>
                        ) : (
                          <span className="text-xs text-gray-600">no quote</span>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <button
                            className="text-xs text-emerald-400 hover:text-emerald-300"
                            onClick={() => onOpenInstrument(id)}
                          >
                            Chart
                          </button>
                          {isAuthenticated && (watchlists?.length ?? 0) > 0 && (
                            <button
                              className="text-xs text-gray-300 hover:text-white"
                              disabled={pendingSymbol === id || !targetWatchlistId}
                              onClick={() => void handleAdd(row)}
                            >
                              Add
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
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
          <span className="text-xs text-gray-500">
            {result?.mode === "search" ? "Search results" : `Page size ${PAGE_SIZE}`}
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

  return (
    <div className="p-4 md:p-6">
      <h1 className="ml-page-title">Markets</h1>
      <p className="ml-page-sub">
        Sample catalogue of {DEMO_INSTRUMENTS.length} demonstration instruments. The full NSE/BSE
        instrument master syncs into Convex and returns when the backend is reachable.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Input placeholder="Search symbol or company" value={search} onChange={setSearch} />
        </div>
        <Select
          value={exchange}
          onSelect={(value) => setExchange(value as Exchange | "ALL")}
          options={[
            { value: "ALL", label: "All exchanges" },
            { value: "NSE", label: "NSE" },
            { value: "BSE", label: "BSE" },
          ]}
          label="Exchange"
        />
        <Select
          value={instrumentType}
          onSelect={(value) => setInstrumentType(value as InstrumentType | "ALL")}
          options={[
            { value: "ALL", label: "All types" },
            { value: "EQUITY", label: "Equity" },
            { value: "ETF", label: "ETF" },
            { value: "INDEX", label: "Index" },
          ]}
          label="Instrument type"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500" data-testid="demo-result-count">
          {models.length} of {DEMO_INSTRUMENTS.length} sample instruments
        </p>
        <DataModeBadge mode="SAMPLE" source="sample" />
      </div>

      {models.length === 0 ? (
        <p className="ml-empty mt-4">No sample instrument matches that search.</p>
      ) : (
        <div className="ml-stock-grid mt-4">
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
