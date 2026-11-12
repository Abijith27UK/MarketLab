import React, { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { RefreshCw, Upload } from "lucide-react";
import { useRootContext } from "@/context/RootContext";
import { Card, Button, SectionHeader } from "@/components/ui";
import PageHeader from "@/components/layout/PageHeader";
import BackendRequired from "@/components/system/BackendRequired";
import DataModeBadge from "@/components/market/DataModeBadge";
import {
  INTERVAL_LABEL,
  marketApi,
  type ProviderOverview,
  type ProviderStatus,
  type TestProviderResult,
} from "@/lib/marketClient";
import { formatAge, formatDateTime } from "@/lib/format";

const CAPABILITY_LABELS: Record<string, string> = {
  instruments: "Instrument lookup",
  instrumentSync: "Instrument master sync",
  quotes: "Quotes",
  candles: "Historical candles",
  streaming: "Streaming feed",
  fundamentals: "Fundamentals",
  marketStatus: "Market status",
};

/** Short, factual cadence line per provider, derived from its declared capabilities. */
const describeCadence = (provider: ProviderStatus): string => {
  if (!provider.capabilities.candles.supported) return "No candle history";
  const intervals = provider.capabilities.candles.intervals ?? [];
  if (intervals.length === 1 && intervals[0] === "1d") {
    return "Daily / EOD only — completed sessions, never intraday or live";
  }
  return intervals.length > 0
    ? `Intraday and daily: ${intervals.map((interval) => INTERVAL_LABEL[interval]).join(", ")}`
    : "Candles supported";
};

const SETUP: Record<string, string[]> = {
  fyers: [
    "npx convex env set FYERS_APP_ID <your-app-id>",
    "npx convex env set FYERS_SECRET_ID <your-secret-id>",
    "npx convex env set FYERS_ACCESS_TOKEN <daily-access-token>",
    "Access tokens expire daily at 06:30 IST; refresh with FYERS_REFRESH_TOKEN or re-authorise.",
  ],
  breeze: [
    "npx convex env set BREEZE_APP_KEY <your-app-key>",
    "npx convex env set BREEZE_SECRET_KEY <your-secret-key>",
    "npx convex env set BREEZE_SESSION_TOKEN <session-token-from-customer-login>",
    "The session token comes from an interactive ICICI Direct login and expires within ~24 hours.",
  ],
  tapetide: [
    "npx convex env set TAPETIDE_API_TOKEN <your-personal-token>",
    "Research reads Tapetide's MCP server. Its REST API is not included in the Free plan (verified 2026-11-12).",
    "Enables the company profile, financial statements, shareholding, corporate actions and company news on instrument pages.",
    "Optional research only: it never replaces the selected quote provider and never feeds paper fills or valuations.",
  ],
  gnews: [
    "Optional: npx convex env set GNEWS_API_KEY <your-key>",
    "Only used when Tapetide is unavailable for news; free-tier articles can be delayed ~12 hours.",
    "The key stays in the Convex backend and is never sent to the browser.",
  ],
  nsemcp: [
    "npx convex env set NSE_MCP_POC_ENABLED true",
    "Private educational proof of concept: do not publish, redistribute or monetize this feed.",
    "NSE documents an approximately 1–3 minute delay. Quotes are always labelled DELAYED.",
    "Never used for paper fills, alerts, portfolio valuation or backtests.",
  ],
};

const STATUS_LABEL: Record<string, string> = {
  ok: "Connected",
  off: "Not configured",
  warn: "Action needed",
};

const StatusPill: React.FC<{ tone: "ok" | "warn" | "off"; children: React.ReactNode }> = ({
  tone,
  children,
}) => <span className={`ml-status-pill is-${tone}`}>{children}</span>;

const DataSourcesLive: React.FC = () => {
  const { isAuthenticated } = useRootContext();
  const overviewAction = useAction(marketApi.providerOverview);
  const testProvider = useAction(marketApi.testProvider);
  const syncInstruments = useAction(marketApi.syncInstruments);
  const deleteImport = useMutation(marketApi.deleteImport);
  const setQuoteProvider = useMutation(marketApi.setQuoteProvider);
  const imports = useQuery(marketApi.listImports, {});

  const [overview, setOverview] = useState<ProviderOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestProviderResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [savingSource, setSavingSource] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setOverview(await overviewAction());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load provider status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runTest = async (provider: ProviderStatus) => {
    setTesting(provider.providerId);
    try {
      const result = await testProvider({ providerId: provider.providerId });
      setTestResults((current) => ({ ...current, [provider.providerId]: result }));
      await load();
    } catch (err) {
      setTestResults((current) => ({
        ...current,
        [provider.providerId]: {
          providerId: provider.providerId,
          ok: false,
          latencyMs: 0,
          message: err instanceof Error ? err.message : "Test failed",
        },
      }));
    } finally {
      setTesting(null);
    }
  };

  const chooseSource = async (id: "tejhq" | "nsemcp") => {
    setSavingSource(id);
    try {
      await setQuoteProvider({ provider: id });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch quote source");
    } finally {
      setSavingSource(null);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const result = await syncInstruments({ exchanges: ["NSE", "BSE"] });
      setSyncStatus(
        `Synced ${result.total} instruments from ${result.providerId} (${result.inserted} new, ${result.updated} updated).`
      );
      await load();
    } catch (err) {
      setSyncStatus(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Data Sources"
        description="Provider status, credentials and historical imports. Credentials live only in the Convex deployment environment — never in the browser bundle, never in Git."
        meta={
          overview ? (
            <>
              <DataModeBadge
                mode={overview.coverage.providerQuotes > 0 ? "DELAYED" : "SAMPLE"}
                source={overview.coverage.eodQuotes > 0 ? "eod" : undefined}
              />
              <span className="ml-metric__hint">
                {overview.coverage.providerQuotes} stored prices ·{" "}
                {overview.coverage.cachedCandleSeries} cached series
              </span>
            </>
          ) : null
        }
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} aria-hidden="true" />
            {loading ? "Refreshing…" : "Refresh status"}
          </Button>
        }
      />

      {loading && !overview && (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="skeleton" style={{ height: 92 }} />
          <span className="skeleton" style={{ height: 180 }} />
        </div>
      )}
      {error && (
        <p role="alert" className="ml-field-error mb-4">
          {error}
        </p>
      )}

      {overview && (
        <Card className="mb-4">
          <div className="ml-metric-grid">
            <div className="ml-metric">
              <p className="ml-metric__label">Exchange session</p>
              <p className="ml-metric__value">
                {overview.session.label} · {overview.session.istTime} IST
              </p>
              <p className="ml-metric__hint">
                {overview.holidaysConfigured
                  ? "Holiday calendar configured"
                  : "Holiday calendar not configured"}
              </p>
            </div>
            <div className="ml-metric">
              <p className="ml-metric__label">Catalogue</p>
              <p className="ml-metric__value">{overview.catalogue.total} instruments</p>
              <p className="ml-metric__hint">
                {overview.catalogue.provider} from a provider · {overview.catalogue.sample} sample
              </p>
            </div>
            <div className="ml-metric">
              <p className="ml-metric__label">Candle intervals</p>
              <p className="ml-metric__value">
                {overview.availableIntervals.length === 0
                  ? "Sample only"
                  : overview.availableIntervals
                      .map((interval) => INTERVAL_LABEL[interval])
                      .join(", ")}
              </p>
              <p className="ml-metric__hint">From configured providers</p>
            </div>
            <div className="ml-metric">
              <p className="ml-metric__label">Latest session in store</p>
              <p className="ml-metric__value ml-mono">
                {overview.coverage.latestQuoteSessionDate ??
                  overview.coverage.latestCandleDate ??
                  "none yet"}
              </p>
              <p className="ml-metric__hint">
                {overview.coverage.providerQuotes === 0
                  ? "No real prices stored — every price is sample data."
                  : overview.coverage.eodQuotes === overview.coverage.providerQuotes
                    ? "End-of-day closes only. Nothing here is live or intraday."
                    : "Each value keeps its own freshness label."}
              </p>
            </div>
          </div>
        </Card>
      )}

      {overview && (
        <Card className="mb-4">
          <SectionHeader
            title="Quote source"
            description="Which provider prices the informational quote views — dashboard cards, Markets and instrument details. Switching never resets watchlists, instruments or orders, and never changes paper fills, alerts or backtests."
          />
          <div className="ml-source-options mt-3">
            {[
              {
                id: "tejhq" as const,
                name: "TejHQ",
                tag: "End-of-day data",
                detail: "Latest available market close and historical daily data.",
                available: true,
              },
              {
                id: "nsemcp" as const,
                name: "NSE MCP",
                tag: "Experimental · Delayed market data",
                detail:
                  "Official NSE MCP market snapshots, subject to connection availability and verified provider support.",
                available: overview.nseMcpEnabled,
              },
            ].map((option) => {
              const active = overview.preferredQuoteProvider === option.id;
              return (
                <div
                  key={option.id}
                  className={`ml-source-option${active ? " is-active" : ""}`}
                >
                  <div className="ml-source-option__head">
                    <span className="ml-source-option__name">{option.name}</span>
                    {active ? <StatusPill tone="ok">Selected</StatusPill> : null}
                    {!option.available ? <StatusPill tone="off">Disabled</StatusPill> : null}
                  </div>
                  <p className="ml-source-option__tag">{option.tag}</p>
                  <p className="ml-metric__hint">{option.detail}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={active ? "secondary" : "primary"}
                      disabled={
                        active ||
                        !option.available ||
                        !isAuthenticated ||
                        savingSource !== null
                      }
                      onClick={() => void chooseSource(option.id)}
                    >
                      {active
                        ? "In use"
                        : savingSource === option.id
                          ? "Switching…"
                          : "Use this source"}
                    </Button>
                    {option.id === "nsemcp" && !option.available ? (
                      <span className="ml-metric__hint">
                        Set NSE_MCP_POC_ENABLED=true on the deployment to enable.
                      </span>
                    ) : null}
                    {option.id === "nsemcp" && option.available ? (
                      <span className="ml-metric__hint">
                        Informational only — never used to price orders.
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {!isAuthenticated ? (
            <p className="ml-metric__hint mt-2">
              Sign in to choose a source. Signed-out views use the TejHQ default.
            </p>
          ) : null}
        </Card>
      )}

      <div className="mb-4 grid grid-cols-1 gap-4">
        {(overview?.providers ?? []).map((provider) => {
          const test = testResults[provider.providerId];
          const tone = provider.configured ? "ok" : "warn";
          return (
            <Card key={provider.providerId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="ml-section-title">{provider.label}</h2>
                    <StatusPill tone={tone}>{STATUS_LABEL[tone]}</StatusPill>
                    {test && (
                      <StatusPill tone={test.ok ? "ok" : "off"}>
                        {test.ok ? "Connection verified" : "Connection failed"}
                      </StatusPill>
                    )}
                  </div>
                  <p className="ml-metric__hint mt-1">
                    Auth:{" "}
                    {provider.authMode === "none"
                      ? "keyless — no credentials required"
                      : provider.authMode.replace(/_/g, " ")}{" "}
                    ·{" "}
                    <a
                      className="text-[var(--accent)] hover:underline"
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      official docs
                    </a>
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!isAuthenticated || testing === provider.providerId}
                  onClick={() => void runTest(provider)}
                >
                  {testing === provider.providerId ? "Testing…" : "Test connection"}
                </Button>
              </div>

              {!provider.configured && (
                <div className="ml-setup mt-3">
                  <p className="font-semibold">Missing configuration</p>
                  <p className="mt-1">{provider.missingEnv.join(", ") || "unknown"}</p>
                  <pre className="ml-setup__code">{SETUP[provider.providerId]?.join("\n")}</pre>
                </div>
              )}

              {test && (
                <p
                  role="status"
                  className={`mt-3 text-[11px] ${test.ok ? "text-[var(--pos)]" : "text-[var(--neg)]"}`}
                >
                  {test.message}
                  {test.latencyMs > 0 ? ` · ${test.latencyMs} ms` : ""}
                </p>
              )}

              <p className="ml-detail-note mt-3">
                Data frequency: <span className="text-[var(--text-2)]">{describeCadence(provider)}</span>
              </p>

              <div className="ml-caps mt-3">
                {Object.entries(provider.capabilities).map(([name, descriptor]) => (
                  <div
                    key={name}
                    className={`ml-cap${descriptor.supported ? "" : " is-off"}`}
                    title={descriptor.note ?? ""}
                  >
                    <span className="ml-cap__name">{CAPABILITY_LABELS[name] ?? name}</span>
                    <span className="ml-cap__value">
                      {descriptor.supported
                        ? descriptor.intervals
                          ? descriptor.intervals.map((i) => INTERVAL_LABEL[i]).join(" ")
                          : "supported"
                        : "not available"}
                    </span>
                  </div>
                ))}
              </div>

              <dl className="ml-kv mt-3">
                <div>
                  <dt>Last success</dt>
                  <dd>{provider.lastSuccessAt ? formatAge(provider.lastSuccessAt, Date.now()) : "never"}</dd>
                </div>
                <div>
                  <dt>Last trading date</dt>
                  <dd className="ml-mono">{provider.lastDataDate ?? "—"}</dd>
                </div>
                <div>
                  <dt>Last attempt</dt>
                  <dd>{provider.lastAttemptAt ? formatDateTime(provider.lastAttemptAt) : "never"}</dd>
                </div>
                <div>
                  <dt>Requests this minute</dt>
                  <dd className="ml-mono">
                    {provider.rateWindowCount}/{provider.rateLimitPerMinute}
                    {provider.dailyLimit ? ` · ${provider.dailyCount}/${provider.dailyLimit} today` : ""}
                  </dd>
                </div>
                <div>
                  <dt>Instruments synced</dt>
                  <dd>
                    {provider.instrumentCount ?? 0}
                    {provider.instrumentsSyncedAt
                      ? ` · ${formatAge(provider.instrumentsSyncedAt, Date.now())}`
                      : ""}
                  </dd>
                </div>
              </dl>

              {provider.lastError && (
                <p className="ml-field-error mt-2">Last error: {provider.lastError}</p>
              )}

              <ul className="ml-provider__notes">
                {provider.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      <Card className="mb-4">
        <SectionHeader
          title="What each feature is using"
          description="Derived from the data actually stored in this deployment — not from “a provider is configured”. End-of-day closes are shown as DELAYED and are never treated as live or intraday prices."
        />
        <ul className="mt-3 space-y-1">
          {(overview?.features ?? []).map((feature) => (
            <li key={feature.key} className="ml-feature-row">
              <span className="min-w-48 text-[var(--text-2)]">{feature.label}</span>
              {feature.mode === "UNAVAILABLE" ? (
                <StatusPill tone="off">UNAVAILABLE</StatusPill>
              ) : (
                <DataModeBadge mode={feature.mode} />
              )}
              <span className="text-[11px] text-[var(--text-3)]">{feature.detail}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-4">
        <SectionHeader
          title="Instrument master"
          description="Sync the exchange instrument list from a configured provider. A failed or empty sync never replaces existing instruments — the sample records stay usable offline."
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => void runSync()}
            disabled={!isAuthenticated || syncing || !overview?.hasConfiguredProvider}
          >
            <RefreshCw size={13} aria-hidden="true" />
            {syncing ? "Syncing…" : "Sync NSE + BSE instruments"}
          </Button>
          {!isAuthenticated && (
            <span className="ml-metric__hint">Sign in to sync.</span>
          )}
          {isAuthenticated && !overview?.hasConfiguredProvider && (
            <span className="ml-ticket__hint ml-ticket__hint--warn">
              Configure a provider that publishes an instrument master (TejHQ is keyless) to enable
              this sync.
            </span>
          )}
        </div>
        {syncStatus && (
          <p role="status" className="ml-ticket__notice mt-2">
            {syncStatus}
          </p>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Your historical imports"
          description="CSV imports are private to your account and stored as separate datasets so they are never mixed with provider candles."
        />
        {!isAuthenticated && (
          <p className="ml-metric__hint mt-3">Sign in to view imports.</p>
        )}
        {isAuthenticated && (imports ?? []).length === 0 && (
          <div className="ml-empty-block mt-3">
            <p className="ml-empty-block__title">No imports yet</p>
            <p className="ml-empty-block__body">
              Open an instrument and upload an OHLCV CSV to build a private dataset.
            </p>
            <span className="ml-metric__hint">
              <Upload size={11} aria-hidden="true" /> Instrument → Historical data → CSV file
            </span>
          </div>
        )}
        <ul className="mt-3 space-y-2">
          {(imports ?? []).map((record) => (
            <li key={record._id} className="ml-list-row">
              <span className="min-w-0">
                <span className="ml-data-table__symbol">{record.instrumentLabel}</span>
                <span className="ml-data-table__name">
                  {INTERVAL_LABEL[record.interval]} · {record.fileName}
                </span>
              </span>
              <span className="text-[11px] text-[var(--text-3)]">
                {record.acceptedRows} rows · {record.rejectedRows} rejected ·{" "}
                {record.status === "failed" ? (
                  <span className="text-[var(--neg)]">failed</span>
                ) : (
                  formatDateTime(record.firstTs)
                )}
              </span>
              <button
                type="button"
                className="ml-row-action is-danger"
                onClick={() => {
                  if (confirm("Delete this imported dataset?")) {
                    void deleteImport({ importId: record._id });
                  }
                }}
              >
                Delete
              </button>
              {record.error && <span className="w-full text-[var(--neg)]">Error: {record.error}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

/* Backend-gated: provider credentials and health live in the Convex deployment. */
const DataSources: React.FC = () => {
  const { backendOnline } = useRootContext();
  if (!backendOnline) {
    return (
      <BackendRequired
        feature="Data Sources"
        description="Provider status, connection tests, instrument sync and CSV imports all run server-side, so credential values never reach the browser."
      />
    );
  }
  return <DataSourcesLive />;
};

export default DataSources;
