import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Grid, Button } from "@/components/ui";

interface MarketOverviewItem {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

const toneClass = (change: number) =>
  change > 0 ? "text-emerald-400" : change < 0 ? "text-red-400" : "text-gray-300";

const signLabel = (change: number) => (change > 0 ? "▲" : change < 0 ? "▼" : "■");

const Dashboard: React.FC = () => {
  const { user, loading } = useRootContext();

  const { data: marketData, isPending } = useQuery({
    queryKey: ["marketStatus", "NSE"],
    queryFn: () => api.getMarketStatus({ market: "NSE" }),
  });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="skeleton w-64 h-16 rounded-md animate-pulse mb-4" />
        <div className="skeleton w-32 h-8 rounded-md animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12">
        <div className="rounded-lg border border-gray-700 bg-gray-900 p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">MarketLab</h2>
          <p className="text-gray-400 mb-6">Please log in to view your dashboard</p>
          <Button variant="primary" onClick={() => console.log("Go to Login")}>
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  const overviewItems: MarketOverviewItem[] = [
    {
      symbol: "RELIANCE",
      name: "Reliance Industries",
      price: 2845.35,
      change: 52.15,
      changePercent: 1.87,
      volume: 12548920,
    },
    {
      symbol: "TCS",
      name: "Tata Consultancy Services",
      price: 3892.1,
      change: -38.45,
      changePercent: -0.98,
      volume: 8765432,
    },
    {
      symbol: "HDFCBANK",
      name: "HDFC Bank",
      price: 1624.8,
      change: 15.2,
      changePercent: 0.94,
      volume: 45678901,
    },
  ];

  const marketStatus = marketData?.status || "CLOSED";

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-gray-400">Your full-stack stock market platform</p>
      </header>

      <Card className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Market Status</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm text-gray-400">NSE</h3>
            <p className={marketStatus === "OPEN" ? "text-emerald-400" : "text-red-400"}>
              {marketStatus}
            </p>
            {marketData?.indexValues && (
              <div className="mt-2 text-sm text-gray-300">
                <p>Nifty 50: {marketData.indexValues.nifty50?.toLocaleString() || "-"}</p>
                <p>Sensex: {marketData.indexValues.sensex?.toLocaleString() || "-"}</p>
              </div>
            )}
          </div>
          <div>
            <h3 className="text-sm text-gray-400">BSE</h3>
            <p className={marketStatus === "OPEN" ? "text-emerald-400" : "text-red-400"}>
              {marketStatus}
            </p>
          </div>
        </div>
        {isPending && (
          <p className="text-sm text-gray-500 mt-2">Loading market data...</p>
        )}
      </Card>

      <Card className="mb-6">
        <h2 className="text-xl font-semibold mb-4">Market Overview</h2>
        <Grid cols={3} gap="4">
          {overviewItems.map((item) => (
            <div key={item.symbol} className="p-4 rounded-lg border border-gray-700">
              <h3 className="text-sm text-gray-400 mb-1">{item.symbol}</h3>
              <p className={`text-2xl font-bold ${toneClass(item.change)}`}>
                ₹{item.price.toLocaleString("en-IN")}
              </p>
              <p className={`text-sm ${toneClass(item.change)}`}>
                {signLabel(item.change)} {item.change.toFixed(2)} ({item.changePercent.toFixed(2)}%)
              </p>
            </div>
          ))}
        </Grid>
      </Card>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button variant="primary" onClick={() => console.log("Watchlists")}>
          Watchlists
        </Button>
        <Button variant="secondary" onClick={() => console.log("Screener")}>
          Stock Screener
        </Button>
        <Button variant="primary" onClick={() => console.log("Charts")}>
          Charts
        </Button>
        <Button variant="secondary" onClick={() => console.log("Trading")}>
          Trading
        </Button>
      </div>
    </div>
  );
};

export default Dashboard;