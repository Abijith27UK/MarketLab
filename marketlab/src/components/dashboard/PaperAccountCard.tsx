import React from "react";
import { useQuery } from "convex/react";
import { Beaker } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button, Card, EmptyState } from "@/components/ui";
import SectionHeader from "@/components/ui/section-header";
import Stat from "@/components/ui/stat";
import DataModeBadge from "@/components/market/DataModeBadge";
import { formatInr, formatInrWhole, formatPercent, formatSignedInr } from "@/lib/format";

/** Mirrors DEFAULT_STARTING_CAPITAL in convex/paperCore/config.ts. */
const PAPER_STARTING_CAPITAL = 100_000;

export interface PaperAccountCardProps {
  className?: string;
  authenticated: boolean;
  /** Opens the shared auth dialog on the requested tab. */
  onOpenAuth: (mode: "signin" | "signup") => void;
  onNavigate: (page: "portfolio" | "trading") => void;
}

const toneOf = (value: number): "neutral" | "pos" | "neg" =>
  value > 0 ? "pos" : value < 0 ? "neg" : "neutral";

/**
 * Paper-trading entry point.
 *
 * Signed out this is a compact onboarding card — never the registration form
 * itself. Signed in it shows only figures the ledger-backed summary query
 * returns; there is no placeholder balance and no invented P&L.
 */
export const PaperAccountCard: React.FC<PaperAccountCardProps> = ({
  className = "",
  authenticated,
  onOpenAuth,
  onNavigate,
}) => {
  const summary = useQuery(api.paper.summary, {});

  if (!authenticated) {
    return (
      <Card className={className}>
        <SectionHeader title="Paper Trading" description="Simulated · no real money" />
        <div className="ml-paper-hero">
          <span className="ml-paper-hero__icon" aria-hidden="true">
            <Beaker size={16} />
          </span>
          <p className="ml-paper-hero__body">
            Practice trading with virtual funds and zero real-money risk.
          </p>
          <p className="ml-paper-hero__amount">
            {formatInrWhole(PAPER_STARTING_CAPITAL)} virtual starting balance
          </p>
          <div className="ml-paper-hero__actions">
            <Button variant="primary" size="sm" onClick={() => onOpenAuth("signup")}>
              Start Paper Trading
            </Button>
            <button
              type="button"
              className="ml-paper-hero__link"
              onClick={() => onOpenAuth("signin")}
            >
              Already have an account? Sign in
            </button>
          </div>
          <p className="ml-paper-hero__note">
            Paper orders are simulated. No broker is connected and no real money moves.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <SectionHeader
        title="Paper account"
        description="Simulated · persisted in Convex"
        actions={
          summary ? (
            <Button variant="ghost" size="sm" onClick={() => onNavigate("portfolio")}>
              View portfolio
            </Button>
          ) : null
        }
      />

      {summary === undefined ? (
        <div className="ml-stat-grid" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, index) => (
            <span key={index} className="skeleton" style={{ height: 44 }} />
          ))}
        </div>
      ) : summary === null ? (
        <EmptyState
          className="ml-empty-state--compact"
          title="No paper account yet"
          description="It is created the first time you open the trading page."
          action={
            <Button variant="secondary" size="sm" onClick={() => onNavigate("trading")}>
              Open paper trading
            </Button>
          }
        />
      ) : (
        <>
          <div className="ml-stat-grid">
            <Stat
              label="Available cash"
              value={<span className="ml-mono ml-num">{formatInr(summary.totals.spendableCash)}</span>}
              hint="after cash reserved for open orders"
            />
            <Stat
              label="Portfolio value"
              value={<span className="ml-mono ml-num">{formatInr(summary.totals.equity)}</span>}
              hint={`${formatPercent(summary.totals.totalReturnPercent)} total return`}
            />
            <Stat
              label="Unrealised P&L"
              tone={toneOf(summary.totals.unrealizedPnl)}
              value={
                <span className="ml-mono ml-num">
                  {formatSignedInr(summary.totals.unrealizedPnl)}
                </span>
              }
            />
            <Stat
              label="Positions"
              value={<span className="ml-mono ml-num">{summary.positions.length}</span>}
              hint={`${summary.openOrderCount} open order${summary.openOrderCount === 1 ? "" : "s"}`}
            />
          </div>

          <div className="ml-paper-foot">
            <span className="ml-paper-foot__mode">
              {summary.totals.mode ? (
                <>
                  position prices <DataModeBadge mode={summary.totals.mode} />
                </>
              ) : (
                "no positions valued yet"
              )}
            </span>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("trading")}>
              Open trading
            </Button>
          </div>
        </>
      )}
    </Card>
  );
};

export default PaperAccountCard;
