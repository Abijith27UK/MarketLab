import React from "react";
import DataModeBadge from "@/components/market/DataModeBadge";
import MarketStatusBadge from "@/components/market/MarketStatusBadge";
import { formatAge, formatDateTime, modeDescription } from "@/lib/format";
import type { DataMode } from "@/lib/marketClient";

export interface OverviewSession {
  label: string;
  istDate: string;
  istTime: string;
  holidaysConfigured?: boolean;
}

export interface MarketOverviewHeaderProps {
  demo: boolean;
  session: OverviewSession | null;
  /** Provider timestamp of the newest quote in the visible batch. Never "now". */
  asOf: number | null;
  /** When MarketLab fetched these values — a separate, explicitly labelled clock. */
  retrievedAt?: number | null;
  mode: DataMode | null;
  source: string | null;
  /** Provider note or warning, shown under the source. */
  note?: string | null;
  now: number;
}

/**
 * Page header: title block plus an aligned metadata board.
 *
 * Session, freshness, data mode and source each get their own labelled cell so
 * long source names and mode descriptions wrap inside their own column instead
 * of colliding on one line.
 */
export const MarketOverviewHeader: React.FC<MarketOverviewHeaderProps> = ({
  demo,
  session,
  asOf,
  retrievedAt,
  mode,
  source,
  note,
  now,
}) => (
  <header className="ml-dash-head">
    <div className="ml-dash-head__main">
      <h1 className="ml-page-title">Market Overview</h1>
      <p className="ml-page-sub">
        Indian equities, indices and your saved research in one terminal. Every value carries its
        data mode — nothing is described as live unless the source says it is.
      </p>
      {demo ? (
        <p className="ml-demo-chip" data-testid="demo-chip">
          <span aria-hidden="true">◇</span> SAMPLE DATA — deterministic demo series, not Indian
          market data
        </p>
      ) : null}
    </div>

    <dl className="ml-meta-board">
      <div className="ml-meta">
        <dt>Session</dt>
        <dd>
          <MarketStatusBadge
            label={session?.label ?? null}
            fallback={demo ? "Unavailable offline" : "Loading…"}
          />
        </dd>
        <span className="ml-meta__hint">
          {session
            ? `${session.istDate} · ${session.istTime} IST`
            : demo
              ? "no deployment configured"
              : "reading the market calendar"}
        </span>
        {session && session.holidaysConfigured === false ? (
          <span className="ml-meta__hint ml-meta__hint--warn">Holiday calendar not configured</span>
        ) : null}
      </div>

      <div className="ml-meta">
        <dt>Quote timestamp</dt>
        <dd>{asOf ? formatDateTime(asOf) : "—"}</dd>
        <span className="ml-meta__hint">
          {asOf ? `provider quote ${formatAge(asOf, now)}` : "no provider quote timestamp"}
        </span>
        {retrievedAt ? (
          <span className="ml-meta__hint">retrieved {formatAge(retrievedAt, now)}</span>
        ) : null}
      </div>

      <div className="ml-meta">
        <dt>Data mode</dt>
        <dd>{mode ? <DataModeBadge mode={mode} asOf={asOf} /> : "—"}</dd>
        <span className="ml-meta__hint">
          {mode ? modeDescription(mode) : "waiting for a quote response"}
        </span>
      </div>

      <div className="ml-meta">
        <dt>Source</dt>
        <dd>{source ?? "—"}</dd>
        <span className="ml-meta__hint">{note ?? "reported by the configured provider"}</span>
      </div>
    </dl>
  </header>
);

export default MarketOverviewHeader;
