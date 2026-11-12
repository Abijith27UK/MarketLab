import React, { useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { Button, Card, EmptyState } from "@/components/ui";
import SectionHeader from "@/components/ui/section-header";
import { formatDateTime, formatPercent, toneClass } from "@/lib/format";
import type { DataMode, MarketMoverRow, MarketMoversResult } from "@/lib/marketClient";

export type MoverTab = "gainers" | "losers";

export interface MoversPanelProps {
  className?: string;
  data: MarketMoversResult | null;
  loading?: boolean;
  error?: string | null;
  now: number;
  onRetry?: () => void;
  onOpen: (instrumentId: string) => void;
}

const TABS: { id: MoverTab; label: string }[] = [
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
];

const MODE_LABEL: Record<DataMode, string> = {
  LIVE: "LIVE",
  DELAYED: "DELAYED",
  CACHED: "CACHED",
  HISTORICAL: "HISTORICAL",
  SAMPLE: "SAMPLE",
};

const MoverRow: React.FC<{
  row: MarketMoverRow;
  onOpen: (instrumentId: string) => void;
}> = ({ row, onOpen }) => {
  const label = row.name ? `${row.symbol} — ${row.name}` : `${row.symbol} (not in catalogue)`;
  const content = (
    <>
      <span className="ml-movers__identity">
        <span className="ml-movers__symbol">{row.symbol}</span>
        <span className="ml-movers__name">
          {row.name ?? "Name unavailable — sync the instrument catalogue"}
        </span>
      </span>
      <span className="ml-movers__right">
        <span className={`ml-movers__pct ${toneClass(row.changePercent)}`}>
          {formatPercent(row.changePercent)}
        </span>
        <span className="ml-movers__price">₹{row.lastPrice.toLocaleString("en-IN")}</span>
      </span>
    </>
  );

  return (
    <li className="ml-movers__row">
      {row.inCatalogue ? (
        <button
          type="button"
          className="ml-movers__link"
          onClick={() => onOpen(row.instrumentId)}
          title={label}
        >
          {content}
        </button>
      ) : (
        <span className="ml-movers__link ml-movers__link--muted" title={label}>
          {content}
        </span>
      )}
    </li>
  );
};

/**
 * Official NSE MCP market movers.
 *
 * The ranking is retrieved by a dedicated backend action whose source is fixed
 * to NSE MCP — switching the global quote source cannot change these rows. The
 * component only formats what the server returned; it never ranks local quotes.
 */
export const MoversPanel: React.FC<MoversPanelProps> = ({
  className = "",
  data,
  loading = false,
  error = null,
  now,
  onRetry,
  onOpen,
}) => {
  const [tab, setTab] = useState<MoverTab>("gainers");
  const rows = data ? (tab === "gainers" ? data.gainers : data.losers) : [];
  const showTabs = Boolean(data?.available) && !loading;

  const tabs = showTabs ? (
    <div className="ml-movers__tabs" role="tablist" aria-label="Movers direction">
      {TABS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          id={`movers-tab-${entry.id}`}
          aria-controls="movers-panel"
          aria-selected={tab === entry.id}
          className="ml-movers__tab"
          onClick={() => setTab(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <Card className={className}>
      <SectionHeader
        title="Market Movers"
        description="Official NSE market rankings"
        actions={
          <div className="ml-movers__actions">
            <span className="ml-source-badge">{data?.sourceLabel ?? "NSE MCP"}</span>
            {onRetry ? (
              <button
                type="button"
                className="ml-movers__retry"
                onClick={onRetry}
                disabled={loading}
                aria-label="Refresh NSE market movers"
                title="Refresh from NSE MCP"
              >
                <RefreshCw size={13} />
              </button>
            ) : null}
            {tabs}
          </div>
        }
      />

      {loading ? (
        <ul className="ml-movers__list" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <li key={index} className="ml-movers__row">
              <span className="ml-movers__link">
                <span className="skeleton" style={{ height: 12, width: "45%" }} />
                <span className="skeleton" style={{ height: 9, width: "65%" }} />
              </span>
              <span className="skeleton" style={{ height: 12, width: 48 }} />
            </li>
          ))}
        </ul>
      ) : error ? (
        <EmptyState
          className="ml-empty-state--compact"
          icon={<ArrowDownRight size={16} />}
          title="Unable to retrieve NSE market movers"
          description={error}
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : undefined
          }
        />
      ) : !data?.available ? (
        <EmptyState
          className="ml-empty-state--compact"
          icon={<ArrowDownRight size={16} />}
          title="Official NSE rankings unavailable"
          description={data?.reason ?? "NSE MCP did not return a market-mover ranking."}
          action={
            onRetry ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : undefined
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          className="ml-empty-state--compact"
          icon={tab === "gainers" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          title={`No verified ${tab} available for this session`}
          description="NSE's official ranking returned no eligible EQ-series row in this direction."
        />
      ) : (
        <div
          id="movers-panel"
          role="tabpanel"
          aria-labelledby={`movers-tab-${tab}`}
        >
          <ul className="ml-movers__list">
            {rows.map((row) => (
              <MoverRow key={`${row.symbol}:${row.series}`} row={row} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      )}

      {data?.warning ? (
        <p className="ml-movers__warning" role="status">
          {data.warning}
        </p>
      ) : null}

      <div className="ml-widget-foot ml-movers__foot">
        <span className="ml-widget-meta">
          {data?.available
            ? `${data.gainers.length} gainers · ${data.losers.length} losers · ${data.universe}`
            : "Official NSE ranking only"}
        </span>
        <span className="ml-widget-meta">
          {data?.available ? (
            <>
              {MODE_LABEL[data.mode]}
              {data.sessionDate ? ` · session ${data.sessionDate}` : ""}
              {data.quoteTimestamp
                ? ` · quote ${formatDateTime(data.quoteTimestamp)}`
                : " · no quote timestamp"}
              {` · retrieved ${formatDateTime(data.retrievedAt)}`}
              {data.cacheExpiresAt ? (
                <span className="ml-movers__cachemeta">
                  {" "}
                  · cache {now < data.cacheExpiresAt ? "fresh" : "expired"}
                </span>
              ) : null}
            </>
          ) : (
            "NSE MCP"
          )}
        </span>
      </div>
    </Card>
  );
};

export default MoversPanel;
