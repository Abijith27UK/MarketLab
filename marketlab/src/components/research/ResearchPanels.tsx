import React, { useMemo, useState } from "react";
import { ExternalLink, Info } from "lucide-react";
import { EmptyState } from "@/components/ui";
import type {
  CompanyProfile,
  CorporateEvent,
  FinancialPeriod,
  FinancialStatements,
  NewsFeed,
  ResearchProvenance,
  ShareholdingPeriod,
} from "@/lib/researchClient";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const numberFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Absolute figure in the unit the provider reported; never re-scaled silently. */
export function formatFigure(value: number | null, unit: string | null, decimals = 0): string {
  if (value === null) return "—";
  const formatted =
    decimals > 0 ? decimalFormatter.format(value) : numberFormatter.format(Math.round(value));
  return unit ? `${formatted} ${unit}` : formatted;
}

export function formatPercent(value: number | null, digits = 2): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

const IST = "Asia/Kolkata";

export function formatIstDate(value: number | null): string {
  if (value === null) return "Date not reported";
  return new Date(value).toLocaleDateString("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatIstDateTime(value: number | null): string {
  if (value === null) return "Time not reported";
  return new Date(value).toLocaleString("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/* Metric grid                                                         */
/* ------------------------------------------------------------------ */

export interface MetricItem {
  label: string;
  value: string;
  hint?: string;
  tone?: "pos" | "neg" | "muted";
}

export const MetricCard: React.FC<{ item: MetricItem }> = ({ item }) => (
  <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5">
    <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-3)]">
      <span className="truncate">{item.label}</span>
      {item.hint ? (
        <span title={item.hint} className="inline-flex cursor-help" aria-label={item.hint}>
          <Info size={10} aria-hidden="true" />
        </span>
      ) : null}
    </div>
    <div
      className={`mt-1 truncate text-[15px] font-semibold tabular-nums ${
        item.tone === "pos"
          ? "text-[var(--pos)]"
          : item.tone === "neg"
            ? "text-[var(--neg)]"
            : item.tone === "muted"
              ? "text-[var(--text-3)]"
              : "text-[var(--text)]"
      }`}
      title={item.value}
    >
      {item.value}
    </div>
  </div>
);

export const MetricGrid: React.FC<{ items: MetricItem[]; label?: string }> = ({
  items,
  label = "Key metrics",
}) => (
  <div
    role="list"
    aria-label={label}
    className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6"
  >
    {items.map((item) => (
      <div role="listitem" key={item.label}>
        <MetricCard item={item} />
      </div>
    ))}
  </div>
);

/* ------------------------------------------------------------------ */
/* Provenance + states                                                 */
/* ------------------------------------------------------------------ */

export const ProvenanceNote: React.FC<{ provenance: ResearchProvenance; label?: string }> = ({
  provenance,
  label,
}) => (
  <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-3)]">
    {label ? `${label} · ` : ""}Source {provenance.source === "gnews" ? "GNews" : "Tapetide"}
    {provenance.asOf ? ` · data as of ${formatIstDateTime(Date.parse(provenance.asOf))}` : ""}
    {provenance.reportDate
      ? ` · reporting/publication date ${provenance.reportDate}`
      : ""}
    {" · retrieved "}
    {formatIstDateTime(provenance.fetchedAt)}
  </p>
);

export const ResearchUnavailable: React.FC<{
  title: string;
  reason: string | null;
  hint?: string;
}> = ({ title, reason, hint }) => (
  <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6">
    <p className="text-sm font-medium text-[var(--text)]">{title}</p>
    {reason ? <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-3)]">{reason}</p> : null}
    {hint ? <p className="mt-2 text-[11px] text-[var(--text-3)]">{hint}</p> : null}
  </div>
);

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export const OverviewPanel: React.FC<{
  profile: CompanyProfile | null;
  financials: FinancialStatements | null;
  news: NewsFeed | null;
  newsError: string | null;
  onOpenNews: () => void;
}> = ({ profile, financials, news, newsError, onOpenNews }) => {
  const latest = financials?.annual[financials.annual.length - 1] ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section aria-labelledby="about-company">
        <h3 id="about-company" className="text-sm font-semibold text-[var(--text)]">
          About the company
        </h3>
        {profile?.description ? (
          <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-[var(--text-2)]">
            {profile.description}
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-3)]">
            No verified company description is available for this instrument.
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Sector</dt>
            <dd className="text-[var(--text)]">{profile?.sector ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Industry</dt>
            <dd className="text-[var(--text)]">{profile?.industry ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Employees</dt>
            <dd className="text-[var(--text)]">
              {profile?.employees ? numberFormatter.format(profile.employees) : "—"}
            </dd>
          </div>
        </dl>
        {profile?.provenance ? <ProvenanceNote provenance={profile.provenance} /> : null}

        {latest ? (
          <div className="mt-4 rounded-lg border border-[var(--border)] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
              Latest reported period · {latest.label}
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <li>
                <span className="block text-[10px] text-[var(--text-3)]">Revenue</span>
                {formatFigure(latest.revenue, financials?.unit ?? null)}
              </li>
              <li>
                <span className="block text-[10px] text-[var(--text-3)]">Net profit</span>
                {formatFigure(latest.netProfit, financials?.unit ?? null)}
              </li>
              <li>
                <span className="block text-[10px] text-[var(--text-3)]">Operating margin</span>
                {latest.operatingMarginPct === null
                  ? "—"
                  : `${latest.operatingMarginPct.toFixed(2)}%`}
              </li>
            </ul>
            {!financials?.consolidated && financials?.consolidated !== null ? (
              <p className="mt-2 text-[10px] text-[var(--text-3)]">Standalone statements.</p>
            ) : financials?.consolidated ? (
              <p className="mt-2 text-[10px] text-[var(--text-3)]">Consolidated statements.</p>
            ) : (
              <p className="mt-2 text-[10px] text-[var(--text-3)]">
                The provider does not state whether these are consolidated or standalone.
              </p>
            )}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="overview-news" className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 id="overview-news" className="text-sm font-semibold text-[var(--text)]">
            Recent news
          </h3>
          <button
            type="button"
            className="text-[11px] font-medium text-[var(--accent)] hover:underline"
            onClick={onOpenNews}
          >
            All news & events
          </button>
        </div>
        {news && news.items.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {news.items.slice(0, 3).map((item) => (
              <li key={item.id} className="border-b border-[var(--border)] pb-2 last:border-0">
                <p className="text-[12px] leading-snug text-[var(--text)]">{item.headline}</p>
                <p className="mt-0.5 text-[10px] text-[var(--text-3)]">
                  {item.publisher ?? "Publisher not reported"} · {formatIstDateTime(item.publishedAt)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-3)]">
            {newsError ?? "No recent company-specific news is available."}
          </p>
        )}
      </section>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Financials                                                          */
/* ------------------------------------------------------------------ */

type StatementKind = "profit" | "balance" | "cash";

const statementRows = (
  period: FinancialPeriod,
  kind: StatementKind,
  unit: string | null
): { label: string; value: string }[] => {
  if (kind === "profit") {
    return [
      { label: "Revenue", value: formatFigure(period.revenue, unit) },
      { label: "Expenses", value: formatFigure(period.expenses, unit) },
      { label: "Operating profit", value: formatFigure(period.operatingProfit, unit) },
      {
        label: "Operating margin",
        value: period.operatingMarginPct === null ? "—" : `${period.operatingMarginPct.toFixed(2)}%`,
      },
      { label: "Net profit", value: formatFigure(period.netProfit, unit) },
      { label: "EPS", value: formatFigure(period.eps, null, 2) },
      { label: "Revenue growth", value: formatPercent(period.revenueGrowthPct) },
      { label: "Profit growth", value: formatPercent(period.profitGrowthPct) },
    ];
  }
  if (kind === "balance") {
    return [
      { label: "Total assets", value: formatFigure(period.totalAssets, unit) },
      { label: "Total liabilities", value: formatFigure(period.totalLiabilities, unit) },
      { label: "Shareholders' equity", value: formatFigure(period.equity, unit) },
      { label: "Borrowings", value: formatFigure(period.debt, unit) },
      { label: "Cash & equivalents", value: formatFigure(period.cash, unit) },
    ];
  }
  return [
    { label: "Operating cash flow", value: formatFigure(period.operatingCashFlow, unit) },
    { label: "Investing cash flow", value: formatFigure(period.investingCashFlow, unit) },
    { label: "Financing cash flow", value: formatFigure(period.financingCashFlow, unit) },
    { label: "Free cash flow", value: formatFigure(period.freeCashFlow, unit) },
  ];
};

const StatementTable: React.FC<{
  title: string;
  kind: StatementKind;
  periods: FinancialPeriod[];
  unit: string | null;
}> = ({ title, kind, periods, unit }) => {
  const columns = [...periods].reverse().slice(0, 5);
  if (columns.length === 0) return null;
  const labels = statementRows(columns[0], kind, unit).map((row) => row.label);
  return (
    <div className="mt-4">
      <h4 className="text-xs font-semibold text-[var(--text)]">{title}</h4>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[420px] text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--text-3)]">
              <th scope="col" className="py-1.5 pr-3 font-medium">
                Item
              </th>
              {columns.map((period) => (
                <th key={period.label} scope="col" className="py-1.5 pr-3 text-right font-medium">
                  {period.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label) => (
              <tr key={label} className="border-b border-[var(--border)] last:border-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-[var(--text-3)]">
                  {label}
                </th>
                {columns.map((period) => (
                  <td
                    key={`${period.label}-${label}`}
                    className="py-1.5 pr-3 text-right tabular-nums text-[var(--text)]"
                  >
                    {statementRows(period, kind, unit).find((row) => row.label === label)?.value ??
                      "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const TrendBars: React.FC<{ periods: FinancialPeriod[]; unit: string | null }> = ({
  periods,
  unit,
}) => {
  const rows = periods.filter((period) => period.revenue !== null || period.netProfit !== null);
  if (rows.length < 2) return null;
  const max = rows.reduce(
    (value, period) => Math.max(value, Math.abs(period.revenue ?? 0), Math.abs(period.netProfit ?? 0)),
    0
  );
  if (max <= 0) return null;
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-[var(--text)]">Revenue and net profit</h4>
        <span className="text-[10px] text-[var(--text-3)]">{unit ?? "reported units"}</span>
      </div>
      <div className="mt-2 flex items-end gap-2" role="img" aria-label="Revenue and net profit by reported period">
        {rows.map((period) => (
          <div key={period.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex h-24 w-full items-end justify-center gap-0.5">
              <div
                className="w-1/3 rounded-t bg-[var(--accent)]"
                style={{ height: `${Math.max(2, (Math.abs(period.revenue ?? 0) / max) * 96)}px` }}
                title={`Revenue ${formatFigure(period.revenue, unit)}`}
              />
              <div
                className={`w-1/3 rounded-t ${(period.netProfit ?? 0) < 0 ? "bg-[var(--neg)]" : "bg-[var(--pos)]"}`}
                style={{ height: `${Math.max(2, (Math.abs(period.netProfit ?? 0) / max) * 96)}px` }}
                title={`Net profit ${formatFigure(period.netProfit, unit)}`}
              />
            </div>
            <span className="max-w-full truncate text-[9px] text-[var(--text-3)]" title={period.label}>
              {period.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const FinancialsPanel: React.FC<{
  financials: FinancialStatements | null;
  loading: boolean;
  error: string | null;
  reason: string | null;
}> = ({ financials, loading, error, reason }) => {
  const [reporting, setReporting] = useState<"annual" | "quarterly">("annual");
  const periods = financials ? financials[reporting] : [];
  const hasAnnual = (financials?.annual.length ?? 0) > 0;
  const hasQuarterly = (financials?.quarterly.length ?? 0) > 0;

  if (loading && !financials) {
    return <p className="text-xs text-[var(--text-3)]">Loading reported financial statements…</p>;
  }
  if (!financials || periods.length === 0) {
    return (
      <EmptyState
        title="No financial statements available"
        description={
          error ??
          reason ??
          "The research provider returned no usable periods for this instrument. Statements are only shown for operating companies that report them."
        }
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="ml-chip-row" role="group" aria-label="Reporting period">
          {hasAnnual && (
            <button
              type="button"
              className={`ml-chip ${reporting === "annual" ? "is-active" : ""}`}
              aria-pressed={reporting === "annual"}
              onClick={() => setReporting("annual")}
            >
              Annual
            </button>
          )}
          {hasQuarterly && (
            <button
              type="button"
              className={`ml-chip ${reporting === "quarterly" ? "is-active" : ""}`}
              aria-pressed={reporting === "quarterly"}
              onClick={() => setReporting("quarterly")}
            >
              Quarterly
            </button>
          )}
        </div>
        <span className="text-[10px] text-[var(--text-3)]">
          {financials.consolidated === null
            ? "Consolidation basis not stated by provider"
            : financials.consolidated
              ? "Consolidated statements"
              : "Standalone statements"}
        </span>
      </div>

      {financials.unit === null ? (
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-3)]">
          The provider did not state a reporting unit, so figures are printed exactly as reported
          (no scaling applied).
        </p>
      ) : null}

      <TrendBars periods={periods} unit={financials.unit} />
      <StatementTable title="Profit & loss" kind="profit" periods={periods} unit={financials.unit} />
      <StatementTable title="Balance sheet" kind="balance" periods={periods} unit={financials.unit} />
      <StatementTable title="Cash flow" kind="cash" periods={periods} unit={financials.unit} />

      <div className="mt-3 text-[10px] text-[var(--text-3)]">
        Periods end {periods[periods.length - 1]?.periodEnd ?? "not reported"} →{" "}
        {periods[periods.length - 1]?.reportDate
          ? `latest figures published ${periods[periods.length - 1].reportDate}`
          : "publication dates not reported"}
      </div>
      <ProvenanceNote provenance={financials.provenance} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Shareholding                                                        */
/* ------------------------------------------------------------------ */

const HOLDING_SERIES = [
  { key: "promoterPct", label: "Promoters", color: "var(--accent)" },
  { key: "fiiPct", label: "FII / FPI", color: "var(--pos)" },
  { key: "diiPct", label: "DII", color: "var(--warn, #d6a63b)" },
  { key: "publicPct", label: "Public / other", color: "var(--text-3)" },
  { key: "governmentPct", label: "Government", color: "var(--neg)" },
] as const;

export const ShareholdingPanel: React.FC<{
  periods: ShareholdingPeriod[];
  loading: boolean;
  error: string | null;
  reason: string | null;
}> = ({ periods, loading, error, reason }) => {
  if (loading && periods.length === 0) {
    return <p className="text-xs text-[var(--text-3)]">Loading reported shareholding…</p>;
  }
  if (periods.length === 0) {
    return (
      <EmptyState
        title="No shareholding data available"
        description={
          error ?? reason ?? "The provider returned no ownership breakdown for this instrument."
        }
      />
    );
  }
  const latest = periods[0];
  const anyPartial = periods.some((period) => period.partial);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-[var(--text)]">
          Ownership · {latest.label}
        </h4>
        <span className="text-[10px] text-[var(--text-3)]">
          Reported {latest.asOf ?? "date not stated"}
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {periods.slice(0, 6).map((period) => {
          const total = HOLDING_SERIES.reduce(
            (sum, series) => sum + (period[series.key] ?? 0),
            0
          );
          return (
            <div key={`${period.label}-${period.asOf ?? ""}`}>
              <div className="flex items-center justify-between text-[10px] text-[var(--text-3)]">
                <span>{period.label}</span>
                <span>{total > 0 ? `${total.toFixed(2)}% accounted for` : "Not reported"}</span>
              </div>
              <div
                className="mt-1 flex h-2.5 overflow-hidden rounded-full bg-[var(--surface-2)]"
                role="img"
                aria-label={HOLDING_SERIES.filter((series) => (period[series.key] ?? null) !== null)
                  .map((series) => `${series.label} ${period[series.key]}%`)
                  .join(", ")}
              >
                {HOLDING_SERIES.map((series) => {
                  const value = period[series.key];
                  if (value === null || value <= 0) return null;
                  return (
                    <span
                      key={series.key}
                      style={{ width: `${Math.min(100, value)}%`, background: series.color }}
                      title={`${series.label} ${value}%`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[460px] text-[11px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--text-3)]">
              <th scope="col" className="py-1.5 pr-3 font-medium">Category</th>
              {periods.slice(0, 6).map((period) => (
                <th key={period.label} scope="col" className="py-1.5 pr-3 text-right font-medium">
                  {period.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HOLDING_SERIES.map((series) => (
              <tr key={series.key} className="border-b border-[var(--border)] last:border-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-[var(--text-3)]">
                  {series.label}
                </th>
                {periods.slice(0, 6).map((period) => {
                  const value = period[series.key];
                  return (
                    <td
                      key={`${period.label}-${series.key}`}
                      className="py-1.5 pr-3 text-right tabular-nums text-[var(--text)]"
                    >
                      {value === null ? "—" : `${value.toFixed(2)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-3)]">
        A dash means the provider did not report that category — it does not mean zero holding.
        {anyPartial
          ? " Some periods do not sum to 100%, which usually means a category such as custodians or ADRs is not reported."
          : ""}
      </p>
      <ProvenanceNote provenance={latest.provenance} />
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* News                                                                */
/* ------------------------------------------------------------------ */

const DATE_WINDOWS = [
  { key: "24h", label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All", ms: Number.POSITIVE_INFINITY },
] as const;

export const NewsPanel: React.FC<{
  feed: NewsFeed | null;
  loading: boolean;
  error: string | null;
  gnewsDelayed: boolean;
}> = ({ feed, loading, error, gnewsDelayed }) => {
  const [category, setCategory] = useState<string>("all");
  const [windowKey, setWindowKey] = useState<(typeof DATE_WINDOWS)[number]["key"]>("30d");

  const categories = useMemo(() => {
    const values = new Set<string>();
    for (const item of feed?.items ?? []) {
      if (item.category) values.add(item.category);
    }
    return [...values].slice(0, 6);
  }, [feed]);

  const items = useMemo(() => {
    const cutoffWindow = DATE_WINDOWS.find((window) => window.key === windowKey);
    const cutoff = Number.isFinite(cutoffWindow?.ms ?? 0)
      ? Date.now() - (cutoffWindow?.ms ?? 0)
      : 0;
    return [...(feed?.items ?? [])]
      .filter((item) => (category === "all" ? true : item.category === category))
      .filter((item) => (cutoff === 0 ? true : (item.publishedAt ?? 0) >= cutoff))
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  }, [feed, category, windowKey]);

  const missingDates = (feed?.items.length ?? 0) > 0 && items.length === 0 &&
    feed?.items.every((item) => item.publishedAt === null);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="ml-chip-row" role="group" aria-label="News category">
          <button
            type="button"
            className={`ml-chip ${category === "all" ? "is-active" : ""}`}
            aria-pressed={category === "all"}
            onClick={() => setCategory("all")}
          >
            All news
          </button>
          {categories.map((value) => (
            <button
              key={value}
              type="button"
              className={`ml-chip ${category === value ? "is-active" : ""}`}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="ml-chip-row ml-auto" role="group" aria-label="Publication window">
          {DATE_WINDOWS.map((window) => (
            <button
              key={window.key}
              type="button"
              className={`ml-chip ${windowKey === window.key ? "is-active" : ""}`}
              aria-pressed={windowKey === window.key}
              onClick={() => setWindowKey(window.key)}
              disabled={missingDates}
            >
              {window.label}
            </button>
          ))}
        </div>
      </div>

      {gnewsDelayed ? (
        <p className="mt-2 rounded-md border border-[var(--warn,#d6a63b)] px-2 py-1.5 text-[10px] text-[var(--text-3)]">
          News is served by GNews on its free tier, which can delay articles by about 12 hours.
          Publication times below are the publisher's own.
        </p>
      ) : null}

      {loading && !feed ? (
        <p className="mt-3 text-xs text-[var(--text-3)]">Loading company news…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-[var(--text-3)]">
          {error ??
            (missingDates
              ? "Articles were returned without publication timestamps, so they cannot be shown reliably."
              : "No company-specific articles match this filter.")}
          {feed && feed.filteredIrrelevant > 0
            ? ` ${feed.filteredIrrelevant} article${feed.filteredIrrelevant === 1 ? "" : "s"} were hidden because they did not mention this company.`
            : ""}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {items.map((item) => (
            <li key={item.id} className="py-2.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                  {item.publisher ?? "Publisher not reported"}
                </span>
                <span className="text-[10px] text-[var(--text-3)]">
                  {formatIstDateTime(item.publishedAt)} IST
                </span>
                {item.category ? (
                  <span className="rounded border border-[var(--border)] px-1 py-0.5 text-[9px] uppercase tracking-wide text-[var(--text-3)]">
                    {item.category}
                  </span>
                ) : null}
                {item.sentiment ? (
                  <span className="text-[9px] uppercase tracking-wide text-[var(--text-3)]">
                    {item.sentiment}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[13px] font-medium leading-snug text-[var(--text)]">
                {item.headline}
              </p>
              {item.summary ? (
                <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-[var(--text-3)]">
                  {item.summary}
                </p>
              ) : null}
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] hover:underline"
                >
                  Read article <ExternalLink size={11} aria-hidden="true" />
                </a>
              ) : (
                <span className="mt-1.5 block text-[10px] text-[var(--text-3)]">
                  Original link not provided by the source.
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {feed ? (
        <div className="mt-2">
          <ProvenanceNote provenance={feed.provenance} />
          {feed.duplicatesRemoved > 0 ? (
            <p className="text-[10px] text-[var(--text-3)]">
              {feed.duplicatesRemoved} duplicate entr{feed.duplicatesRemoved === 1 ? "y" : "ies"}{" "}
              merged.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const EventsPanel: React.FC<{ events: CorporateEvent[]; error: string | null }> = ({
  events,
  error,
}) => {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No official filings available"
        description={
          error ??
          "The configured research provider does not expose a corporate-filings feed for this deployment."
        }
      />
    );
  }
  return (
    <ul className="divide-y divide-[var(--border)]">
      {events.map((event) => (
        <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <div className="min-w-0">
            <p className="text-[12px] text-[var(--text)]">{event.title}</p>
            <p className="text-[10px] text-[var(--text-3)]">
              {event.type} · {formatIstDate(event.date)} · {event.source}
              {event.period ? ` · ${event.period}` : ""}
            </p>
          </div>
          {event.url ? (
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-medium text-[var(--accent)] hover:underline"
            >
              Open filing
            </a>
          ) : (
            <span className="text-[10px] text-[var(--text-3)]">No document link</span>
          )}
        </li>
      ))}
    </ul>
  );
};

/* ------------------------------------------------------------------ */
/* Peers                                                               */
/* ------------------------------------------------------------------ */

export const PeersPanel: React.FC<{ profile: CompanyProfile | null; reason: string | null }> = ({
  profile,
  reason,
}) => {
  if (!profile || profile.peers.length === 0) {
    return (
      <EmptyState
        title="No verified peers"
        description={
          reason ??
          "The research provider did not return a peer mapping for this company. Comparable metrics are never inferred from similar company names."
        }
      />
    );
  }
  return (
    <div>
      <div className="ml-chip-row">
        {profile.peers.map((peer) => (
          <span key={peer} className="ml-chip">
            {peer}
          </span>
        ))}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-3)]">
        Peer symbols come from the provider's own mapping. Comparative valuation and return metrics
        require a peer-level research payload, which this provider response does not include — so no
        ranking is shown rather than a partial comparison.
      </p>
      <ProvenanceNote provenance={profile.provenance} label="Peer list" />
    </div>
  );
};
