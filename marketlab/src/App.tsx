import { useState } from "react";
import "./styles/globals.css";
import { RootProvider, OfflineRootProvider } from "./context/RootContext";
import Dashboard from "./pages/Dashboard";
import Markets from "./pages/Markets";
import Watchlists from "./pages/Watchlists";
import Portfolio from "./pages/Portfolio";
import Trading from "./pages/Trading";
import Profile from "./pages/Profile";
import Screener from "./pages/Screener";
import DataSources from "./pages/DataSources";
import InstrumentDetail from "./pages/InstrumentDetail";
import Strategies from "./pages/Strategies";
import Alerts from "./pages/Alerts";
import BackendBanner from "./components/system/BackendBanner";
import GlobalSearch from "./components/system/GlobalSearch";
import type { BackendState } from "./hooks/useBackendStatus";

type PageId =
  | "dashboard"
  | "markets"
  | "watchlists"
  | "portfolio"
  | "trading"
  | "strategies"
  | "alerts"
  | "screener"
  | "dataSources"
  | "profile";

const NAV: { id: PageId; label: string; hint: string }[] = [
  { id: "dashboard", label: "Dashboard", hint: "Overview & indices" },
  { id: "markets", label: "Markets", hint: "NSE / BSE explorer" },
  { id: "watchlists", label: "Watchlists", hint: "Your saved symbols" },
  { id: "portfolio", label: "Portfolio", hint: "Paper holdings & P&L" },
  { id: "screener", label: "Screener", hint: "Filter the market" },
  { id: "trading", label: "Trading", hint: "Paper order entry" },
  { id: "strategies", label: "Strategies", hint: "Rule builder & backtest" },
  { id: "alerts", label: "Alerts", hint: "Price thresholds" },
  { id: "dataSources", label: "Data Sources", hint: "Providers & imports" },
  { id: "profile", label: "Profile", hint: "Account & settings" },
];

export default function App({ backend }: { backend: BackendState }) {
  const [page, setPage] = useState<PageId>("dashboard");
  const [instrumentId, setInstrumentId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const backendOnline = backend.status === "online";

  const navigate = (next: PageId) => {
    setInstrumentId(null);
    setPage(next);
    setNavOpen(false);
  };

  const openInstrument = (id: string) => {
    setInstrumentId(id);
    setNavOpen(false);
  };

  const renderPage = () => {
    if (instrumentId) {
      return (
        <InstrumentDetail
          instrumentId={instrumentId}
          onBack={() => setInstrumentId(null)}
        />
      );
    }
    switch (page) {
      case "dashboard":
        return (
          <Dashboard
            onNavigate={(next) => navigate(next)}
            onOpenInstrument={openInstrument}
          />
        );
      case "markets":
        return <Markets onOpenInstrument={openInstrument} />;
      case "watchlists":
        return <Watchlists onOpenInstrument={openInstrument} />;
      case "screener":
        return <Screener onOpenInstrument={openInstrument} />;
      case "portfolio":
        return (
          <Portfolio onOpenInstrument={openInstrument} onNavigate={(next) => navigate(next)} />
        );
      case "trading":
        return <Trading onOpenInstrument={openInstrument} />;
      case "strategies":
        return <Strategies onOpenInstrument={openInstrument} />;
      case "alerts":
        return <Alerts />;
      case "dataSources":
        return <DataSources />;
      case "profile":
        return <Profile />;
      default:
        return (
          <Dashboard
            onNavigate={(next) => navigate(next)}
            onOpenInstrument={openInstrument}
          />
        );
    }
  };

  // Only one of these providers ever mounts: the offline one calls no Convex hooks,
  // so nothing polls a deployment that is not answering. They are rendered
  // directly: wrapping them in a component defined in this function would give
  // that wrapper a new identity on every render of App, remounting every page
  // and discarding selections and form input.
  const shell = (
    <>
      <div className="ml-shell">
        <button
          className="ml-menu-toggle"
          aria-label={navOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          ☰
        </button>

        <aside className={`ml-sidebar${navOpen ? " is-open" : ""}`}>
          <div className="ml-brand">
            <span className="ml-brand-mark">◆</span>
            <span className="ml-brand-name">MarketLab</span>
          </div>

          <GlobalSearch onOpenInstrument={openInstrument} />

          <nav aria-label="Main navigation">
            <ul className="ml-nav">
              {NAV.map((item) => (
                <li key={item.id}>
                  <button
                    className={`ml-nav-item${
                      page === item.id && !instrumentId ? " is-active" : ""
                    }`}
                    aria-current={page === item.id && !instrumentId ? "page" : undefined}
                    onClick={() => navigate(item.id)}
                  >
                    <span className="ml-nav-label">{item.label}</span>
                    <span className="ml-nav-hint">{item.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-sidebar-footer">
            <span className="ml-badge">Paper trading</span>
            <p className="ml-disclaimer">
              Simulated orders only. Live trading disabled until a broker is connected. Market data is
              labelled SAMPLE, LIVE, DELAYED, CACHED or HISTORICAL — never implied.
            </p>
            {!backendOnline && (
              <p className="ml-disclaimer ml-sidebar-offline" data-testid="sidebar-offline">
                Backend offline — sample data mode.
              </p>
            )}
          </div>
        </aside>

        {navOpen && (
          <button
            className="ml-scrim"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
        )}

        <main className="ml-main" id="main-content">
          <BackendBanner state={backend} />
          {renderPage()}
        </main>
      </div>
    </>
  );

  return backendOnline ? (
    <RootProvider>{shell}</RootProvider>
  ) : (
    <OfflineRootProvider onRetry={backend.retryNow}>{shell}</OfflineRootProvider>
  );
}
