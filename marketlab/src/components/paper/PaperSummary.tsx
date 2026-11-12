import React from "react";
import DataModeBadge from "@/components/market/DataModeBadge";
import type { PaperSummaryData } from "@/lib/paperTypes";
import { formatInr, formatPercent, formatSignedInr, toneClass } from "@/lib/format";

interface PaperSummaryProps {
  summary: PaperSummaryData;
  /** Trading page: the headline four figures only. */
  compact?: boolean;
}

const Metric: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: string;
  emphasis?: boolean;
}> = ({ label, value, hint, tone = "", emphasis = false }) => (
  <div className={emphasis ? "ml-metric is-emphasis" : "ml-metric"}>
    <p className="ml-metric__label">{label}</p>
    <p className={`ml-metric__value ml-mono ${tone}`}>{value}</p>
    {hint && <p className="ml-metric__hint">{hint}</p>}
  </div>
);

/**
 * Virtual account overview: equity, the cash split and P&L.
 *
 * Every figure is computed server-side from the ledger-backed balances. The
 * freshness label sits with the equity because `marketValue` depends on quote
 * prices; with no holdings there is no mode to label and none is invented.
 */
export const PaperSummary: React.FC<PaperSummaryProps> = ({ summary, compact = false }) => {
  const { totals } = summary;
  const holdings = summary.positions.length;
  const pnlTone = toneClass(totals.totalPnl);

  return (
    <section className="ml-account-overview" data-testid="paper-summary">
      <div className="ml-account-hero">
        <div className="min-w-0">
          <p className="ml-metric__label">Portfolio value</p>
          <p className="ml-account-hero__value ml-mono">{formatInr(totals.equity)}</p>
          <p className="ml-metric__hint">
            Cash {formatInr(totals.spendableCash)} + positions {formatInr(totals.marketValue)}
            {totals.mode ? (
              <>
                {" · "}
                prices <DataModeBadge mode={totals.mode} />
              </>
            ) : null}
          </p>
        </div>
        <div className="ml-account-hero__pnl">
          <p className="ml-metric__label">Total P&amp;L</p>
          <p className={`ml-account-hero__pnl-value ml-mono ${pnlTone}`}>
            {formatSignedInr(totals.totalPnl)}
          </p>
          <p className={`ml-metric__hint ${pnlTone}`}>
            {formatPercent(totals.totalReturnPercent)} on {formatInr(totals.startingCapital)}
          </p>
        </div>
      </div>

      {totals.mode ? (
        <p className="ml-account-note">
          Position prices <DataModeBadge mode={totals.mode} /> — valuation follows the label of the
          price source, never inferred from a successful request.
        </p>
      ) : (
        <p className="ml-account-note">
          No holdings are valued yet, so no price mode is in use. Cash figures are ledger balances.
        </p>
      )}

      <div className="ml-metric-grid">
        <Metric
          label="Available cash"
          value={formatInr(totals.spendableCash)}
          hint={
            totals.reservedCash > 0
              ? `${formatInr(totals.reservedCash)} reserved by open limit buys`
              : "No cash reserved"
          }
        />
        <Metric
          label="Unrealised P&L"
          tone={toneClass(totals.unrealizedPnl)}
          value={formatSignedInr(totals.unrealizedPnl)}
          hint="Open positions at the current eligible price"
        />
        <Metric
          label="Realised P&L"
          tone={toneClass(totals.realizedPnl)}
          value={formatSignedInr(totals.realizedPnl)}
          hint="Locked in by sells and recorded in the ledger"
        />
        <Metric
          label="Holdings"
          value={holdings}
          hint={`${holdings === 1 ? "instrument" : "instruments"} · ${summary.openOrderCount} open order${
            summary.openOrderCount === 1 ? "" : "s"
          }`}
        />
        {!compact && (
          <>
            <Metric label="Invested cost" value={formatInr(totals.investedCost)} hint="Cost basis of open positions" />
            <Metric
              label="Position value"
              value={formatInr(totals.marketValue)}
              hint="At the current eligible price"
            />
            <Metric
              label="Starting capital"
              value={formatInr(totals.startingCapital)}
              hint={summary.account.startingCapitalLocked ? "Locked for this account" : "Not yet locked"}
            />
            <Metric
              label="Total P&L"
              tone={pnlTone}
              value={formatSignedInr(totals.totalPnl)}
              hint={`${formatPercent(totals.totalReturnPercent)} total return`}
            />
          </>
        )}
      </div>

      <p className="ml-paper-disclaimer" data-testid="paper-notice">
        <strong>Simulated account.</strong> No order reaches a broker and no real money moves. Fills
        use the price label recorded on each order; when no market-data provider is configured they
        are priced from the deterministic <span className="ml-mono">SAMPLE</span> series. Fees, taxes
        and slippage are not modelled.
      </p>
    </section>
  );
};

export default PaperSummary;
