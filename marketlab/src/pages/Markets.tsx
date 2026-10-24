import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Grid, Input, Select, Button } from "@/components/ui";

interface Instrument {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string;
  instrumentType: string;
  lotSize?: number;
}

const Markets: React.FC = () => {
  const { user } = useRootContext();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedExchange, setSelectedExchange] = useState("NSE");
  const [instrumentTypeFilter, setInstrumentTypeFilter] = useState("");

  const { data: instruments = [], isPending } = useQuery({
    queryKey: ["instruments", "NSE"],
    queryFn: () => api.listInstruments({ exchange: "NSE", instrumentType: "" }),
  });

  const filteredInstruments = (instruments as Instrument[]).filter((inst) => {
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

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12">
        <p className="text-center text-gray-400">Loading instruments...</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Markets</h1>
        <p className="text-gray-400">Indian stock market — NSE & BSE</p>
      </header>

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
              { value: "FUTURES", label: "Futures (FUT)" },
              { value: "OPTIONS", label: "Options (OPT)" },
              { value: "INDICES", label: "Indices" },
            ]}
            placeholder="Instrument Type"
          />
          <Button variant="secondary" onClick={() => setSearchQuery("")}>
            Clear
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="text-xl font-semibold mb-4">Instruments</h2>
        <p className="text-gray-500 text-sm mb-4">
          {filteredInstruments.length > 0
            ? `${filteredInstruments.length} instruments found`
            : "No instruments found. Instrument master not yet populated — see README for CSV import instructions."}
        </p>
        <Grid cols={3} gap="3">
          {filteredInstruments.map((inst) => (
            <div
              key={inst.instrumentId}
              className="p-3 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-800/60 transition-colors"
            >
              <div className="font-medium text-sm">{inst.symbol}</div>
              <div className="text-xs text-gray-500">{inst.name}</div>
              <div className="text-xs text-gray-500">
                {inst.exchange} • {inst.instrumentType}
              </div>
              {inst.lotSize ? (
                <div className="text-xs text-emerald-400 mt-1">Lot: {inst.lotSize}</div>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                className="w-full text-xs mt-2"
                onClick={() => console.log("Add to watchlist", inst.instrumentId)}
              >
                Add Watchlist
              </Button>
            </div>
          ))}
        </Grid>
      </Card>

      {user && (
        <div className="mt-6">
          <h3 className="text-lg font-medium mb-3">Quick Stats</h3>
          <Grid cols={4} gap="3">
            <div className="p-3 rounded-lg bg-gray-800/50 text-center">
              <div className="text-2xl font-bold text-emerald-400">—</div>
              <div className="text-xs text-gray-400">Advances</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50 text-center">
              <div className="text-2xl font-bold text-red-400">—</div>
              <div className="text-xs text-gray-400">Declines</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50 text-center">
              <div className="text-2xl font-bold text-emerald-400">—</div>
              <div className="text-xs text-gray-400">Today's gain</div>
            </div>
            <div className="p-3 rounded-lg bg-gray-800/50 text-center">
              <div className="text-2xl font-bold text-red-400">—</div>
              <div className="text-xs text-gray-400">Today's loss</div>
            </div>
          </Grid>
        </div>
      )}
    </div>
  );
};

export default Markets;