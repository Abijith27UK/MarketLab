import React from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Grid, Button } from "@/components/ui";
import AuthPanel from "@/components/AuthPanel";

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

/**
 * STATIC SAMPLE market snapshot used for layout development only.
 * This is NOT live or provider market data.
 */
const SAMPLE_MARKET = {
  status: "CLOSED (sample)",
  nifty50: 24500.75,
  sensex: 80250.3,
  overview: [
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
  ] as MarketOverviewItem[],
};

const Dashboard: React.FC = () => {
  const { user, loading, isAuthenticated } = useRootContext();
  const paperAccount = useQuery(api.paperAccounts.get, {});

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="skeleton w-64 h-16 rounded-md animate-pulse mb-4" />
        <div className="skeleton w-32 h-8 rounded-md animate-pulse" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center py-12">
        <AuthPanel />
      </div>
    );
  }

  const marketStatus = SAMPLE_MARKET.status;

  return (
    <div className="p-4 md:p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-gray-400">Welcome back, {user.name}</p>
      </header>

      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Paper Account</h2>
          <span className="text-xs text-gray-500">Persisted in Convex</span>
        </div>
        {paperAccount === undefined && (
          <p className="text-gray-500 text-sm">Loading paper account...</p>
        )}
        {paperAccount === null && (
          <p className="text-gray-400 text-sm">
            No paper account yet — it is created automatically after sign-in.
          </p>
        )}
        {paperAccount && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-400">Available cash</p>
              <p className="text-2xl font-bold">
                ₹{paperAccount.availableCash.toLocaleString("en-IN")}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-400">Starting capital</p>
              <p className="text-2xl font-bold">
                ₹{paperAccount.startingCapital.toLocaleString("en-IN")}
              </p>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-3">
          No trades have been executed. Live trading is disabled until a broker is
          connected.
        </p>
      </Card>

      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Market Status</h2>
          <span className="text-xs px-2 py-1 rounded border border-amber-500/60 text-amber-400">
            Sample data — not live
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm text-gray-400">NSE</h3>
            <p className="text-gray-300">{marketStatus}</p>
            <div className="mt-2 text-sm text-gray-300">
              <p>Nifty 50: {SAMPLE_MARKET.nifty50.toLocaleString("en-IN")}</p>
              <p>Sensex: {SAMPLE_MARKET.sensex.toLocaleString("en-IN")}</p>
            </div>
          </div>
          <div>
            <h3 className="text-sm text-gray-400">BSE</h3>
            <p className="text-gray-300">{marketStatus}</p>
          </div>
        </div>
      </Card>

      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Market Overview</h2>
          <span className="text-xs px-2 py-1 rounded border border-amber-500/60 text-amber-400">
            Sample data — not live
          </span>
        </div>
        <Grid cols={3} gap="4">
          {SAMPLE_MARKET.overview.map((item) => (
            <div key={item.symbol} className="p-4 rounded-lg border border-gray-700">
              <h3 className="text-sm text-gray-400 mb-1">{item.symbol}</h3>
              <p className={`text-2xl font-bold ${toneClass(item.change)}`}>
                ₹{item.price.toLocaleString("en-IN")}
              </p>
              <p className={`text-sm ${toneClass(item.change)}`}>
                {signLabel(item.change)} {item.change.toFixed(2)} (
                {item.changePercent.toFixed(2)}%)
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
