import React from "react";
import { Star } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";
import SectionHeader from "@/components/ui/section-header";
import FinancialValue from "@/components/market/FinancialValue";
import PriceChange from "@/components/market/PriceChange";
import DataFreshnessBadge from "@/components/market/DataFreshnessBadge";
import { parseInstrumentId } from "@/lib/demoCatalogue";
import type { DataMode, Quote } from "@/lib/marketClient";

export interface WatchlistPreviewProps {
  className?: string;
  authenticated: boolean;
  loading: boolean;
  name?: string;
  ids: string[];
  quoteById: Map<string, Quote>;
  /** Instrument names, so rows can show the company rather than just the code. */
  nameById: Map<string, string>;
  /** Batch-level freshness of the quotes shown here. */
  mode?: DataMode | null;
  asOf?: number | null;
  now: number;
  onOpen: (instrumentId: string) => void;
  onManage: () => void;
  onSignIn: () => void;
  onBrowse: () => void;
}

const MAX_ROWS = 6;

/**
 * Compact watchlist preview: ticker + company on the left, quote and
 * percentage change right-aligned, batch freshness in the footer.
 *
 * Every figure comes from the shared quote primitives, so a missing quote shows
 * an em dash rather than a zero, and the SAMPLE label from the source is kept.
 */
export const WatchlistPreview: React.FC<WatchlistPreviewProps> = ({
  className = "",
  authenticated,
  loading,
  name,
  ids,
  quoteById,
  nameById,
  mode,
  asOf,
  now,
  onOpen,
  onManage,
  onSignIn,
  onBrowse,
}) => {
  const visible = ids.slice(0, MAX_ROWS);
  const hidden = Math.max(0, ids.length - visible.length);

  const description = authenticated && !loading
    ? ids.length > 0
      ? `${ids.length} instrument${ids.length === 1 ? "" : "s"}`
      : "No instruments saved"
    : undefined;

  return (
    <Card className={className}>
      <SectionHeader
        title={name ?? "Watchlist"}
        description={description}
        actions={
          authenticated && ids.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={onManage}>
              View all
            </Button>
          ) : null
        }
      />

      {!authenticated ? (
        <EmptyState
          className="ml-empty-state--compact"
          icon={<Star size={16} />}
          title="No watchlist yet"
          description="Save stocks and track your watchlist in one place."
          action={
            <Button variant="secondary" size="sm" onClick={onSignIn}>
              Sign in to create watchlists
            </Button>
          }
        />
      ) : loading ? (
        <ul className="ml-watch" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <li key={index} className="ml-watch__row">
              <span className="ml-watch__link">
                <span className="skeleton" style={{ height: 12, width: "52%" }} />
                <span className="skeleton" style={{ height: 9, width: "70%" }} />
              </span>
              <span className="skeleton" style={{ height: 12, width: 56 }} />
              <span className="skeleton" style={{ height: 12, width: 44 }} />
            </li>
          ))}
        </ul>
      ) : ids.length === 0 ? (
        <EmptyState
          className="ml-empty-state--compact"
          icon={<Star size={16} />}
          title="Your watchlist is empty"
          description="Add symbols from the markets page to track them here."
          action={
            <Button variant="secondary" size="sm" onClick={onBrowse}>
              Browse markets
            </Button>
          }
        />
      ) : (
        <>
          <ul className="ml-watch">
            {visible.map((instrumentId) => {
              const quote = quoteById.get(instrumentId);
              const parsed = parseInstrumentId(instrumentId);
              const symbol = quote?.symbol ?? parsed?.symbol ?? instrumentId;
              const companyName = nameById.get(instrumentId) ?? "";

              return (
                <li key={instrumentId} className="ml-watch__row">
                  <button
                    type="button"
                    className="ml-watch__link"
                    onClick={() => onOpen(instrumentId)}
                    title={companyName ? `${symbol} — ${companyName}` : symbol}
                  >
                    <span className="ml-watch__symbol">{symbol}</span>
                    {companyName ? <span className="ml-watch__name">{companyName}</span> : null}
                  </button>

                  <span className="ml-watch__price">
                    <FinancialValue value={quote?.lastPrice} size="sm" />
                  </span>

                  <span className="ml-watch__change">
                    <PriceChange
                      change={quote?.change ?? null}
                      changePercent={quote?.changePercent ?? null}
                      showAbsolute={false}
                      showWord={false}
                    />
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="ml-widget-foot">
            <span className="ml-widget-meta">
              {mode ? (
                <DataFreshnessBadge mode={mode} asOf={asOf ?? null} now={now} />
              ) : (
                "no quote cycle yet"
              )}
            </span>
            {hidden > 0 ? (
              <button type="button" className="ml-widget-more" onClick={onManage}>
                +{hidden} more
              </button>
            ) : null}
          </div>
        </>
      )}
    </Card>
  );
};

export default WatchlistPreview;
