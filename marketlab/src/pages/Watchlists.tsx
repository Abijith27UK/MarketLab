import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useRootContext } from "@/context/RootContext";
import { Button, Card, Input, Select } from "@/components/ui";
import AuthPanel from "@/components/AuthPanel";
import BackendRequired from "@/components/system/BackendRequired";
import DataModeBadge from "@/components/market/DataModeBadge";
import { useQuotes } from "@/hooks/useQuotes";
import { marketApi } from "@/lib/marketClient";
import { instrumentIdOf } from "@/lib/stockModels";
import { sortWatchlistRows, toggleSort, type SortState, type WatchlistRow } from "@/lib/tableSort";
import { formatPercent, formatPrice, toneClass } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

interface WatchlistsProps {
  onOpenInstrument: (instrumentId: string) => void;
}

const WatchlistsLive: React.FC<WatchlistsProps> = ({ onOpenInstrument }) => {
  const { isAuthenticated, loading } = useRootContext();

  const watchlists = useQuery(api.watchlists.list, {});
  const createWatchlist = useMutation(api.watchlists.create);
  const renameWatchlist = useMutation(api.watchlists.rename);
  const removeWatchlist = useMutation(api.watchlists.remove);
  const moveWatchlist = useMutation(api.watchlists.move);
  const addItem = useMutation(api.watchlists.addItem);
  const removeItem = useMutation(api.watchlists.removeItem);

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedInstrumentId, setSelectedInstrumentId] = useState("");
  const [targetWatchlistId, setTargetWatchlistId] = useState("");
  const [sort, setSort] = useState<SortState<"symbol" | "price" | "change" | "added">>({
    key: "symbol",
    dir: 1,
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const results = useQuery(marketApi.searchInstruments, {
    search: debounced,
    exchange: "ALL",
    limit: 20,
  });

  const options = useMemo(
    () =>
      (results?.items ?? []).map((row) => ({
        value: instrumentIdOf(row),
        label: `${row.symbol} — ${row.name} (${row.exchange})`,
      })),
    [results]
  );

  useEffect(() => {
    if (options.length === 0) return;
    if (options.some((option) => option.value === selectedInstrumentId)) return;
    setSelectedInstrumentId(options[0].value);
  }, [options, selectedInstrumentId]);

  useEffect(() => {
    if ((watchlists?.length ?? 0) === 0) return;
    if (watchlists?.some((list) => list._id === targetWatchlistId)) return;
    setTargetWatchlistId(watchlists?.[0]?._id ?? "");
  }, [watchlists, targetWatchlistId]);

  const allIds = useMemo(
    () =>
      Array.from(
        new Set((watchlists ?? []).flatMap((list) => list.items.map((item) => item.instrumentId)))
      ),
    [watchlists]
  );
  const quotes = useQuotes(allIds.slice(0, 60), { pollMs: 60_000 });
  const quoteById = useMemo(
    () => new Map((quotes.data?.quotes ?? []).map((quote) => [quote.instrumentId, quote])),
    [quotes.data]
  );

  const instrumentName = (instrumentId: string) => {
    const row = (results?.items ?? []).find((item) => instrumentIdOf(item) === instrumentId);
    if (row) return row.name;
    return "";
  };

  const toRows = (items: { _id: string; instrumentId: string; addedAt: number }[]): WatchlistRow[] =>
    items.map((item) => {
      const quote = quoteById.get(item.instrumentId);
      const parsed = item.instrumentId.split(":");
      return {
        itemId: item._id,
        instrumentId: item.instrumentId,
        symbol: quote?.symbol ?? parsed[1] ?? item.instrumentId,
        name: instrumentName(item.instrumentId),
        exchange: quote?.exchange ?? parsed[0] ?? "",
        price: quote?.lastPrice ?? null,
        changePercent: quote?.changePercent ?? null,
        addedAt: item.addedAt,
      };
    });

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await action();
      setNotice(successMessage);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setPending(false);
    }
  };

  const commitRename = async () => {
    if (!editingId) return;
    const name = editingName.trim();
    const original = (watchlists ?? []).find((list) => list._id === editingId);
    if (!name || name === original?.name) {
      setEditingId(null);
      return;
    }
    await run(async () => {
      await renameWatchlist({ id: editingId as Id<"watchlists">, name });
      setEditingId(null);
    }, "Watchlist renamed.");
  };

  if (loading) {
    return <div className="p-6 text-gray-400">Loading watchlists…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="ml-page-title">Watchlists</h1>
        <p className="ml-page-sub">
          Lists are private to your account. Sign in to create one and keep instruments across
          sessions.
        </p>
        <Card className="mt-5 max-w-md">
          <AuthPanel />
        </Card>
      </div>
    );
  }

  const lists = watchlists ?? [];
  const sortMark = (key: typeof sort.key) =>
    sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : "";

  return (
    <div className="p-4 md:p-6">
      <header className="ml-page-head">
        <div>
          <h1 className="ml-page-title">Watchlists</h1>
          <p className="ml-page-sub">
            Your saved instrument collections, with the same labelled prices as the rest of the app.
          </p>
          {quotes.data?.note && (
            <p className="mt-1 text-xs text-gray-500" role="note">
              {quotes.data.note}
            </p>
          )}
        </div>
        <div className="ml-page-head-side">
          {quotes.data && <DataModeBadge mode={quotes.data.mode} source={quotes.data.source} />}
        </div>
      </header>

      {quotes.error && (
        <p className="ml-inline-error" role="alert">
          Quotes could not be refreshed: {quotes.error}
        </p>
      )}
      {error && (
        <p className="ml-inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ml-inline-notice" role="status">
          {notice}
        </p>
      )}

      <Card className="mb-6">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">Create watchlist</h2>
            <p className="ml-section-sub">Names are unique per account.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Input
              label="Name"
              placeholder="e.g. Long-term ideas"
              value={newName}
              onChange={setNewName}
            />
          </div>
          <Button
            disabled={!newName.trim() || pending}
            onClick={() =>
              void run(async () => {
                await createWatchlist({ name: newName.trim() });
                setNewName("");
              }, "Watchlist created.")
            }
          >
            Create
          </Button>
        </div>
      </Card>

      {watchlists === undefined && <p className="ml-empty">Loading watchlists…</p>}

      {lists.length === 0 && watchlists !== undefined && (
        <Card>
          <p className="ml-empty" data-testid="watchlists-empty">
            No watchlists yet. Create one above, then add instruments from here or from Markets.
          </p>
        </Card>
      )}

      {lists.map((list, index) => {
        const rows = sortWatchlistRows(toRows(list.items), sort.key, sort.dir);
        return (
          <Card key={list._id} className="mb-4">
            <div className="ml-section-head">
              <div>
                {editingId === list._id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="ml-inline-input"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void commitRename();
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      aria-label={`Rename ${list.name}`}
                      autoFocus
                    />
                    <Button size="sm" onClick={() => void commitRename()} disabled={pending}>
                      Save
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <h2 className="ml-section-title">{list.name}</h2>
                )}
                <p className="ml-section-sub">
                  {list.items.length} instrument{list.items.length === 1 ? "" : "s"}
                  {list.description ? ` · ${list.description}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending || index === 0}
                  onClick={() => void run(() => moveWatchlist({ id: list._id, direction: "UP" }), "Watchlist moved up.")}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending || index === lists.length - 1}
                  onClick={() =>
                    void run(() => moveWatchlist({ id: list._id, direction: "DOWN" }), "Watchlist moved down.")
                  }
                >
                  ↓
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setEditingId(list._id);
                    setEditingName(list.name);
                  }}
                >
                  Rename
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Delete watchlist “${list.name}”?`)) {
                      void run(() => removeWatchlist({ id: list._id }), "Watchlist deleted.");
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>

            {list.items.length === 0 ? (
              <p className="ml-empty">No instruments yet. Add one with the picker below.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="ml-table">
                  <thead>
                    <tr>
                      <th>
                        <button onClick={() => setSort((s) => toggleSort(s, "symbol"))}>
                          Symbol{sortMark("symbol")}
                        </button>
                      </th>
                      <th>Name</th>
                      <th className="is-right">
                        <button onClick={() => setSort((s) => toggleSort(s, "price"))}>
                          LTP{sortMark("price")}
                        </button>
                      </th>
                      <th className="is-right">
                        <button onClick={() => setSort((s) => toggleSort(s, "change"))}>
                          Change{sortMark("change")}
                        </button>
                      </th>
                      <th>
                        <button onClick={() => setSort((s) => toggleSort(s, "added"))}>
                          Added{sortMark("added")}
                        </button>
                      </th>
                      <th>Data</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const quote = quoteById.get(row.instrumentId);
                      return (
                        <tr key={row.itemId} data-instrument-id={row.instrumentId}>
                          <td>
                            <button
                              type="button"
                              className="ml-position-link"
                              onClick={() => onOpenInstrument(row.instrumentId)}
                            >
                              {row.symbol}
                            </button>
                          </td>
                          <td className="max-w-64 truncate text-gray-400">{row.name || "—"}</td>
                          <td className="is-right ml-mono">
                            {quotes.loading && !quote ? "…" : formatPrice(row.price)}
                          </td>
                          <td className={`is-right ml-mono ${toneClass(row.changePercent)}`}>
                            {formatPercent(row.changePercent)}
                          </td>
                          <td className="text-xs text-gray-500">
                            {new Date(row.addedAt).toLocaleDateString("en-IN")}
                          </td>
                          <td>
                            {quote ? (
                              <div className="flex flex-col gap-1">
                                <DataModeBadge mode={quote.mode} source={quote.source} />
                                {quote.eod && quote.quoteTime ? (
                                  <span className="text-[11px] text-gray-500">
                                    EOD close · {new Date(quote.quoteTime).toLocaleDateString("en-IN")}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-xs text-gray-600">no quote</span>
                            )}
                          </td>
                          <td>
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                className="ml-row-action"
                                onClick={() => onOpenInstrument(row.instrumentId)}
                              >
                                Chart
                              </button>
                              <button
                                type="button"
                                className="ml-row-action is-danger"
                                disabled={pending}
                                aria-label={`Remove ${row.symbol} from ${list.name}`}
                                onClick={() =>
                                  void run(
                                    () => removeItem({ id: row.itemId as Id<"watchlistItems"> }),
                                    "Instrument removed."
                                  )
                                }
                              >
                                Remove
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
          </Card>
        );
      })}

      {lists.length > 0 && (
        <Card>
          <div className="ml-section-head">
            <div>
              <h2 className="ml-section-title">Add instrument</h2>
              <p className="ml-section-sub">
                Search the instrument catalogue, then add it to one of your lists.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:items-end">
            <Input
              label="Search"
              placeholder="Symbol or company"
              value={search}
              onChange={setSearch}
            />
            <Select
              label="Instrument"
              value={selectedInstrumentId}
              onSelect={setSelectedInstrumentId}
              options={options}
              placeholder={results === undefined ? "Searching…" : "No matches"}
            />
            <Select
              label="Watchlist"
              value={targetWatchlistId}
              onSelect={setTargetWatchlistId}
              options={lists.map((list) => ({ value: list._id, label: list.name }))}
              placeholder="Select watchlist"
            />
          </div>
          <Button
            className="mt-4"
            disabled={!selectedInstrumentId || !targetWatchlistId || pending}
            onClick={() =>
              void run(
                () =>
                  addItem({
                    watchlistId: targetWatchlistId as Id<"watchlists">,
                    instrumentId: selectedInstrumentId,
                  }),
                "Instrument added."
              )
            }
          >
            Add to watchlist
          </Button>
        </Card>
      )}
    </div>
  );
};

const Watchlists: React.FC<WatchlistsProps> = (props) => {
  const { backendOnline } = useRootContext();
  if (!backendOnline) {
    return (
      <BackendRequired
        feature="Watchlists"
        description="Create, rename and reorder lists, add or remove instruments, and keep them across sessions."
      />
    );
  }
  return <WatchlistsLive {...props} />;
};

export default Watchlists;
