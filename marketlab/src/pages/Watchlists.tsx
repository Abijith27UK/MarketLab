import React, { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Grid, Button, Input, Select } from "@/components/ui";

const Watchlists: React.FC = () => {
  const { isAuthenticated } = useRootContext();

  const watchlists = useQuery(api.watchlists.list, {});
  const instruments = useQuery(api.instruments.list, {});

  const createWatchlist = useMutation(api.watchlists.create);
  const renameWatchlist = useMutation(api.watchlists.rename);
  const removeWatchlist = useMutation(api.watchlists.remove);
  const addItem = useMutation(api.watchlists.addItem);
  const removeItem = useMutation(api.watchlists.removeItem);

  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [targetWatchlistId, setTargetWatchlistId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      await action();
      setNotice(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="p-4 md:p-6">
        <header className="mb-6">
          <h1 className="text-3xl font-bold">Watchlists</h1>
          <p className="text-gray-400">Sign in to view and manage watchlists.</p>
        </header>
      </div>
    );
  }

  const instrumentOptions = (instruments ?? []).map((inst) => ({
    value: inst.symbol,
    label: `${inst.symbol} - ${inst.name} (${inst.exchange})`,
  }));

  const watchlistOptions = (watchlists ?? []).map((wl) => ({
    value: wl._id,
    label: wl.name,
  }));

  const symbolName = (symbol: string) =>
    (instruments ?? []).find((i) => i.symbol === symbol)?.name ?? "";

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Watchlists</h1>
        <p className="text-gray-400">Your saved instrument collections</p>
      </header>

      <Card className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Create Watchlist</h2>
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              placeholder="Watchlist name"
              value={newWatchlistName}
              onChange={setNewWatchlistName}
              disabled={pending}
            />
          </div>
          <Button
            disabled={!newWatchlistName.trim() || pending}
            onClick={() =>
              void run(async () => {
                await createWatchlist({ name: newWatchlistName.trim() });
                setNewWatchlistName("");
              }, "Watchlist created.")
            }
          >
            Create
          </Button>
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-red-400 mb-4">
          {error}
        </p>
      )}
      {notice && (
        <p className="text-sm text-emerald-400 mb-4" aria-live="polite">
          {notice}
        </p>
      )}

      <Card>
        <h2 className="text-xl font-semibold mb-4">Your Watchlists</h2>
        {watchlists === undefined && (
          <p className="text-gray-400">Loading watchlists...</p>
        )}
        {watchlists?.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-2">No watchlists yet.</p>
            <p className="text-sm text-gray-600">
              Create your first watchlist above to start tracking instruments.
            </p>
          </div>
        )}
        <Grid cols={2} gap="3">
          {(watchlists ?? []).map((wl) => (
            <div
              key={wl._id}
              className="p-4 rounded-lg border border-gray-700 hover:bg-gray-800/60 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-lg">{wl.name}</div>
                <span className="text-xs text-gray-500">
                  {wl.items.length} instrument{wl.items.length === 1 ? "" : "s"}
                </span>
              </div>
              {wl.description && (
                <div className="text-sm text-gray-500 mt-1">{wl.description}</div>
              )}

              {wl.items.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {wl.items.map((item) => (
                    <li
                      key={item._id}
                      className="flex items-center justify-between text-sm text-gray-300 border-t border-gray-800 pt-1"
                    >
                      <span>
                        {item.instrumentId}
                        <span className="text-gray-600 ml-2 text-xs">
                          {symbolName(item.instrumentId)}
                        </span>
                      </span>
                      <button
                        className="text-xs text-red-400 hover:text-red-300"
                        disabled={pending}
                        onClick={() =>
                          void run(
                            () => removeItem({ id: item._id }),
                            "Instrument removed."
                          )
                        }
                        aria-label={`Remove ${item.instrumentId} from ${wl.name}`}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2 mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  disabled={pending}
                  onClick={() => {
                    const next = prompt("Rename watchlist", wl.name);
                    if (next && next.trim() && next.trim() !== wl.name) {
                      void run(
                        () => renameWatchlist({ id: wl._id, name: next.trim() }),
                        "Watchlist renamed."
                      );
                    }
                  }}
                >
                  Rename
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  disabled={pending}
                  onClick={() => {
                    if (confirm(`Delete watchlist "${wl.name}"?`)) {
                      void run(
                        () => removeWatchlist({ id: wl._id }),
                        "Watchlist deleted."
                      );
                    }
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </Grid>
      </Card>

      {(watchlists?.length ?? 0) > 0 && (
        <Card className="mt-6">
          <h2 className="text-xl font-semibold mb-4">Add Instrument to Watchlist</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <Select
              value={selectedSymbol}
              onSelect={setSelectedSymbol}
              options={instrumentOptions}
              placeholder="Select instrument"
            />
            <Select
              value={targetWatchlistId}
              onSelect={setTargetWatchlistId}
              options={watchlistOptions}
              placeholder="Select watchlist"
            />
          </div>
          <p className="text-xs text-amber-400/80 mb-3">
            Demonstration instrument catalogue — symbols only, no live prices.
          </p>
          <Button
            disabled={!selectedSymbol || !targetWatchlistId || pending}
            onClick={() =>
              void run(
                () =>
                  addItem({
                    watchlistId: targetWatchlistId as never,
                    instrumentId: selectedSymbol,
                  }),
                `${selectedSymbol} added.`
              )
            }
          >
            Add Selected
          </Button>
        </Card>
      )}
    </div>
  );
};

export default Watchlists;
