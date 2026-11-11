import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Button } from "@/components/ui";
import AuthPanel from "@/components/AuthPanel";
import DataModeBadge from "@/components/market/DataModeBadge";
import StockCard from "@/components/market/StockCard";
import { useQuotes } from "@/hooks/useQuotes";
import { useSparklines } from "@/hooks/useSparklines";
import { marketApi, type InstrumentRow, type Quote } from "@/lib/marketClient";
import {
  DEMO_INDICES,
  DEMO_TOP_STOCKS,
  parseInstrumentId,
} from "@/lib/demoCatalogue";
import {
  instrumentIdOf,
  modelFromDemo,
  modelFromQuote,
  type StockCardModel,
} from "@/lib/stockModels";
import {
  formatAge,
  formatInr,
  formatPercent,
  formatPrice,
  formatSignedInr,
  formatVolume,
  toneClass,
} from "@/lib/format";

interface DashboardSections {
  indices: boolean;
  topStocks: boolean;
  watchlist: boolean;
  movers: boolean;
}

const DEFAULT_SECTIONS: DashboardSections = {
  indices: true,
  topStocks: true,
  watchlist: true,
  movers: true,
};

const SECTION_LABEL: Record<keyof DashboardSections, string> = {
  indices: "Market indices",
  topStocks: "Top stocks",
  watchlist: "Watchlist quotes",
  movers: "Movers",
};

interface DashboardProps {
  onNavigate: (
    page: "markets" | "watchlists" | "portfolio" | "screener" | "dataSources" | "trading"
  ) => void;
  onOpenInstrument: (instrumentId: string) => void;
}

/* ---------------------------------------------------------------- headings */

const MarketOverviewHeading: React.FC<{
  session: { label: string; istDate: string; istTime: string; holidaysConfigured: boolean } | null;
  demo: boolean;
}> = ({ session, demo }) => (
  <header className="ml-page-head">
    <div>
      <h1 className="ml-page-title">Market Overview</h1>
      <p className="ml-page-sub">
        Indian equities, indices and your saved research in one terminal. Every value carries its
        data mode — nothing is described as live unless the source says it is.
      </p>
      {demo && (
        <p className="ml-demo-chip" data-testid="demo-chip">
          <span aria-hidden="true">◇</span> SAMPLE DATA — deterministic demo series, not Indian
          market data
        </p>
      )}
    </div>
    <div className="ml-page-head-side">
      {session ? (
        <>
          <p className="text-sm text-gray-300">{session.label}</p>
          <p className="text-xs text-gray-500">
            {session.istDate} · {session.istTime} IST
          </p>
          {!session.holidaysConfigured && (
            <p className="text-xs text-amber-400/80">Holiday calendar not configured</p>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-500">
          {demo ? "Session status unavailable without a backend" : "Loading session status…"}
        </p>
      )}
    </div>
  </header>
);

const SectionHeading: React.FC<{
  title: string;
  description?: string;
  right?: React.ReactNode;
}> = ({ title, description, right }) => (
  <div className="ml-section-head">
    <div>
      <h2 className="ml-section-title">{title}</h2>
      {description && <p className="ml-section-sub">{description}</p>}
    </div>
    {right}
  </div>
);

const CardSkeletons: React.FC<{ count: number; compact?: boolean }> = ({ count, compact }) => (
  <div className={compact ? "ml-index-grid" : "ml-stock-grid"} aria-hidden="true">
    {Array.from({ length: count }).map((_, index) => (
      <div
        key={index}
        className={`skeleton rounded-xl ${compact ? "h-32" : "h-48"}`}
        data-testid="stock-card-skeleton"
      />
    ))}
  </div>
);

const InlineError: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="ml-inline-error" role="alert">
    <span>{message}</span>
    {onRetry && (
      <button type="button" className="ml-backend-retry" onClick={onRetry}>
        Retry
      </button>
    )}
  </div>
);

const StockGrid: React.FC<{
  models: StockCardModel[];
  onOpen: (instrumentId: string) => void;
  now: number;
  emptyMessage: string;
}> = ({ models, onOpen, now, emptyMessage }) =>
  models.length === 0 ? (
    <p className="ml-empty">{emptyMessage}</p>
  ) : (
    <div className="ml-stock-grid">
      {models.map((model) => (
        <StockCard key={model.instrumentId} model={model} onOpen={onOpen} now={now} />
      ))}
    </div>
  );

/* -------------------------------------------------------------------- live */

export const DashboardLive: React.FC<DashboardProps> = ({ onNavigate, onOpenInstrument }) => {
  const { user, loading, isAuthenticated } = useRootContext();
  const now = useMemo(() => Date.now(), []);
  const [customising, setCustomising] = useState(false);
  const updateProfile = useMutation(api.users.updateProfile);
  const sections: DashboardSections = {
    ...DEFAULT_SECTIONS,
    ...(user?.dashboardSections ?? {}),
  };

  const toggleSection = (key: keyof DashboardSections) => {
    const next = { ...sections, [key]: !sections[key] };
    void updateProfile({ dashboardSections: next });
  };

  const session = useQuery(marketApi.marketStatus, {});
  const indices = useQuery(marketApi.searchInstruments, {
    instrumentType: "INDEX",
    exchange: "ALL",
    limit: 8,
  });
  const stocks = useQuery(marketApi.searchInstruments, {
    instrumentType: "EQUITY",
    exchange: "NSE",
    limit: 10,
  });
  const watchlists = useQuery(api.watchlists.list, {});

  const indexRows = indices?.items ?? [];
  const stockRows = stocks?.items ?? [];
  const watchlistIds = useMemo(
    () => (watchlists ?? []).flatMap((list) => list.items.map((item) => item.instrumentId)),
    [watchlists]
  );

  const quoteIds = useMemo(() => {
    const ids = [
      ...indexRows.map((row) => instrumentIdOf(row)),
      ...stockRows.map((row) => instrumentIdOf(row)),
      ...watchlistIds,
    ];
    return Array.from(new Set(ids));
  }, [indexRows, stockRows, watchlistIds]);

  const quotes = useQuotes(quoteIds.slice(0, 40), { pollMs: 60_000 });
  const sparklines = useSparklines(quoteIds, { max: 12 });

  const quoteById = useMemo(
    () => new Map((quotes.data?.quotes ?? []).map((quote) => [quote.instrumentId, quote])),
    [quotes.data]
  );

  /** A sparkline is only attached when its data mode matches the quote's. */
  const sparkFor = (quote: Quote | null | undefined): number[] => {
    if (!quote) return [];
    const series = sparklines[quote.instrumentId];
    if (!series || series.mode !== quote.mode) return [];
    return series.closes;
  };

  const toModel = (row: InstrumentRow): StockCardModel => {
    const id = instrumentIdOf(row);
    const quote = quoteById.get(id) ?? null;
    return modelFromQuote({ ...row, instrumentId: id }, quote, sparkFor(quote));
  };

  const indexModels = useMemo(
    () => indexRows.map(toModel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indexRows, quoteById, sparklines]
  );
  const stockModels = useMemo(
    () => stockRows.map(toModel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stockRows, quoteById, sparklines]
  );

  const trackedQuotes = Array.from(quoteById.values());
  const realQuotes = trackedQuotes.filter((quote) => quote.mode !== "SAMPLE");
  const ranked = [...realQuotes].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
  const gainers = ranked.slice(0, 3);
  const losers = ranked.slice(-3).reverse();
  const canRank = realQuotes.length >= 5;

  if (loading) {
    return (
      <div className="p-4 md:p-6">
        <div className="skeleton mb-4 h-16 w-64 rounded-md" />
        <CardSkeletons count={3} compact />
      </div>
    );
  }

  const watchlistName = watchlists?.[0]?.name;
  const quotesLoading = quotes.loading && !quotes.data;

  return (
    <div className="p-4 md:p-6">
      <MarketOverviewHeading session={session ?? null} demo={false} />

      {isAuthenticated && (
        <div className="mb-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCustomising((open) => !open)}
            aria-expanded={customising}
          >
            {customising ? "Done customising" : "Customise dashboard"}
          </Button>
          {customising && (
            <div className="ml-customise-panel" role="group" aria-label="Dashboard sections">
              <p className="ml-section-sub">
                Choose which sections appear. Preferences are saved to your profile.
              </p>
              <div className="ml-customise-options">
                {(Object.keys(SECTION_LABEL) as (keyof DashboardSections)[]).map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={sections[key]}
                      onChange={() => toggleSection(key)}
                    />
                    {SECTION_LABEL[key]}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {sections.indices && (
      <section className="mb-8">
        <SectionHeading
          title="Market indices"
          description="Index levels reported by the configured data source."
          right={quotes.data ? <DataModeBadge mode={quotes.data.mode} /> : null}
        />
        {quotes.error && (
          <InlineError message={`Could not load quotes: ${quotes.error}`} onRetry={quotes.refresh} />
        )}
        {indices === undefined || quotesLoading ? (
          <CardSkeletons count={3} compact />
        ) : indexModels.length === 0 ? (
          <p className="ml-empty">
            No index instruments in the catalogue yet. Configure a data provider or sync the
            instrument master on the Data Sources page.
          </p>
        ) : (
          <div className="ml-index-grid">
            {indexModels.map((model) => (
              <StockCard
                key={model.instrumentId}
                model={model}
                onOpen={onOpenInstrument}
                now={now}
                compact
              />
            ))}
          </div>
        )}
      </section>
      )}

      {sections.topStocks && (
      <section className="mb-8">
        <SectionHeading
          title="Top stocks"
          description="Selected NSE large caps from the instrument catalogue. Tap a card for charts, indicators and fundamentals."
          right={quotes.data ? <DataModeBadge mode={quotes.data.mode} /> : null}
        />
        {stocks === undefined || quotesLoading ? (
          <CardSkeletons count={6} />
        ) : (
          <StockGrid
            models={stockModels}
            onOpen={onOpenInstrument}
            now={now}
            emptyMessage="The instrument catalogue is empty. Seed the sample catalogue or sync a provider."
          />
        )}
      </section>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <SectionHeading
            title="Paper account"
            description="Simulated · persisted in Convex"
          />
          {!isAuthenticated || !user ? (
            <div className="mt-2">
              <p className="mb-3 text-sm text-gray-400">
                Sign in to create a simulated ₹1,00,000 account. No trades are executed and live
                trading stays disabled.
              </p>
              <AuthPanel />
            </div>
          ) : (
            <PaperAccountPanel onNavigate={onNavigate} />
          )}
        </Card>

        {sections.watchlist && (
        <Card>
          <SectionHeading
            title={watchlistName ? `${watchlistName} quotes` : "Watchlist quotes"}
            right={
              <Button variant="secondary" size="sm" onClick={() => onNavigate("watchlists")}>
                Manage
              </Button>
            }
          />
          {!isAuthenticated ? (
            <p className="text-sm text-gray-500">Sign in to keep persistent watchlists.</p>
          ) : watchlistIds.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-sm text-gray-400">No watchlist instruments yet.</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => onNavigate("markets")}
              >
                Browse markets
              </Button>
            </div>
          ) : (
            <ul className="space-y-2">
              {watchlistIds.slice(0, 6).map((id) => {
                const quote = quoteById.get(id);
                const parsed = parseInstrumentId(id);
                return (
                  <li key={id} className="flex items-center justify-between text-sm">
                    <button
                      className="text-gray-200 hover:text-emerald-300"
                      onClick={() => onOpenInstrument(id)}
                    >
                      {parsed?.symbol ?? id}
                    </button>
                    <span className="flex items-center gap-3">
                      <span className="ml-mono text-gray-300">{formatPrice(quote?.lastPrice)}</span>
                      <span className={`ml-mono text-xs ${toneClass(quote?.changePercent)}`}>
                        {formatPercent(quote?.changePercent)}
                      </span>
                      {quote && <DataModeBadge mode={quote.mode} />}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        )}

        {sections.movers && (
        <Card>
          <SectionHeading title="Movers" description="Ranked from non-sample quotes only" />
          {!canRank ? (
            <div className="py-4 text-center text-sm text-gray-500">
              <p>Not enough real source data to rank movers.</p>
              <p className="mt-1 text-xs">
                Rankings appear once at least five tracked instruments have non-sample quotes.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Gainers</p>
                <ul className="space-y-1">
                  {gainers.map((quote) => (
                    <li key={quote.instrumentId} className="flex justify-between">
                      <span>{quote.symbol}</span>
                      <span className="text-emerald-400">{formatPercent(quote.changePercent)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Losers</p>
                <ul className="space-y-1">
                  {losers.map((quote) => (
                    <li key={quote.instrumentId} className="flex justify-between">
                      <span>{quote.symbol}</span>
                      <span className="text-red-400">{formatPercent(quote.changePercent)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {trackedQuotes.length > 0 && (
            <p className="mt-3 text-xs text-gray-600">
              {realQuotes.length} non-sample quotes · refreshed{" "}
              {formatAge(quotes.data?.asOf, Date.now())} ·{" "}
              {formatVolume(trackedQuotes.reduce((sum, quote) => sum + (quote.volume ?? 0), 0))}{" "}
              tracked volume
            </p>
          )}
        </Card>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Button variant="primary" onClick={() => onNavigate("markets")}>
          Markets
        </Button>
        <Button variant="secondary" onClick={() => onNavigate("screener")}>
          Stock Screener
        </Button>
        <Button variant="secondary" onClick={() => onNavigate("dataSources")}>
          Data Sources
        </Button>
        <Button variant="secondary" onClick={() => onNavigate("trading")}>
          Paper Trading
        </Button>
      </div>
    </div>
  );
};

/**
 * Concise paper-account summary on the dashboard.
 * Values come from the ledger-backed summary query; nothing is invented when
 * the account does not exist yet.
 */
const PaperAccountPanel: React.FC<{ onNavigate: DashboardProps["onNavigate"] }> = ({
  onNavigate,
}) => {
  const summary = useQuery(api.paper.summary, {});
  if (summary === undefined) return <p className="text-sm text-gray-500">Loading paper account…</p>;
  if (summary === null) {
    return (
      <p className="text-sm text-gray-400">
        No paper account yet — it is created when you open the Trading page.
      </p>
    );
  }
  const { totals } = summary;
  return (
    <>
      <dl className="ml-dash-stats">
        <div>
          <dt>Account value</dt>
          <dd className="ml-mono text-xl font-bold">{formatInr(totals.equity)}</dd>
        </div>
        <div>
          <dt>Total P&amp;L</dt>
          <dd className={`ml-mono text-xl font-bold ${toneClass(totals.totalPnl)}`}>
            {formatSignedInr(totals.totalPnl)}
          </dd>
        </div>
        <div>
          <dt>Spendable cash</dt>
          <dd className="ml-mono text-base">{formatInr(totals.spendableCash)}</dd>
        </div>
        <div>
          <dt>Positions</dt>
          <dd className="ml-mono text-base">{summary.positions.length}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-gray-500">
        Simulated · {summary.openOrderCount} open order(s)
        {totals.mode ? " · position prices " : ""}
        {totals.mode && <DataModeBadge mode={totals.mode} />}
      </p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => onNavigate("portfolio")}>
        View portfolio
      </Button>
    </>
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
    <div className="p-4 md:p-6">
      <MarketOverviewHeading session={null} demo />

      <section className="mb-8">
        <SectionHeading
          title="Market indices"
          description="Sample series only — no provider is reachable, so these are not real index levels."
          right={<DataModeBadge mode="SAMPLE" source="sample" />}
        />
        <div className="ml-index-grid">
          {indexModels.map((model) => (
            <StockCard
              key={model.instrumentId}
              model={model}
              onOpen={onOpenInstrument}
              now={now}
              compact
            />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <SectionHeading
          title="Top stocks"
          description="Deterministic sample cards so the interface stays usable offline. Each card opens a full chart view."
          right={<DataModeBadge mode="SAMPLE" source="sample" />}
        />
        <StockGrid
          models={stockModels}
          onOpen={onOpenInstrument}
          now={now}
          emptyMessage="No sample instruments available."
        />
      </section>

      <Card className="mb-6">
        <SectionHeading
          title="Account features are paused"
          description="These need the Convex backend, so nothing is shown rather than inventing values."
        />
        <ul className="ml-paused-list">
          <li>
            <strong>Paper account</strong> — balances are not displayed because none were loaded.
          </li>
          <li>
            <strong>Watchlists</strong> — saved lists stay in Convex and return when the backend does.
          </li>
          <li>
            <strong>Screener &amp; saved filters</strong> — server-side filters need the backend.
          </li>
          <li>
            <strong>Provider connection tests</strong> — credentials live in the Convex deployment,
            never in the browser.
          </li>
        </ul>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Button variant="primary" onClick={() => onNavigate("markets")}>
          Markets
        </Button>
        <Button variant="secondary" onClick={() => onNavigate("screener")}>
          Stock Screener
        </Button>
        <Button variant="secondary" onClick={() => onNavigate("dataSources")}>
          Data Sources
        </Button>
        <Button variant="secondary" onClick={() => onNavigate("trading")}>
          Paper Trading
        </Button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ router */

const Dashboard: React.FC<DashboardProps> = (props) => {
  const { backendOnline } = useRootContext();
  return backendOnline ? <DashboardLive {...props} /> : <DashboardDemo {...props} />;
};

export default Dashboard;
