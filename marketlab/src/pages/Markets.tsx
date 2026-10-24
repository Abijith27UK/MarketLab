import React, { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Grid, Input, Select, Button } from "@/components/ui";

interface Instrument {
  _id: string;
  symbol: string;
  name: string;
  exchange: "NSE" | "BSE";
  instrumentType: "EQUITY" | "ETF" | "INDEX";
  sector: string;
  dataSource: string;
  isSampleData: boolean;
}

const Markets: React.FC = () => {
  const { isAuthenticated } = useRootContext();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedExchange, setSelectedExchange] = useState("NSE");
  const [instrumentTypeFilter, setInstrumentTypeFilter] = useState("");
  const [targetWatchlistId, setTargetWatchlistId] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(
    null
  );
  const [pending, setPending] = useState(false);

  const instruments = useQuery(api.instruments.list, {});
  const watchlists = useQuery(api.watchlists.list, {});
  const addItem = useMutation(api.watchlists.addItem);

  const filteredInstruments = (instruments ?? []).filter((inst) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !q ||
      inst.symbol.toLowerCase().includes(q) ||
      inst.name.toLowerCase().includes(q);
    const matchesExchange = !selectedExchange || inst.exchange === selectedExchange;
    const matchesType =
      !instrumentTypeFilter || inst.instrumentType === instrumentTypeFilter;
    return matchesSearch && matchesExchange && matchesType;
  });

  if (instruments === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12">
        <p className="text-center text-gray-400">Loading instruments...</p>
      </div>
    );
  }

  const handleAdd = async (symbol: string) => {
    setStatus(null);
    if (!targetWatchlistId) {
      setStatus({ kind: "error", text: "Select a watchlist first." });
      return;
    }
    setPending(true);
    try {
      await addItem({ watchlistId: targetWatchlistId as never, instrumentId: symbol });
      setStatus({ kind: "ok", text: `${symbol} added to watchlist.` });
    } catch (err) {
      setStatus({
        kind: "error",
        text: err instanceof Error ? err.message : "Failed to add instrument.",
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Markets</h1>
        <p className="text-gray-400">Indian stock market — NSE & BSE</p>
      </header>

      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs px-2 py-1 rounded border border-amber-500/60 text-amber-400">
          Demonstration catalogue — sample records, not live market data
        </span>
        <span className="text-xs text-gray-500">
          {instruments.length} instruments loaded from Convex
        </span>
      </div>

      <Card className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Search Instruments</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="min-w-56 flex-1">
            <Input
              placeholder="Search by symbol, company name..."
              onChange={(value) => setSearchQuery(value)}
            />
          </div>
          <Select
            value={selectedExchange}
            onSelect={(val) => setSelectedExchange(val)}
            options={[
              { value: "NSE", label: "NSE" },
              { value: "BSE", label: "BSE" },
            ]}
            placeholder="Exchange"
          />
          <Select
            value={instrumentTypeFilter}
            onSelect={(val) => setInstrumentTypeFilter(val)}
            options={[
              { value: "", label: "All Types" },
              { value: "EQUITY", label: "Equity (EQ)" },
              { value: "ETF", label: "ETF" },
              { value: "INDEX", label: "Indices" },
            ]}
            placeholder="Instrument Type"
          />
          <Button variant="secondary" onClick={() => setSearchQuery("")}>
            Clear
          </Button>
        </div>

        {isAuthenticated && (watchlists?.length ?? 0) > 0 && (
          <div className="mt-4 max-w-xs">
            <label className="text-sm text-gray-300 mb-2 block">
              Add to watchlist
            </label>
            <Select
              value={targetWatchlistId}
              onSelect={setTargetWatchlistId}
              options={(watchlists ?? []).map((wl) => ({
                value: wl._id,
                label: wl.name,
              }))}
              placeholder="Select watchlist"
            />
          </div>
        )}
        {isAuthenticated && (watchlists?.length ?? 0) === 0 && (
          <p className="mt-4 text-sm text-gray-500">
            Create a watchlist on the Watchlists page to save instruments.
          </p>
        )}

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
        <h2 className="text-xl font-semibold mb-4">Instruments</h2>
        <p className="text-gray-500 text-sm mb-4">
          {filteredInstruments.length > 0
            ? `${filteredInstruments.length} instruments found`
            : "No instruments match your filters."}
        </p>
        <Grid cols={3} gap="3">
          {filteredInstruments.map((inst) => (
            <div
              key={inst._id}
              className="p-3 rounded-lg border border-gray-700 hover:bg-gray-800/60 transition-colors"
            >
              <div className="font-medium text-sm">{inst.symbol}</div>
              <div className="text-xs text-gray-500">{inst.name}</div>
              <div className="text-xs text-gray-500">
                {inst.exchange} • {inst.instrumentType} • {inst.sector}
              </div>
              <div className="text-xs text-amber-400/80 mt-1">Sample record</div>
              {isAuthenticated && (watchlists?.length ?? 0) > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full text-xs mt-2"
                  disabled={pending || !targetWatchlistId}
                  onClick={() => void handleAdd(inst.symbol)}
                >
                  Add to Watchlist
                </Button>
              )}
            </div>
          ))}
        </Grid>
      </Card>

      {isAuthenticated && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-3">Quick Stats</h3>
          <p className="text-xs text-gray-500 mb-3">
            No live data feed connected — values unavailable.
          </p>
          <Grid cols={4} gap="3">
            <div className="p-3 rounded-lg bg-gray-800/50 text-center">
              <div className="text-2xl font-bold text-gray-500">—</div>
              <div className="text-xs text-gray-400">Advances</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50 text-center">
              <div className="text-2xl font-bold text-gray-500">—</div>
              <div className="text-xs text-gray-400">Declines</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50 text-center">
              <div className="text-2xl font-bold text-gray-500">—</div>
              <div className="text-xs text-gray-400">Today's gain</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50 text-center">
              <div className="text-2xl font-bold text-gray-500">—</div>
              <div className="text-xs text-gray-400">Today's loss</div>
            </div>
          </Grid>
        </div>
      )}
    </div>
  );
};

export default Markets;
