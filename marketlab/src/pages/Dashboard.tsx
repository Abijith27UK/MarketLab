import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Button, Card, EmptyState } from "@/components/ui";
import SectionHeader from "@/components/ui/section-header";
import DataModeBadge from "@/components/market/DataModeBadge";
import StockCard from "@/components/market/StockCard";
import IndexSummaryCard from "@/components/market/IndexSummaryCard";
import MarketOverviewHeader from "@/components/dashboard/MarketOverviewHeader";
import WatchlistPreview from "@/components/dashboard/WatchlistPreview";
import MoversPanel from "@/components/dashboard/MoversPanel";
import PaperAccountCard from "@/components/dashboard/PaperAccountCard";
import QuickActions from "@/components/dashboard/QuickActions";
import QuoteSourceSelect from "@/components/market/QuoteSourceSelect";
import { useQuotes } from "@/hooks/useQuotes";
import { useSparklines } from "@/hooks/useSparklines";
import { useMarketMovers } from "@/hooks/useMarketMovers";
import { marketApi, type InstrumentRow, type Quote } from "@/lib/marketClient";
import { DEMO_INDICES, DEMO_TOP_STOCKS } from "@/lib/demoCatalogue";
import {
  instrumentIdOf,
  modelFromDemo,
  modelFromQuote,
  type StockCardModel,
} from "@/lib/stockModels";

interface DashboardSections {
  indices: boolean;
  topStocks: boolean;
  watchlist: boolean;
  movers: boolean;
  gainersLosers: boolean;
}

/**
 * Curated "Top stocks" grid. This is a highlight list, not the catalogue's
 * first page: alphabetical order is not a selection criterion. A symbol that is
 * not in the catalogue is reported as unavailable, never replaced.
 */
const FEATURED_SYMBOLS = [
  "RELIANCE",
  "HDFCBANK",
  "ICICIBANK",
  "INFY",
  "TCS",
  "ITC",
  "SBIN",
  "LT",
];

const DEFAULT_SECTIONS: DashboardSections = {
  indices: true,
  topStocks: true,
  watchlist: true,
  movers: true,
  gainersLosers: true,
};

const SECTION_LABEL: Record<keyof DashboardSections, string> = {
  indices: "Market indices",
  topStocks: "Top stocks",
  watchlist: "Watchlist quotes",
  movers: "Movers",
  gainersLosers: "Gainers/Losers of the Day",
};

type DashboardPage =
  | "markets"
  | "watchlists"
  | "portfolio"
  | "screener"
  | "dataSources"
  | "trading"
  | "profile";

interface DashboardProps {
  onNavigate: (page: DashboardPage) => void;
  onOpenInstrument: (instrumentId: string) => void;
  /** Opens the shared auth dialog on the requested tab. */
  onOpenAuth?: (mode: "signin" | "signup") => void;
}

const GridSkeleton: React.FC<{ count: number; compact?: boolean }> = ({ count, compact }) => (
  <div className={compact ? "ml-index-grid" : "ml-stock-grid"} aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="skeleton" style={{ height: compact ? 132 : 196 }} />
    ))}
  </div>
);

const InlineError: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="ml-inline-error" role="alert">
    <span>{message}</span>
    {onRetry ? (
      <button type="button" className="ml-backend-retry" onClick={onRetry}>
        Retry
      </button>
    ) : null}
  </div>
);

/* -------------------------------------------------------------------- live */

export const DashboardLive: React.FC<DashboardProps> = ({
  onNavigate,
  onOpenInstrument,
  onOpenAuth,
}) => {
  const { user, loading, isAuthenticated } = useRootContext();
  const now = useMemo(() => Date.now(), []);
  const [customising, setCustomising] = useState(false);
  const updateProfile = useMutation(api.users.updateProfile);
  const saveQuoteProvider = useMutation(marketApi.setQuoteProvider);

  const sections: DashboardSections = {
    ...DEFAULT_SECTIONS,
    ...(user?.dashboardSections ?? {}),
  };

  const toggleSection = (key: keyof DashboardSections) => {
    const next = { ...sections, [key]: !sections[key] };
    void updateProfile({ dashboardSections: next });
  };

  const session = useQuery(marketApi.marketStatus, {});
  // Six verified NSE index identities (reference data, no equity scan needed).
  const indices = useQuery(marketApi.dashboardIndices, {});
  // Curated highlight grid, resolved in the declared order.
  const stocks = useQuery(marketApi.featuredInstruments, { symbols: FEATURED_SYMBOLS });
  const watchlists = useQuery(api.watchlists.list, {});

  const indexRows = indices?.items ?? [];
  const stockRows = stocks?.items ?? [];
  const missingStocks = stocks?.missing ?? [];
  const movers = useMarketMovers();
  const watchlistIds = useMemo(
    () => (watchlists ?? []).flatMap((list) => list.items.map((item) => item.instrumentId)),
    [watchlists]
  );

  const indexIds = useMemo(
    () => Array.from(new Set(indexRows.map((row) => instrumentIdOf(row)))),
    [indexRows]
  );
  const equityIds = useMemo(
    () =>
      Array.from(
        new Set([...stockRows.map((row) => instrumentIdOf(row)), ...watchlistIds])
      ),
    [stockRows, watchlistIds]
  );
  const sparklines = useSparklines([...indexIds, ...equityIds], { max: 12 });

  // Indices and equities are fetched separately: NSE MCP quotes indices by name
  // through a bulk endpoint, and a mixed batch would spend that budget twice.
  // NSE's current-market feed is server-crawled every few minutes and TejHQ is
  // end-of-day, so a 5-minute nudge is enough; the server cache decides whether
  // a provider call is actually made.
  const indexQuotes = useQuotes(indexIds, { pollMs: 300_000 });
  const equityQuotes = useQuotes(equityIds.slice(0, 40), { pollMs: 300_000 });
  const quotes = equityQuotes;

  const indexQuoteById = useMemo(
    () => new Map((indexQuotes.data?.quotes ?? []).map((quote) => [quote.instrumentId, quote])),
    [indexQuotes.data]
  );
  const quoteById = useMemo(
    () => new Map((equityQuotes.data?.quotes ?? []).map((quote) => [quote.instrumentId, quote])),
    [equityQuotes.data]
  );

  /** A sparkline is only attached when its data mode matches the quote's. */
  const sparkFor = (quote: Quote | null | undefined): number[] => {
    if (!quote) return [];
    const series = sparklines[quote.instrumentId];
    if (!series || series.mode !== quote.mode) return [];
    return series.closes;
  };

  /** Instrument names for the watchlist and movers rows (Quote carries no name). */
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    [...indexRows, ...stockRows].forEach((row) => map.set(instrumentIdOf(row), row.name));
    return map;
  }, [indexRows, stockRows]);

  const toModel = (
    row: InstrumentRow,
    quotesById: Map<string, Quote>
  ): StockCardModel => {
    const id = instrumentIdOf(row);
    const quote = quotesById.get(id) ?? null;
    return modelFromQuote({ ...row, instrumentId: id }, quote, sparkFor(quote));
  };

  const indexModels = useMemo(
    () => indexRows.map((row) => toModel(row, indexQuoteById)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indexRows, indexQuoteById, sparklines]
  );
  const stockModels = useMemo(
    () => stockRows.map((row) => toModel(row, quoteById)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stockRows, quoteById, sparklines]
  );

  /** Indices need NSE MCP; a selected EOD source cannot supply index levels. */
  const indexProviderUnsupported = Boolean(
    indexRows.length > 0 &&
      indexQuotes.data &&
      indexQuotes.data.quoteProvider !== "nsemcp"
  );
  const switchIndicesToNse = async () => {
    await saveQuoteProvider({ provider: "nsemcp" });
    await Promise.all([indexQuotes.refresh(), equityQuotes.refresh()]);
  };

  const quotesLoading = quotes.loading && !quotes.data;
  const showWatchlist = sections.watchlist;
  const moversClass = showWatchlist ? "ml-widget ml-widget--4" : "ml-widget ml-widget--6";
  const paperClass = showWatchlist
    ? "ml-widget ml-widget--4 ml-widget--full-md"
    : "ml-widget ml-widget--6";

  if (loading) {
    return (
      <div className="ml-dash">
        <div className="skeleton" style={{ height: 104, borderRadius: 16 }} aria-hidden="true" />
        <GridSkeleton count={3} compact />
        <GridSkeleton count={6} />
      </div>
    );
  }

  return (
    <div className="ml-dash">
      <MarketOverviewHeader
        demo={false}
        session={session ?? null}
        asOf={quotes.data?.quoteAsOf ?? null}
        retrievedAt={quotes.data?.retrievedAt ?? null}
        mode={quotes.data?.mode ?? null}
        source={quotes.data?.source ?? null}
        note={quotes.data?.warning ?? quotes.data?.note ?? null}
        now={now}
      />

      <div className="ml-dash-toolbar">
        <QuoteSourceSelect onChanged={() => void quotes.refresh()} />
        {isAuthenticated ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCustomising((open) => !open)}
            aria-expanded={customising}
          >
            {customising ? "Done customising" : "Customise sections"}
          </Button>
        ) : null}
      </div>

      {customising && isAuthenticated ? (
        <div className="ml-customise-panel" role="group" aria-label="Dashboard sections">
          <p className="ml-section-sub">
            Choose which sections appear. Preferences are saved to your profile.
          </p>
          <div className="ml-customise-options">
            {(Object.keys(SECTION_LABEL) as (keyof DashboardSections)[]).map((key) => (
              <label key={key} className="ml-customise-option">
                <input type="checkbox" checked={sections[key]} onChange={() => toggleSection(key)} />
                {SECTION_LABEL[key]}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {sections.indices ? (
        <section className="ml-dash-section">
          <SectionHeader
            title="Market indices"
            description="Index levels reported by your selected quote source. Index values are points, not rupee prices."
            actions={
              indexQuotes.data ? (
                <DataModeBadge
                  mode={indexQuotes.data.mode}
                  asOf={indexQuotes.data.quoteAsOf}
                />
              ) : null
            }
          />
          {indexQuotes.error ? (
            <InlineError
              message={`Could not load index quotes: ${indexQuotes.error}`}
              onRetry={indexQuotes.refresh}
            />
          ) : null}
          {indices === undefined || (indexQuotes.loading && !indexQuotes.data) ? (
            <GridSkeleton count={3} compact />
          ) : indexModels.length === 0 ? (
            <EmptyState
              title="No index instruments yet"
              description="The verified NSE index list is unavailable on this deployment."
              action={
                <Button variant="secondary" size="sm" onClick={() => onNavigate("dataSources")}>
                  Open data sources
                </Button>
              }
            />
          ) : indexProviderUnsupported ? (
            <Card className="ml-indices-unsupported">
              <p className="ml-indices-unsupported__title">
                {isAuthenticated
                  ? "TejHQ does not provide NSE index levels"
                  : "Indices require NSE MCP (sign in to select it)"}
              </p>
              <p className="ml-section-sub">
                TejHQ is an end-of-day equity source. MarketLab will not relabel NSE
                index data as TejHQ. Switch the quote source to NSE MCP to load
                verified NIFTY levels; Market Movers already uses official NSE MCP
                rankings regardless of this setting.
              </p>
              <div className="ml-indices-unsupported__actions">
                <Button
                  size="sm"
                  onClick={() => void switchIndicesToNse()}
                  disabled={!isAuthenticated}
                >
                  Use NSE MCP for indices
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onNavigate("dataSources")}
                >
                  Data sources
                </Button>
              </div>
              {isAuthenticated ? null : (
                <p className="ml-section-sub">
                  Sign in, then choose NSE MCP in the quote-source selector.
                </p>
              )}
            </Card>
          ) : (
            <div className="ml-index-grid">
              {indexModels.map((model) => (
                <IndexSummaryCard
                  key={model.instrumentId}
                  model={model}
                  onOpen={onOpenInstrument}
                  now={now}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {sections.topStocks ? (
        <section className="ml-dash-section">
          <SectionHeader
            title="Top stocks"
            description="Selected NSE large caps from the instrument catalogue. Open a card for charts, indicators and fundamentals."
            actions={
              <div className="flex flex-wrap items-center gap-3">
                {quotes.data ? (
                  <DataModeBadge mode={quotes.data.mode} asOf={quotes.data.quoteAsOf} />
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => onNavigate("markets")}>
                  Browse all stocks →
                </Button>
              </div>
            }
          />
          {missingStocks.length > 0 ? (
            <p className="ml-section-sub">
              Not in the catalogue yet: {missingStocks.join(", ")}. Sync the instrument
              master to show these companies.
            </p>
          ) : null}
          {stocks === undefined || quotesLoading ? (
            <GridSkeleton count={6} />
          ) : stockModels.length === 0 ? (
            <EmptyState
              title="The instrument catalogue is empty"
              description="Seed the sample catalogue or sync a provider to populate this grid."
              action={
                <Button variant="secondary" size="sm" onClick={() => onNavigate("dataSources")}>
                  Open data sources
                </Button>
              }
            />
          ) : (
            <div className="ml-stock-grid">
              {stockModels.map((model) => (
                <StockCard
                  key={model.instrumentId}
                  model={model}
                  onOpen={onOpenInstrument}
                  now={now}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <div className="ml-dash-widgets">
        {showWatchlist ? (
          <WatchlistPreview
            className="ml-widget ml-widget--4"
            authenticated={isAuthenticated}
            loading={watchlists === undefined}
            name={watchlists?.[0]?.name}
            ids={watchlistIds}
            quoteById={quoteById}
            nameById={nameById}
            mode={quotes.data?.mode ?? null}
            asOf={quotes.data?.asOf ?? null}
            now={now}
            onOpen={onOpenInstrument}
            onManage={() => onNavigate("watchlists")}
            onSignIn={() => onNavigate("profile")}
            onBrowse={() => onNavigate("markets")}
          />
        ) : null}

        {sections.movers ? (
          <MoversPanel
            className={moversClass}
            data={movers.data}
            loading={movers.loading}
            error={movers.error}
            now={now}
            onRetry={movers.refresh}
            onOpen={onOpenInstrument}
          />
        ) : null}

        <PaperAccountCard
          className={paperClass}
          authenticated={isAuthenticated}
          onOpenAuth={(mode) => onOpenAuth?.(mode)}
          onNavigate={onNavigate}
        />
      </div>

      <QuickActions onNavigate={onNavigate} />
    </div>
  );
};

/* -------------------------------------------------------------------- demo */

export const DashboardDemo: React.FC<DashboardProps> = ({ onNavigate, onOpenInstrument }) => {
  const now = useMemo(() => Date.now(), []);

  const indexModels = useMemo(
    () => DEMO_INDICES.map((instrument) => modelFromDemo(instrument, now, 20)),
    [now]
  );
  const stockModels = useMemo(
    () => DEMO_TOP_STOCKS.map((instrument) => modelFromDemo(instrument, now, 24)),
    [now]
  );

  return (
    <div className="ml-dash">
      <MarketOverviewHeader
        demo
        session={null}
        asOf={null}
        mode="SAMPLE"
        source="sample"
        note="no provider connected — sample series only"
        now={now}
      />

      <section className="ml-dash-section">
        <SectionHeader
          title="Market indices"
          description="Sample series only — no provider is reachable, so these are not real index levels."
          actions={<DataModeBadge mode="SAMPLE" source="sample" />}
        />
        <div className="ml-index-grid">
          {indexModels.map((model) => (
            <IndexSummaryCard
              key={model.instrumentId}
              model={model}
              onOpen={onOpenInstrument}
              now={now}
            />
          ))}
        </div>
      </section>

      <section className="ml-dash-section">
        <SectionHeader
          title="Top stocks"
          description="Deterministic sample cards so the interface stays usable offline. Each card opens a full chart view."
          actions={<DataModeBadge mode="SAMPLE" source="sample" />}
        />
        <div className="ml-stock-grid">
          {stockModels.map((model) => (
            <StockCard
              key={model.instrumentId}
              model={model}
              onOpen={onOpenInstrument}
              now={now}
            />
          ))}
        </div>
      </section>

      <div className="ml-dash-widgets">
        <Card className="ml-span-12">
          <SectionHeader
            title="Account features are paused"
            description="These need the Convex backend, so nothing is shown rather than inventing values."
          />
          <ul className="ml-paused-list">
            <li>
              <strong>Paper account</strong> — balances are not displayed because none were loaded.
            </li>
            <li>
              <strong>Watchlists</strong> — saved lists stay in Convex and return when the backend
              does.
            </li>
            <li>
              <strong>Screener &amp; saved filters</strong> — server-side filters need the backend.
            </li>
            <li>
              <strong>Provider connection tests</strong> — credentials live in the Convex
              deployment, never in the browser.
            </li>
          </ul>
        </Card>
      </div>

      <QuickActions onNavigate={onNavigate} />
    </div>
  );
};

/* ------------------------------------------------------------------ router */

const Dashboard: React.FC<DashboardProps> = (props) => {
  const { backendOnline } = useRootContext();
  return backendOnline ? <DashboardLive {...props} /> : <DashboardDemo {...props} />;
};

export default Dashboard;
