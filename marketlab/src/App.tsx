import { useState } from "react";
import "./styles/globals.css";
import Dashboard from "./pages/Dashboard";
import Markets from "./pages/Markets";
import Watchlists from "./pages/Watchlists";
import Trading from "./pages/Trading";
import Profile from "./pages/Profile";

type PageId = "dashboard" | "markets" | "watchlists" | "trading" | "profile";

const NAV: { id: PageId; label: string; hint: string }[] = [
  { id: "dashboard", label: "Dashboard", hint: "Overview & indices" },
  { id: "markets", label: "Markets", hint: "NSE / BSE explorer" },
  { id: "watchlists", label: "Watchlists", hint: "Your saved symbols" },
  { id: "trading", label: "Trading", hint: "Paper order entry" },
  { id: "profile", label: "Profile", hint: "Account & settings" },
];

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [navOpen, setNavOpen] = useState(false);

  const renderPage = () => {
    switch (page) {
      case "dashboard":
        return <Dashboard />;
      case "markets":
        return <Markets />;
      case "watchlists":
        return <Watchlists />;
      case "trading":
        return <Trading />;
      case "profile":
        return <Profile />;
      default:
        return <Dashboard />;
    }
  };

  return (
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

        <nav aria-label="Main navigation">
          <ul className="ml-nav">
            {NAV.map((item) => (
              <li key={item.id}>
                <button
                  className={`ml-nav-item${page === item.id ? " is-active" : ""}`}
                  aria-current={page === item.id ? "page" : undefined}
                  onClick={() => {
                    setPage(item.id);
                    setNavOpen(false);
                  }}
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
            Simulated orders only. Live trading disabled until a broker is connected.
          </p>
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
        {renderPage()}
      </main>
    </div>
  );
}
