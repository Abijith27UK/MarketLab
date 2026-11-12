import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Button, Card } from "@/components/ui";
import SectionHeader from "@/components/ui/section-header";
import AuthPanel from "@/components/AuthPanel";
import BackendRequired from "@/components/system/BackendRequired";
import PaperSummary from "@/components/paper/PaperSummary";
import PositionsTable from "@/components/paper/PositionsTable";
import OrdersTable from "@/components/paper/OrdersTable";
import OrderTicket, { type TicketSubmission } from "@/components/paper/OrderTicket";
import PriceChart from "@/components/chart/PriceChart";
import DataModeBadge from "@/components/market/DataModeBadge";
import PriceChange from "@/components/market/PriceChange";
import { useQuotes } from "@/hooks/useQuotes";
import {
  INTERVALS,
  INTERVAL_LABEL,
  marketApi,
  type CandleResult,
  type IndicatorConfig,
  type Interval,
} from "@/lib/marketClient";
import { instrumentIdOf } from "@/lib/stockModels";
import { formatAge, formatPrice, formatSignedInr, formatVolume, toneClass } from "@/lib/format";

interface TradingProps {
  onOpenInstrument: (instrumentId: string) => void;
}

/** Stable identity so the chart's series effect does not rebuild every render. */
const TRADE_INDICATORS: IndicatorConfig[] = [{ name: "SMA", enabled: true, period: 20 }];

/**
 * Simulated order entry.
 *
 * The ticket never decides a fill: it sends a validated request and the backend
 * prices it against an eligible, labelled quote. Every balance shown here comes
 * from `paper.summary`, which is derived from the ledger.
 */
const TradingLive: React.FC<TradingProps> = ({ onOpenInstrument }) => {
  const { isAuthenticated, loading } = useRootContext();
  const summary = useQuery(api.paper.summary, {});
  const orders = useQuery(api.paper.orders, { limit: 25 });
  const ensureAccount = useMutation(api.paper.ensureAccount);
  const placeOrder = useMutation(api.paper.placeOrder);
  const cancelOrder = useMutation(api.paper.cancelOrder);
  const recheckOrder = useMutation(api.paper.recheckOrder);
  const getCandles = useAction(marketApi.getCandles);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedInstrumentId, setSelectedInstrumentId] = useState("");
  const [chartInterval, setChartInterval] = useState<Interval>("1d");
  const [series, setSeries] = useState<CandleResult | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const results = useQuery(marketApi.searchInstruments, {
    search: debouncedSearch,
    exchange: "NSE",
    instrumentType: "EQUITY",
    limit: 20,
  });

  const instruments = useMemo(
    () =>
      (results?.items ?? []).map((row) => ({
        instrumentId: instrumentIdOf(row),
        symbol: row.symbol,
        name: row.name,
        exchange: row.exchange,
      })),
    [results]
  );

  // Keep a valid selection as the search result set changes.
  useEffect(() => {
    if (instruments.length === 0) return;
    if (instruments.some((instrument) => instrument.instrumentId === selectedInstrumentId)) return;
    setSelectedInstrumentId(instruments[0].instrumentId);
  }, [instruments, selectedInstrumentId]);

  useEffect(() => {
    if (!isAuthenticated || summary !== null) return;
    ensureAccount({}).catch((error) =>
      setPageError(error instanceof Error ? error.message : "Could not create the paper account")
    );
  }, [ensureAccount, isAuthenticated, summary]);

  const quotes = useQuotes(selectedInstrumentId ? [selectedInstrumentId] : [], {
    pollMs: 30_000,
    enabled: isAuthenticated,
  });
  const quote = quotes.data?.quotes[0] ?? null;

  const position = summary?.positions.find((item) => item.instrumentId === selectedInstrumentId);
  const selected = instruments.find((item) => item.instrumentId === selectedInstrumentId) ?? null;

  // Candles for the selected instrument, ignoring responses that arrive late.
  useEffect(() => {
    if (!selectedInstrumentId) {
      setSeries(null);
      setSeriesError(null);
      return;
    }
    const request = requestRef.current + 1;
    requestRef.current = request;
    setSeriesLoading(true);
    setSeriesError(null);
    getCandles({ instrumentId: selectedInstrumentId, interval: chartInterval })
      .then((result) => {
        if (requestRef.current === request) setSeries(result);
      })
      .catch((error) => {
        if (requestRef.current !== request) return;
        setSeries(null);
        setSeriesError(error instanceof Error ? error.message : "Could not load candles");
      })
      .finally(() => {
        if (requestRef.current === request) setSeriesLoading(false);
      });
  }, [chartInterval, getCandles, selectedInstrumentId]);

  const submitOrder = async (submission: TicketSubmission) => {
    setSubmitting(true);
    setPageError(null);
    setPageNotice(null);
    try {
      const result = await placeOrder(submission);
      if (result.status === "REJECTED") {
        return { ok: false as const, message: result.reason ?? "The order was rejected." };
      }
      if (result.status === "OPEN") {
        return {
          ok: true as const,
          message:
            "Limit order rests as OPEN — it will not fill automatically. Use Re-check or Cancel in the history below.",
        };
      }
      const price = result.filledPrice === null ? "—" : `₹${formatPrice(result.filledPrice)}`;
      return {
        ok: true as const,
        message: `Filled ${result.duplicate ? "(existing order) " : ""}at ${price} · ${
          result.fillMode ?? "unlabelled"
        }${result.fillSource ? ` · ${result.fillSource}` : ""}.`,
      };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "The order could not be placed.",
      };
    } finally {
      setSubmitting(false);
    }
  };

  const actOnOrder = async (orderId: string, action: "cancel" | "recheck") => {
    setBusyOrderId(orderId);
    setPageError(null);
    setPageNotice(null);
    try {
      const result =
        action === "cancel"
          ? await cancelOrder({ orderId: orderId as never })
          : await recheckOrder({ orderId: orderId as never });
      setPageNotice(
        result.status === "FILLED"
          ? "The limit condition is now met — the order filled and the ledger was updated."
          : result.reason ?? `Order ${result.status.toLowerCase()}.`
      );
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "That action failed.");
    } finally {
      setBusyOrderId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-4 md:p-6" aria-busy="true">
        <span className="skeleton" style={{ display: "block", height: 26, width: 160 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 96 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 320 }} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="ml-page-title">Trading</h1>
        <p className="ml-page-sub">
          Simulated order entry. Sign in to create a paper account — no broker is connected and no
          real order can be placed.
        </p>
        <Card className="mt-5 max-w-md">
          <AuthPanel />
        </Card>
      </div>
    );
  }

  if (summary === undefined) {
    return (
      <div className="p-4 md:p-6" aria-busy="true">
        <span className="skeleton" style={{ display: "block", height: 96 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 320 }} />
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="ml-page-title">Trading</h1>
        <p className="ml-page-sub">
          Creating your simulated account with ₹1,00,000 of virtual capital…
        </p>
        {pageError && (
          <p className="ml-field-error mt-3" role="alert">
            {pageError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="ml-page-title">Trading</h1>
          <p className="ml-page-sub">
            Paper orders against labelled prices. Cash, positions and P&amp;L are computed by the
            backend and persisted in an auditable ledger.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="ml-badge">PAPER ONLY</span>
          <span className="text-[11px] text-[var(--text-3)]">
            Live trading stays disabled until a broker is connected.
          </span>
        </div>
      </header>

      <PaperSummary summary={summary} compact />

      {pageError && (
        <p className="ml-field-error mt-3" role="alert">
          {pageError}
        </p>
      )}
      {pageNotice && (
        <p className="ml-ticket__notice mt-3" role="status">
          {pageNotice}
        </p>
      )}

      <div className="ml-trade-grid mt-5">
        <div className="ml-trade-main">
          <Card>
            <div className="ml-trade-ctx">
              <div className="min-w-0">
                <div className="ml-detail-tags">
                  <h2 className="ml-trade-ctx__symbol">
                    {selected?.symbol ?? "Choose an instrument"}
                  </h2>
                  {selected && (
                    <span className="ml-data-table__exchange">{selected.exchange}</span>
                  )}
                  {quote && <DataModeBadge mode={quote.mode} source={quote.source} />}
                </div>
                <p className="ml-detail-name">
                  {selected?.name ?? "Search on the right, then pick a stock to simulate an order."}
                </p>
                {position ? (
                  <p className="ml-trade-ctx__meta">
                    Holding {position.quantity} @ ₹{formatPrice(position.averageCost)} ·{" "}
                    <span className={toneClass(position.unrealizedPnl)}>
                      {formatSignedInr(position.unrealizedPnl)}
                    </span>
                  </p>
                ) : (
                  <p className="ml-trade-ctx__meta">No open position in this instrument.</p>
                )}
              </div>

              <div className="ml-detail-quote">
                <span className={`ml-detail-quote__price ml-mono ${toneClass(quote?.change)}`}>
                  {quote ? `₹${formatPrice(quote.lastPrice)}` : "—"}
                </span>
                {quote ? (
                  <PriceChange
                    change={quote.change}
                    changePercent={quote.changePercent}
                    showAbsolute
                  />
                ) : (
                  <span className="text-[11px] text-[var(--text-3)]">
                    {quotes.loading ? "Loading quote…" : "No quote available"}
                  </span>
                )}
                {quote && (
                  <span className="ml-detail-quote__meta">
                    Vol {formatVolume(quote.volume)} ·{" "}
                    {formatAge(quote.quoteTime, Date.now())}
                  </span>
                )}
                {selected && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenInstrument(selectedInstrumentId)}
                  >
                    Open chart
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="ml-chip-row mt-4" role="group" aria-label="Chart timeframe">
            {INTERVALS.map((choice) => (
              <button
                key={choice}
                type="button"
                className="ml-chip"
                aria-pressed={chartInterval === choice}
                onClick={() => setChartInterval(choice)}
              >
                {INTERVAL_LABEL[choice]}
              </button>
            ))}
          </div>

          <div className="mt-3">
            <PriceChart
              title={`${selected?.symbol ?? "Instrument"} · ${INTERVAL_LABEL[chartInterval]}`}
              subtitle={
                series
                  ? `${series.quality.rowCount} candles · ${series.quality.gaps} gaps · source ${series.source}`
                  : undefined
              }
              candles={series?.candles ?? []}
              interval={chartInterval}
              chartType="candlestick"
              indicators={TRADE_INDICATORS}
              mode={series?.mode ?? "SAMPLE"}
              source={series?.source ?? "sample"}
              loading={seriesLoading}
              error={seriesError}
              emptyMessage="No candles are available for this instrument yet."
              height={340}
            />
          </div>

          <Card className="mt-4">
            <SectionHeader
              title="Your holdings"
              description="Valued at the eligible price for each instrument, with its freshness label."
              actions={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenInstrument(selectedInstrumentId)}
                  disabled={!selectedInstrumentId}
                >
                  Open chart
                </Button>
              }
            />
            <div className="mt-3">
              <PositionsTable
                positions={summary.positions}
                onOpenInstrument={onOpenInstrument}
                emptyMessage="Filled buys appear here. Place a paper order to open your first position."
              />
            </div>
          </Card>
        </div>

        <div className="ml-trade-side">
          <OrderTicket
            instruments={instruments}
            search={search}
            onSearch={setSearch}
            selectedInstrumentId={selectedInstrumentId}
            onSelectInstrument={setSelectedInstrumentId}
            quote={quote}
            quoteLoading={quotes.loading && !quotes.data}
            availableCash={summary.totals.availableCash}
            reservedCash={summary.totals.reservedCash}
            sellableQuantity={position?.quantity ?? 0}
            sampleFillsEnabled={summary.sampleFillsEnabled}
            submitting={submitting}
            onSubmit={submitOrder}
          />
        </div>
      </div>

      <section className="mt-5">
        <Card>
          <SectionHeader
            title="Order history"
            description="Rejected and cancelled orders are kept so every balance change stays explainable. Nothing here was sent to a broker."
          />
          <div className="mt-3">
            {orders === undefined ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                {Array.from({ length: 4 }).map((_, index) => (
                  <span key={index} className="skeleton" style={{ height: 32 }} />
                ))}
              </div>
            ) : (
              <OrdersTable
                orders={orders}
                busyOrderId={busyOrderId}
                onCancel={(orderId) => void actOnOrder(orderId, "cancel")}
                onRecheck={(orderId) => void actOnOrder(orderId, "recheck")}
                emptyMessage="No simulated orders yet. Use the ticket to place one."
              />
            )}
          </div>
        </Card>
      </section>
    </div>
  );
};

const Trading: React.FC<TradingProps> = (props) => {
  const { backendOnline } = useRootContext();
  if (!backendOnline) {
    return (
      <BackendRequired
        feature="Paper trading"
        description="Orders, positions and the fill ledger are stored per user in Convex. Nothing is fabricated while the backend is unreachable."
      />
    );
  }
  return <TradingLive {...props} />;
};

export default Trading;
