import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Grid, Button, Input, Select } from "@/components/ui";

const Watchlists: React.FC = () => {
  const { user } = useRootContext();

  const { data: watchlists = [], isPending } = useQuery({
    queryKey: ["watchlists", user?.userId || ""],
    queryFn: () => api.listWatchlists({ userId: user?.userId || "" }),
    enabled: Boolean(user?.userId),
  });

  const [newWatchlistName, setNewWatchlistName] = useState("");
  const [selectedInstrument, setSelectedInstrument] = useState("reliance");

  const handleCreateWatchlist = async () => {
    if (!newWatchlistName.trim() || !user) return;
    try {
      await api.createWatchlist({
        userId: user.userId,
        name: newWatchlistName.trim(),
        description: "",
      });
      setNewWatchlistName("");
    } catch (err) {
      console.error("Failed to create watchlist:", err);
    }
  };

  const handleAddToWatchlist = async (watchlistId: string, instrumentId: string) => {
    try {
      await api.addToWatchlist({
        watchlistId,
        instrumentId,
        position: 0,
      });
    } catch (err) {
      console.error("Failed to add to watchlist:", err);
    }
  };

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
            />
          </div>
          <Button onClick={handleCreateWatchlist} disabled={!newWatchlistName.trim()}>
            Create
          </Button>
        </div>
      </Card>

      {user && (
        <Card>
          <h2 className="text-xl font-semibold mb-4">Your Watchlists</h2>
          {isPending && <p className="text-gray-400">Loading watchlists...</p>}
          {!isPending && watchlists.length === 0 && (
            <p className="text-gray-500">No watchlists found</p>
          )}
          <Grid cols={2} gap="3">
            {watchlists.map((wl: any) => (
              <div
                key={wl.id}
                className="p-4 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-800/60 transition-colors"
              >
                <div className="font-medium text-lg">{wl.name}</div>
                <div className="text-sm text-gray-500 mt-1">
                  ({wl.instruments?.length || 0} instruments)
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => alert(`Viewing ${wl.name}`)}
                >
                  View
                </Button>
              </div>
            ))}
          </Grid>
        </Card>
      )}

      {user && watchlists.length > 0 && (
        <Card className="mt-6">
          <h2 className="text-xl font-semibold mb-4">Add Instrument to Watchlist</h2>
          <div className="mb-4">
            <Select
              value={selectedInstrument}
              onSelect={setSelectedInstrument}
              options={[
                { value: "reliance", label: "RELIANCE - Reliance Industries" },
                { value: "tcs", label: "TCS - Tata Consultancy Services" },
                { value: "infy", label: "INFY - Infosys" },
              ]}
              placeholder="Select instrument"
            />
          </div>
          <Grid cols={2} gap="3">
            {watchlists.map((wl: any) => (
              <div key={wl.id} className="space-y-1">
                <span className="text-sm text-gray-300">{wl.name}:</span>
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full"
                  onClick={() => handleAddToWatchlist(wl.id, selectedInstrument)}
                >
                  Add Selected
                </Button>
              </div>
            ))}
          </Grid>
        </Card>
      )}
    </div>
  );
};

export default Watchlists;