import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Card, Button } from "@/components/ui";
import AuthPanel from "@/components/AuthPanel";
import BackendRequired from "@/components/system/BackendRequired";
import PaperSummary from "@/components/paper/PaperSummary";
import PositionsTable from "@/components/paper/PositionsTable";
import OrdersTable from "@/components/paper/OrdersTable";
import OrderTicket, { type TicketSubmission } from "@/components/paper/OrderTicket";
import { useQuotes } from "@/hooks/useQuotes";
import { marketApi } from "@/lib/marketClient";
import { instrumentIdOf } from "@/lib/stockModels";
import { formatPrice } from "@/lib/format";

interface TradingProps {
  onOpenInstrument: (instrumentId: string) => void;
}

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

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedInstrumentId, setSelectedInstrumentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);

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

  const position = summary?.positions.find(
    (item) => item.instrumentId === selectedInstrumentId
  );

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
        action === "cancel" ? await cancelOrder({ orderId: orderId as never }) : await recheckOrder({ orderId: orderId as never });
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
    return <div className="p-6 text-gray-400">Loading paper account…</div>;
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
      <div className="p-4 md:p-6">
        <div className="skeleton mb-4 h-24 w-full rounded-xl" />
        <div className="skeleton h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="ml-page-title">Trading</h1>
        <p className="ml-page-sub">Creating your simulated account with ₹1,00,000 of virtual capital…</p>
        {pageError && <p className="mt-3 text-sm text-red-400">{pageError}</p>}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="ml-page-head">
        <div>
          <h1 className="ml-page-title">Trading</h1>
          <p className="ml-page-sub">
            Paper orders against labelled prices. Cash, positions and P&amp;L are computed by the
            backend and persisted in an auditable ledger.
          </p>
        </div>
        <div className="ml-page-head-side">
          <span className="ml-badge">PAPER ONLY</span>
          <p className="text-xs text-gray-500">Live trading stays disabled until a broker is connected.</p>
        </div>
      </header>

      <PaperSummary summary={summary} compact />

      {pageError && (
        <p className="ml-inline-error" role="alert">
          {pageError}
        </p>
      )}
      {pageNotice && (
        <p className="ml-inline-notice" role="status">
          {pageNotice}
        </p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(320px,380px)_1fr]">
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

        <Card>
          <div className="ml-section-head">
            <div>
              <h2 className="ml-section-title">Open positions</h2>
              <p className="ml-section-sub">
                Valued at the eligible price for each instrument, with its freshness label.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => onOpenInstrument(selectedInstrumentId)}>
              Open chart
            </Button>
          </div>
          <PositionsTable positions={summary.positions} onOpenInstrument={onOpenInstrument} />
        </Card>
      </div>

      <Card className="mt-6">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">Order history</h2>
            <p className="ml-section-sub">
              Rejected and cancelled orders are kept so every balance change stays explainable.
            </p>
          </div>
        </div>
        {orders === undefined ? (
          <p className="ml-empty">Loading orders…</p>
        ) : (
          <OrdersTable
            orders={orders}
            busyOrderId={busyOrderId}
            onCancel={(orderId) => void actOnOrder(orderId, "cancel")}
            onRecheck={(orderId) => void actOnOrder(orderId, "recheck")}
            emptyMessage="No simulated orders yet. Use the ticket to place one."
          />
        )}
      </Card>
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
