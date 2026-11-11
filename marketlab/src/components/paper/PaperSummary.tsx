import React from "react";
import DataModeBadge from "@/components/market/DataModeBadge";
import type { PaperSummaryData } from "@/lib/paperTypes";
import { formatInr, formatPercent, formatSignedInr, toneClass } from "@/lib/format";

interface PaperSummaryProps {
  summary: PaperSummaryData;
  compact?: boolean;
}

const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode }> = ({
  label,
  value,
  hint,
}) => (
  <div className="ml-paper-stat">
    <p className="ml-paper-stat-label">{label}</p>
    <p className="ml-mono text-base font-semibold text-gray-100">{value}</p>
    {hint && <p className="mt-0.5 text-[11px] text-gray-500">{hint}</p>}
  </div>
);

/**
 * Virtual account header: equity, cash split and P&L.
 *
 * Every figure is computed server-side from the ledger-backed balances. The
 * overall freshness label is shown next to the equity because `marketValue`
 * depends on quote prices.
 */
export const PaperSummary: React.FC<PaperSummaryProps> = ({ summary, compact = false }) => {
  const { totals } = summary;
  const pnlTone = toneClass(totals.totalPnl);

  return (
    <section className="ml-paper-summary" data-testid="paper-summary">
      <div className="ml-paper-hero">
        <div>
          <p className="ml-paper-stat-label">Virtual account value</p>
          <p className="ml-mono text-3xl font-bold text-gray-50">{formatInr(totals.equity)}</p>
          <p className="mt-1 text-xs text-gray-500">
            Cash {formatInr(totals.availableCash)} + positions {formatInr(totals.marketValue)}
          </p>
        </div>
        <div className="text-right">
          <p className="ml-paper-stat-label">Total P&amp;L</p>
          <p className={`ml-mono text-2xl font-bold ${pnlTone}`}>
            {formatSignedInr(totals.totalPnl)}
          </p>
          <p className={`text-xs ${pnlTone}`}>{formatPercent(totals.totalReturnPercent)}</p>
        </div>
      </div>

      {totals.mode && (
        <p className="mt-2 text-xs text-gray-500">
          Position prices <DataModeBadge mode={totals.mode} /> — valuation follows the label of
          the price source, never inferred from a successful request.
        </p>
      )}

      <div className={`ml-paper-stats${compact ? " is-compact" : ""}`}>
        <Stat
          label="Spendable cash"
          value={formatInr(totals.spendableCash)}
          hint={
            totals.reservedCash > 0
              ? `${formatInr(totals.reservedCash)} reserved by open limit buys`
              : "No cash reserved"
          }
        />
        <Stat label="Invested cost" value={formatInr(totals.investedCost)} />
        <Stat
          label="Unrealised P&L"
          value={<span className={toneClass(totals.unrealizedPnl)}>{formatSignedInr(totals.unrealizedPnl)}</span>}
        />
        <Stat
          label="Realised P&L"
          value={<span className={toneClass(totals.realizedPnl)}>{formatSignedInr(totals.realizedPnl)}</span>}
        />
        <Stat label="Starting capital" value={formatInr(totals.startingCapital)} />
        <Stat
          label="Open orders"
          value={summary.openOrderCount}
          hint={summary.openOrderCount > 0 ? "Resting limits — cancelled or re-checked by you" : "None"}
        />
      </div>

      <p className="ml-paper-disclaimer" data-testid="paper-notice">
        <strong>Simulated account.</strong> No order reaches a broker and no real money moves.
        Fills use the price label recorded on each order; when no market-data provider is
        configured they are priced from the deterministic <span className="ml-mono">SAMPLE</span>{" "}
        series. Fees, taxes and slippage are not modelled.
      </p>
    </section>
  );
};

export default PaperSummary;
