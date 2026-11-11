import React, { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Button, Card } from "@/components/ui";
import AuthPanel from "@/components/AuthPanel";
import BackendRequired from "@/components/system/BackendRequired";
import DataModeBadge from "@/components/market/DataModeBadge";
import PaperSummary from "@/components/paper/PaperSummary";
import PositionsTable from "@/components/paper/PositionsTable";
import OrdersTable from "@/components/paper/OrdersTable";
import type { PaperLedgerRow } from "@/lib/paperTypes";
import {
  filterLedger,
  filterOrders,
  sortOrders,
  sortPositions,
  type OrderSortKey,
  type OrderStatusFilter,
  type PositionSortKey,
  type SortState,
} from "@/lib/tableSort";
import {
  formatDateTime,
  formatInr,
  formatPrice,
  formatSignedInr,
  toneClass,
} from "@/lib/format";

interface PortfolioProps {
  onOpenInstrument: (instrumentId: string) => void;
  onNavigate: (page: "trading") => void;
}

const LedgerTable: React.FC<{ entries: PaperLedgerRow[] }> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <p className="ml-empty" data-testid="ledger-empty">
        No fills recorded yet. Each filled order adds one ledger entry that explains the cash and
        position change.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="ml-table" data-testid="ledger-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Instrument</th>
            <th>Side</th>
            <th className="is-right">Qty</th>
            <th className="is-right">Price</th>
            <th className="is-right">Cash Δ</th>
            <th className="is-right">Cash after</th>
            <th className="is-right">Qty after</th>
            <th className="is-right">Realised</th>
            <th>Price source</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry._id}>
              <td className="whitespace-nowrap text-xs text-gray-400">
                {formatDateTime(entry.ts)}
              </td>
              <td className="text-gray-200">{entry.symbol}</td>
              <td>
                <span className={entry.kind === "BUY" ? "ml-side-tag is-buy" : "ml-side-tag is-sell"}>
                  {entry.kind}
                </span>
              </td>
              <td className="is-right ml-mono">{entry.quantity}</td>
              <td className="is-right ml-mono">{formatPrice(entry.price)}</td>
              <td className={`is-right ml-mono ${toneClass(entry.cashDelta)}`}>
                {formatSignedInr(entry.cashDelta)}
              </td>
              <td className="is-right ml-mono">{formatInr(entry.cashAfter)}</td>
              <td className="is-right ml-mono">{entry.positionQtyAfter}</td>
              <td className={`is-right ml-mono ${toneClass(entry.realizedPnl)}`}>
                {formatSignedInr(entry.realizedPnl)}
              </td>
              <td>
                <DataModeBadge mode={entry.mode} source={entry.source} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const PortfolioLive: React.FC<PortfolioProps> = ({ onOpenInstrument, onNavigate }) => {
  const { isAuthenticated, loading } = useRootContext();
  const summary = useQuery(api.paper.summary, {});
  const orders = useQuery(api.paper.orders, { limit: 25 });
  const ledger = useQuery(api.paper.ledger, { limit: 25 });

  const [positionSort, setPositionSort] = useState<SortState<PositionSortKey>>({
    key: "value",
    dir: -1,
  });
  const [orderSort, setOrderSort] = useState<SortState<OrderSortKey>>({ key: "placed", dir: -1 });
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>("ALL");
  const [ledgerSide, setLedgerSide] = useState<"ALL" | "BUY" | "SELL">("ALL");

  const sortedPositions = useMemo(
    () => sortPositions(summary?.positions ?? [], positionSort.key, positionSort.dir),
    [summary?.positions, positionSort]
  );
  const visibleOrders = useMemo(
    () => sortOrders(filterOrders(orders ?? [], statusFilter), orderSort.key, orderSort.dir),
    [orders, statusFilter, orderSort]
  );
  const visibleLedger = useMemo(() => filterLedger(ledger ?? [], ledgerSide), [ledger, ledgerSide]);

  if (loading) {
    return <div className="p-6 text-gray-400">Loading portfolio…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="ml-page-title">Portfolio</h1>
        <p className="ml-page-sub">
          Virtual holdings for your paper account. Sign in to see your own balances — nothing is
          shown to signed-out visitors.
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
        <h1 className="ml-page-title">Portfolio</h1>
        <p className="ml-page-sub">
          No paper account exists yet. It is created with ₹1,00,000 of virtual capital when you open
          the Trading page.
        </p>
        <Button className="mt-4" onClick={() => onNavigate("trading")}>
          Go to Trading
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="ml-page-head">
        <div>
          <h1 className="ml-page-title">Portfolio</h1>
          <p className="ml-page-sub">
            Simulated holdings and P&amp;L derived from the fill ledger. Nothing here is a brokerage
            balance.
          </p>
        </div>
        <div className="ml-page-head-side">
          <Button variant="secondary" size="sm" onClick={() => onNavigate("trading")}>
            Place an order
          </Button>
        </div>
      </header>

      <PaperSummary summary={summary} />

      <Card className="mt-6">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">Positions</h2>
            <p className="ml-section-sub">
              Weighted-average cost basis. Unrealised P&amp;L uses each instrument&apos;s eligible
              price and inherits its data-mode label.
            </p>
          </div>
          <label className="ml-compact-field">
            <span>Sort</span>
            <select
              className="ml-compact-select"
              value={positionSort.key}
              onChange={(event) =>
                setPositionSort({
                  key: event.target.value as PositionSortKey,
                  dir: positionSort.dir,
                })
              }
              aria-label="Sort positions by"
            >
              <option value="value">Market value</option>
              <option value="pnl">Unrealised P&amp;L</option>
              <option value="quantity">Quantity</option>
              <option value="averageCost">Average cost</option>
              <option value="symbol">Symbol</option>
            </select>
            <button
              type="button"
              className="ml-row-action"
              onClick={() => setPositionSort((s) => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))}
              aria-label={positionSort.dir === 1 ? "Sort ascending" : "Sort descending"}
            >
              {positionSort.dir === 1 ? "↑" : "↓"}
            </button>
          </label>
        </div>
        <PositionsTable positions={sortedPositions} onOpenInstrument={onOpenInstrument} />
      </Card>

      <Card className="mt-6">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">Orders</h2>
            <p className="ml-section-sub">Every state, including rejections and cancellations.</p>
          </div>
          <div className="ml-filter-row">
            <label className="ml-compact-field">
              <span>Status</span>
              <select
                className="ml-compact-select"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as OrderStatusFilter)}
                aria-label="Filter orders by status"
              >
                <option value="ALL">All</option>
                <option value="OPEN">Open</option>
                <option value="FILLED">Filled</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </label>
            <label className="ml-compact-field">
              <span>Sort</span>
              <select
                className="ml-compact-select"
                value={orderSort.key}
                onChange={(event) =>
                  setOrderSort({ key: event.target.value as OrderSortKey, dir: orderSort.dir })
                }
                aria-label="Sort orders by"
              >
                <option value="placed">Placed</option>
                <option value="symbol">Symbol</option>
                <option value="quantity">Quantity</option>
                <option value="status">Status</option>
              </select>
              <button
                type="button"
                className="ml-row-action"
                onClick={() => setOrderSort((s) => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))}
                aria-label={orderSort.dir === 1 ? "Sort ascending" : "Sort descending"}
              >
                {orderSort.dir === 1 ? "↑" : "↓"}
              </button>
            </label>
          </div>
        </div>
        {orders === undefined ? (
          <p className="ml-empty">Loading orders…</p>
        ) : visibleOrders.length === 0 ? (
          <p className="ml-empty" data-testid="orders-filtered-empty">
            No orders match this status filter.
          </p>
        ) : (
          <OrdersTable orders={visibleOrders} emptyMessage="No simulated orders yet." />
        )}
      </Card>

      <Card className="mt-6">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">Fill ledger</h2>
            <p className="ml-section-sub">
              Append-only record of cash and position movements. Replaying it reproduces the balances
              above, and each entry keeps the price label that was actually used.
            </p>
          </div>
          <label className="ml-compact-field">
            <span>Side</span>
            <select
              className="ml-compact-select"
              value={ledgerSide}
              onChange={(event) => setLedgerSide(event.target.value as "ALL" | "BUY" | "SELL")}
              aria-label="Filter ledger by side"
            >
              <option value="ALL">All</option>
              <option value="BUY">Buys</option>
              <option value="SELL">Sells</option>
            </select>
          </label>
        </div>
        {ledger === undefined ? (
          <p className="ml-empty">Loading ledger…</p>
        ) : visibleLedger.length === 0 ? (
          <p className="ml-empty" data-testid="ledger-filtered-empty">
            No ledger entries match this filter.
          </p>
        ) : (
          <LedgerTable entries={visibleLedger} />
        )}
      </Card>
    </div>
  );
};

const Portfolio: React.FC<PortfolioProps> = (props) => {
  const { backendOnline } = useRootContext();
  if (!backendOnline) {
    return (
      <BackendRequired
        feature="Portfolio"
        description="Your paper positions, orders and fill ledger live in Convex under your authenticated account."
      />
    );
  }
  return <PortfolioLive {...props} />;
};

export default Portfolio;
