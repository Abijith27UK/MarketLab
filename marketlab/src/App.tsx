import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Beaker,
  Bell,
  Database,
  LayoutDashboard,
  LineChart,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  Star,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
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
import TopBar from "./components/shell/TopBar";
import AccountChip from "./components/shell/AccountChip";
import MarketStatusPill from "./components/shell/MarketStatusPill";
import SignInDialog from "./components/shell/SignInDialog";
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

interface NavEntry {
  id: PageId;
  label: string;
  hint: string;
  Icon: LucideIcon;
}

interface NavGroup {
  label: string | null;
  items: NavEntry[];
}

/**
 * Navigation is grouped so the rail stays scannable at ten destinations. Each
 * row carries one label only; the description lives in the row tooltip.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { id: "dashboard", label: "Dashboard", hint: "Overview & indices", Icon: LayoutDashboard },
    ],
  },
  {
    label: "Markets",
    items: [
      { id: "markets", label: "Markets", hint: "NSE / BSE explorer", Icon: LineChart },
      { id: "watchlists", label: "Watchlists", hint: "Your saved symbols", Icon: Star },
      { id: "portfolio", label: "Portfolio", hint: "Paper holdings & P&L", Icon: Wallet },
      { id: "screener", label: "Screener", hint: "Filter the market", Icon: SlidersHorizontal },
    ],
  },
  {
    label: "Trading",
    items: [
      { id: "trading", label: "Trading", hint: "Paper order entry", Icon: ArrowLeftRight },
      { id: "strategies", label: "Strategies", hint: "Rule builder & backtest", Icon: Beaker },
      { id: "alerts", label: "Alerts", hint: "Price thresholds", Icon: Bell },
    ],
  },
  {
    label: "System",
    items: [
      { id: "dataSources", label: "Data sources", hint: "Providers & imports", Icon: Database },
      { id: "profile", label: "Profile", hint: "Account & settings", Icon: Settings },
    ],
  },
];

const NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);

const PAGE_LABEL = Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item.label])) as Record<
  PageId,
  string
>;

const PAGE_HINT = Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item.hint])) as Record<
  PageId,
  string
>;

const MOBILE_QUERY = "(max-width: 900px)";
/** Below this width the rail starts collapsed so the content keeps a usable width. */
const COMPACT_QUERY = "(max-width: 1199px)";

/** jsdom and some embedded browsers do not implement matchMedia. */
const supportsMatchMedia = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function";

const isMobileViewport = () =>
  supportsMatchMedia() ? window.matchMedia(MOBILE_QUERY).matches : false;

const isCompactViewport = () =>
  supportsMatchMedia() ? window.matchMedia(COMPACT_QUERY).matches : false;

export default function App({ backend }: { backend: BackendState }) {
  const [page, setPage] = useState<PageId>("dashboard");
  const [instrumentId, setInstrumentId] = useState<string | null>(null);
  // Desktop rail collapse and mobile drawer are separate states: one boolean
  // for both made the rail and the drawer fight over `collapsed`.
  // Small laptops (<1200px) start with the rail collapsed so the content area
  // keeps a usable width; phones start collapsed because the rail is a drawer.
  const [collapsed, setCollapsed] = useState(() => isMobileViewport() || isCompactViewport());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(isMobileViewport);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | null>(null);

  useEffect(() => {
    if (!supportsMatchMedia()) return;
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
      if (event.matches) {
        setCollapsed(true);
        setDrawerOpen(false);
      }
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const backendOnline = backend.status === "online";

  const navigate = (next: PageId) => {
    setInstrumentId(null);
    setPage(next);
    setDrawerOpen(false);
  };

  const openInstrument = (id: string) => {
    setInstrumentId(id);
    setDrawerOpen(false);
  };

  const toggleSidebar = () => {
    if (isMobile) setDrawerOpen((open) => !open);
    else setCollapsed((value) => !value);
  };

  const renderPage = () => {
    if (instrumentId) {
      return <InstrumentDetail instrumentId={instrumentId} onBack={() => setInstrumentId(null)} />;
    }
    switch (page) {
      case "dashboard":
        return (
          <Dashboard
            onNavigate={(next) => navigate(next)}
            onOpenInstrument={openInstrument}
            onOpenAuth={(mode) => setAuthMode(mode)}
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
            onOpenAuth={(mode) => setAuthMode(mode)}
          />
        );
    }
  };

  const ToggleIcon = isMobile
    ? drawerOpen
      ? X
      : Menu
    : collapsed
      ? PanelLeftOpen
      : PanelLeftClose;

  const toggleLabel = isMobile
    ? drawerOpen
      ? "Close navigation"
      : "Open navigation"
    : collapsed
      ? "Expand sidebar"
      : "Collapse sidebar";

  const title = instrumentId ? "Instrument" : PAGE_LABEL[page];
  const subtitle = instrumentId ?? PAGE_HINT[page];

  // Only one of these providers ever mounts: the offline one calls no Convex
  // hooks, so nothing polls a deployment that is not answering. They are
  // rendered directly: wrapping them in a component defined in this function
  // would give that wrapper a new identity on every render of App, remounting
  // every page and discarding selections and form input.
  const shell = (
    <div className={`ml-shell${collapsed && !isMobile ? " is-collapsed" : ""}`}>
      <a className="ml-skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        id="app-sidebar"
        className={`ml-sidebar${drawerOpen ? " is-open" : ""}${collapsed ? " collapsed" : ""}`}
        aria-label="Sidebar"
      >
        <div className="ml-sidebar-head">
          <div className="ml-brand">
            <span className="ml-brand-mark" aria-hidden="true">
              ◆
            </span>
            <span className="ml-brand-name">MarketLab</span>
          </div>
          <button
            type="button"
            className="ml-rail-toggle"
            onClick={toggleSidebar}
            aria-label={toggleLabel}
            aria-expanded={isMobile ? drawerOpen : undefined}
            data-testid="sidebar-toggle"
          >
            <ToggleIcon size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="ml-nav" aria-label="Main navigation">
          {NAV_GROUPS.map((group, index) => (
            <div className="ml-nav-group" key={group.label ?? `group-${index}`}>
              {group.label ? <p className="ml-nav-group-label">{group.label}</p> : null}
              <ul>
                {group.items.map((item) => {
                  const Icon = item.Icon;
                  const active = page === item.id && !instrumentId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`ml-nav-item${active ? " is-active" : ""}`}
                        aria-current={active ? "page" : undefined}
                        aria-label={item.label}
                        title={
                          collapsed && !isMobile
                            ? `${item.label} — ${item.hint}`
                            : item.hint
                        }
                        onClick={() => navigate(item.id)}
                      >
                        <Icon className="ml-nav-icon" aria-hidden="true" />
                        <span className="ml-nav-label">{item.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="ml-sidebar-footer">
          <AccountChip
            variant="sidebar"
            onOpenProfile={() => navigate("profile")}
            onSignIn={() => setAuthMode("signin")}
          />
          <div className="ml-mode-chip" title="Orders are simulated. No broker is connected.">
            <span className="ml-mode-dot" aria-hidden="true" />
            <span className="ml-mode-text">Paper trading · simulated only</span>
          </div>
          {!backendOnline && (
            <p className="ml-disclaimer ml-sidebar-offline" data-testid="sidebar-offline">
              Offline · sample data
            </p>
          )}
        </div>
      </aside>

      {drawerOpen && isMobile && (
        <button
          type="button"
          className="ml-scrim"
          aria-label="Close navigation"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <main className="ml-main" id="main-content" tabIndex={-1}>
        <TopBar
          title={title}
          subtitle={subtitle}
          onOpenMenu={() => setDrawerOpen(true)}
          menuExpanded={drawerOpen}
          search={<GlobalSearch onOpenInstrument={openInstrument} />}
          status={<MarketStatusPill />}
          account={
            <AccountChip
              variant="topbar"
              onOpenProfile={() => navigate("profile")}
              onSignIn={() => setAuthMode("signin")}
            />
          }
        />
        <div className="ml-content">
          <BackendBanner state={backend} />
          <div className="ml-page">{renderPage()}</div>
        </div>
      </main>

      <SignInDialog
        open={authMode !== null && backendOnline}
        mode={authMode ?? "signin"}
        onClose={() => setAuthMode(null)}
      />
    </div>
  );

  return backendOnline ? (
    <RootProvider>{shell}</RootProvider>
  ) : (
    <OfflineRootProvider onRetry={backend.retryNow}>{shell}</OfflineRootProvider>
  );
}
