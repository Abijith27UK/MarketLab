import React, { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRootContext } from "@/context/RootContext";
import { Button, Card, EmptyState, Select } from "@/components/ui";
import SectionHeader from "@/components/ui/section-header";
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
import { formatDateTime, formatInr, formatPrice, formatSignedInr, toneClass } from "@/lib/format";

interface PortfolioProps {
  onOpenInstrument: (instrumentId: string) => void;
  onNavigate: (page: "trading") => void;
}

const LedgerTable: React.FC<{ entries: PaperLedgerRow[] }> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="ml-empty-block" data-testid="ledger-empty">
        <p className="ml-empty-block__title">No fills recorded yet</p>
        <p className="ml-empty-block__body">
          Each filled order adds one ledger entry that explains the cash and position change.
        </p>
      </div>
    );
  }
  return (
    <div className="ml-table-scroll">
      <table className="ml-data-table" data-testid="ledger-table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Instrument</th>
            <th scope="col">Side</th>
            <th scope="col" className="is-right">
              Qty
            </th>
            <th scope="col" className="is-right ml-cell-hide-sm">
              Price
            </th>
            <th scope="col" className="is-right">
              Cash Δ
            </th>
            <th scope="col" className="is-right ml-cell-hide-sm">
              Cash after
            </th>
            <th scope="col" className="is-right ml-cell-hide-sm">
              Qty after
            </th>
            <th scope="col" className="is-right">
              Realised
            </th>
            <th scope="col" className="ml-cell-hide-sm">
              Price source
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry._id}>
              <td className="whitespace-nowrap text-[11px] text-[var(--text-3)]">
                {formatDateTime(entry.ts)}
              </td>
              <td>
                <span className="ml-data-table__symbol">{entry.symbol}</span>
              </td>
              <td>
                <span className={entry.kind === "BUY" ? "ml-side-tag is-buy" : "ml-side-tag is-sell"}>
                  {entry.kind}
                </span>
              </td>
              <td className="is-right is-num">{entry.quantity}</td>
              <td className="is-right is-num ml-cell-hide-sm">{formatPrice(entry.price)}</td>
              <td className={`is-right is-num ${toneClass(entry.cashDelta)}`}>
                {formatSignedInr(entry.cashDelta)}
              </td>
              <td className="is-right is-num ml-cell-hide-sm">{formatInr(entry.cashAfter)}</td>
              <td className="is-right is-num ml-cell-hide-sm">{entry.positionQtyAfter}</td>
              <td className={`is-right is-num ${toneClass(entry.realizedPnl)}`}>
                {formatSignedInr(entry.realizedPnl)}
              </td>
              <td className="ml-cell-hide-sm">
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
    return (
      <div className="p-4 md:p-6" aria-busy="true">
        <span className="skeleton" style={{ display: "block", height: 26, width: 160 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 120 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 240 }} />
      </div>
    );
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
      <div className="p-4 md:p-6" aria-busy="true">
        <span className="skeleton" style={{ display: "block", height: 96 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 240 }} />
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

  const hasPositions = summary.positions.length > 0;

  return (
    <div className="p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="ml-page-title">Portfolio</h1>
          <p className="ml-page-sub">
            Simulated holdings and P&amp;L derived from the fill ledger. Nothing here is a brokerage
            balance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="ml-badge">PAPER ONLY</span>
          <Button variant="secondary" size="sm" onClick={() => onNavigate("trading")}>
            Place an order
          </Button>
        </div>
      </header>

      <PaperSummary summary={summary} />

      <section className="mt-5">
        <Card>
          <SectionHeader
            title="Holdings"
            description="Weighted-average cost basis. Unrealised P&L uses each instrument’s eligible price and inherits its data-mode label."
            actions={
              hasPositions ? (
                <div className="flex items-end gap-2">
                  <div className="w-40">
                    <Select
                      label="Sort by"
                      value={positionSort.key}
                      onSelect={(value) =>
                        setPositionSort({ key: value as PositionSortKey, dir: positionSort.dir })
                      }
                      options={[
                        { value: "value", label: "Market value" },
                        { value: "pnl", label: "Unrealised P&L" },
                        { value: "quantity", label: "Quantity" },
                        { value: "averageCost", label: "Average cost" },
                        { value: "symbol", label: "Symbol" },
                      ]}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPositionSort((s) => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))}
                    aria-label={positionSort.dir === 1 ? "Sort ascending" : "Sort descending"}
                  >
                    {positionSort.dir === 1 ? "Asc ↑" : "Desc ↓"}
                  </Button>
                </div>
              ) : null
            }
          />
          <div className="mt-3">
            <PositionsTable
              positions={sortedPositions}
              onOpenInstrument={onOpenInstrument}
              emptyAction={
                <Button variant="primary" size="sm" onClick={() => onNavigate("trading")}>
                  Place a paper order
                </Button>
              }
            />
          </div>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <SectionHeader
            title="Orders"
            description="Every state, including rejections and cancellations."
            actions={
              <div className="flex flex-wrap items-end gap-2">
                <div className="w-36">
                  <Select
                    label="Status"
                    value={statusFilter}
                    onSelect={(value) => setStatusFilter(value as OrderStatusFilter)}
                    options={[
                      { value: "ALL", label: "All" },
                      { value: "OPEN", label: "Open" },
                      { value: "FILLED", label: "Filled" },
                      { value: "REJECTED", label: "Rejected" },
                      { value: "CANCELLED", label: "Cancelled" },
                    ]}
                  />
                </div>
                <div className="w-36">
                  <Select
                    label="Sort by"
                    value={orderSort.key}
                    onSelect={(value) =>
                      setOrderSort({ key: value as OrderSortKey, dir: orderSort.dir })
                    }
                    options={[
                      { value: "placed", label: "Placed" },
                      { value: "symbol", label: "Symbol" },
                      { value: "quantity", label: "Quantity" },
                      { value: "status", label: "Status" },
                    ]}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOrderSort((s) => ({ ...s, dir: s.dir === 1 ? -1 : 1 }))}
                  aria-label={orderSort.dir === 1 ? "Sort ascending" : "Sort descending"}
                >
                  {orderSort.dir === 1 ? "Asc ↑" : "Desc ↓"}
                </Button>
              </div>
            }
          />
          <div className="mt-3">
            {orders === undefined ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                {Array.from({ length: 4 }).map((_, index) => (
                  <span key={index} className="skeleton" style={{ height: 32 }} />
                ))}
              </div>
            ) : orders.length === 0 ? (
              <OrdersTable
                orders={[]}
                emptyMessage="No simulated orders yet. Use the order ticket on the Trading page to place one."
              />
            ) : visibleOrders.length === 0 ? (
              <div className="ml-empty-block" data-testid="orders-filtered-empty">
                <p className="ml-empty-block__title">No orders match this status filter</p>
                <p className="ml-empty-block__body">
                  Switch the filter back to “All” to see every recorded order.
                </p>
              </div>
            ) : (
              <OrdersTable orders={visibleOrders} emptyMessage="No simulated orders yet." />
            )}
          </div>
        </Card>
      </section>

      <section className="mt-5">
        <Card>
          <SectionHeader
            title="Fill ledger"
            description="Append-only record of cash and position movements. Replaying it reproduces the balances above, and each entry keeps the price label that was actually used."
            actions={
              <div className="w-36">
                <Select
                  label="Side"
                  value={ledgerSide}
                  onSelect={(value) => setLedgerSide(value as "ALL" | "BUY" | "SELL")}
                  options={[
                    { value: "ALL", label: "All" },
                    { value: "BUY", label: "Buys" },
                    { value: "SELL", label: "Sells" },
                  ]}
                />
              </div>
            }
          />
          <div className="mt-3">
            {ledger === undefined ? (
              <div className="flex flex-col gap-2" aria-busy="true">
                {Array.from({ length: 4 }).map((_, index) => (
                  <span key={index} className="skeleton" style={{ height: 32 }} />
                ))}
              </div>
            ) : ledger.length === 0 ? (
              <LedgerTable entries={[]} />
            ) : visibleLedger.length === 0 ? (
              <div className="ml-empty-block" data-testid="ledger-filtered-empty">
                <p className="ml-empty-block__title">No ledger entries match this filter</p>
                <p className="ml-empty-block__body">
                  Every fill is recorded here with the cash and position change it caused.
                </p>
              </div>
            ) : (
              <LedgerTable entries={visibleLedger} />
            )}
          </div>
        </Card>
      </section>
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
