import React, { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useRootContext } from "@/context/RootContext";
import { Card, Button } from "@/components/ui";
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
    "Free plan: 50 successful requests per IST day.",
  ],
};

const DataSourcesLive: React.FC = () => {
  const { isAuthenticated } = useRootContext();
  const overviewAction = useAction(marketApi.providerOverview);
  const testProvider = useAction(marketApi.testProvider);
  const syncInstruments = useAction(marketApi.syncInstruments);
  const deleteImport = useMutation(marketApi.deleteImport);
  const imports = useQuery(marketApi.listImports, {});

  const [overview, setOverview] = useState<ProviderOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestProviderResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

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
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Data Sources</h1>
        <p className="text-gray-400">
          Provider status, credentials and historical imports. Credentials live only in the Convex
          deployment environment — never in the browser bundle, never in Git.
        </p>
      </header>

      {loading && <p className="text-sm text-gray-400">Loading provider status…</p>}
      {error && (
        <p role="alert" className="mb-4 text-sm text-red-400">
          {error}
        </p>
      )}

      {overview && (
        <Card className="mb-6">
          <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-5">
            <div>
              <p className="text-gray-500">Exchange session</p>
              <p className="text-gray-200">
                {overview.session.label} · {overview.session.istTime} IST
              </p>
              <p className="text-xs text-gray-600">
                {overview.holidaysConfigured
                  ? "Holiday calendar configured"
                  : "Holiday calendar not configured"}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Catalogue</p>
              <p className="text-gray-200">
                {overview.catalogue.total} instruments ({overview.catalogue.provider} provider,{" "}
                {overview.catalogue.sample} sample)
              </p>
            </div>
            <div>
              <p className="text-gray-500">Candle intervals available</p>
              <p className="text-gray-200">
                {overview.availableIntervals.length === 0
                  ? "Sample data only"
                  : overview.availableIntervals.map((interval) => INTERVAL_LABEL[interval]).join(", ")}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Latest session in store</p>
              <p>
                <span className="ml-mono text-gray-200">
                  {overview.coverage.latestQuoteSessionDate ??
                    overview.coverage.latestCandleDate ??
                    "none yet"}
                </span>
              </p>
              <p className="text-xs text-gray-600">
                {overview.coverage.providerQuotes} stored prices ·{" "}
                {overview.coverage.cachedCandleSeries} cached series
              </p>
            </div>
            <div>
              <p className="text-gray-500">Data mode</p>
              <p>
                <DataModeBadge
                  mode={overview.coverage.providerQuotes > 0 ? "DELAYED" : "SAMPLE"}
                  source={overview.coverage.eodQuotes > 0 ? "eod" : undefined}
                />
              </p>
              <p className="text-xs text-gray-600">
                {overview.coverage.providerQuotes === 0
                  ? "No real prices stored — every price is sample data."
                  : overview.coverage.eodQuotes === overview.coverage.providerQuotes
                    ? "End-of-day closes only. Nothing here is live or intraday."
                    : "Providers configured; each value keeps its own freshness label."}
              </p>
            </div>
          </div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4">
        {(overview?.providers ?? []).map((provider) => {
          const test = testResults[provider.providerId];
          return (
            <Card key={provider.providerId}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{provider.label}</h2>
                  <p className="text-xs text-gray-500">
                    Auth:{" "}
                    {provider.authMode === "none"
                      ? "keyless — no credentials required"
                      : provider.authMode.replace(/_/g, " ")}{" "}
                    ·{" "}
                    <a
                      className="text-emerald-400 hover:underline"
                      href={provider.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      official docs
                    </a>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      provider.configured
                        ? "border-emerald-500/60 text-emerald-300"
                        : "border-amber-500/60 text-amber-300"
                    }`}
                  >
                    {provider.configured ? "Configured" : "Not configured"}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!isAuthenticated || testing === provider.providerId}
                    onClick={() => void runTest(provider)}
                  >
                    {testing === provider.providerId ? "Testing…" : "Test connection"}
                  </Button>
                </div>
              </div>

              {!provider.configured && (
                <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
                  <p className="font-medium">Missing configuration</p>
                  <p className="mt-1">{provider.missingEnv.join(", ") || "unknown"}</p>
                  <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-amber-100/90">
                    {SETUP[provider.providerId]?.join("\n")}
                  </pre>
                </div>
              )}

              {test && (
                <p
                  role="status"
                  className={`mb-3 text-xs ${test.ok ? "text-emerald-400" : "text-red-400"}`}
                >
                  {test.ok ? "Connection verified" : "Connection failed"} · {test.message}
                  {test.latencyMs > 0 ? ` (${test.latencyMs} ms)` : ""}
                </p>
              )}

              <p className="mb-2 text-xs text-gray-400">
                Data frequency: <span className="text-gray-200">{describeCadence(provider)}</span>
              </p>

              <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                {Object.entries(provider.capabilities).map(([name, descriptor]) => (
                  <div
                    key={name}
                    className={`rounded border px-2 py-1.5 ${
                      descriptor.supported
                        ? "border-gray-700 text-gray-200"
                        : "border-gray-800 text-gray-600"
                    }`}
                    title={descriptor.note ?? ""}
                  >
                    <div className="font-medium">{CAPABILITY_LABELS[name] ?? name}</div>
                    <div className="text-[11px] opacity-80">
                      {descriptor.supported
                        ? descriptor.intervals
                          ? descriptor.intervals.map((i) => INTERVAL_LABEL[i]).join(" ")
                          : "supported"
                        : "not available"}
                    </div>
                  </div>
                ))}
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400 md:grid-cols-4">
                <div>
                  <dt className="text-gray-500">Last success</dt>
                  <dd>{provider.lastSuccessAt ? formatAge(provider.lastSuccessAt, Date.now()) : "never"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Last trading date</dt>
                  <dd className="ml-mono">{provider.lastDataDate ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Last attempt</dt>
                  <dd>{provider.lastAttemptAt ? formatDateTime(provider.lastAttemptAt) : "never"}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Requests this minute</dt>
                  <dd>
                    {provider.rateWindowCount}/{provider.rateLimitPerMinute}
                    {provider.dailyLimit ? ` · ${provider.dailyCount}/${provider.dailyLimit} today` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Instruments synced</dt>
                  <dd>
                    {provider.instrumentCount ?? 0}
                    {provider.instrumentsSyncedAt
                      ? ` · ${formatAge(provider.instrumentsSyncedAt, Date.now())}`
                      : ""}
                  </dd>
                </div>
              </dl>

              {provider.lastError && (
                <p className="mt-2 text-xs text-red-400">Last error: {provider.lastError}</p>
              )}

              <ul className="mt-3 space-y-1 text-[11px] text-gray-500">
                {provider.notes.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      <Card className="mb-6">
        <h2 className="mb-1 text-lg font-semibold">What each feature is using</h2>
        <p className="mb-3 text-sm text-gray-400">
          Derived from the data actually stored in this deployment — not from “a provider is
          configured”. End-of-day closes are shown as DELAYED and are never treated as live or
          intraday prices.
        </p>
        <ul className="space-y-2">
          {(overview?.features ?? []).map((feature) => (
            <li
              key={feature.key}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-800 pb-2 text-sm last:border-0"
            >
              <span className="min-w-48 text-gray-200">{feature.label}</span>
              {feature.mode === "UNAVAILABLE" ? (
                <span className="rounded-full border border-red-500/60 px-2 py-0.5 text-[11px] text-red-300">
                  UNAVAILABLE
                </span>
              ) : (
                <DataModeBadge mode={feature.mode} />
              )}
              <span className="text-xs text-gray-500">{feature.detail}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Instrument master</h2>
        <p className="text-sm text-gray-400">
          Sync the exchange instrument list from a configured provider. A failed or empty sync never
          replaces existing instruments — the 15 sample records stay usable offline.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => void runSync()}
            disabled={!isAuthenticated || syncing || !overview?.hasConfiguredProvider}
          >
            {syncing ? "Syncing…" : "Sync NSE + BSE instruments"}
          </Button>
          {!isAuthenticated && <span className="text-xs text-gray-500">Sign in to sync.</span>}
          {isAuthenticated && !overview?.hasConfiguredProvider && (
            <span className="text-xs text-amber-400/80">
              Configure a provider that publishes an instrument master (TejHQ is keyless) to enable
              this sync.
            </span>
          )}
        </div>
        {syncStatus && <p className="mt-2 text-xs text-emerald-400">{syncStatus}</p>}
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold">Your historical imports</h2>
        <p className="text-sm text-gray-400">
          CSV imports are private to your account and stored as separate datasets so they are never
          mixed with provider candles.
        </p>
        {!isAuthenticated && <p className="mt-3 text-sm text-gray-500">Sign in to view imports.</p>}
        {isAuthenticated && (imports ?? []).length === 0 && (
          <p className="mt-3 text-sm text-gray-500">
            No imports yet. Open an instrument and upload an OHLCV CSV.
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {(imports ?? []).map((record) => (
            <li
              key={record._id}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-800 px-3 py-2 text-xs"
            >
              <span>
                <b className="text-gray-200">{record.instrumentLabel}</b> ·{" "}
                {INTERVAL_LABEL[record.interval]} · {record.fileName}
              </span>
              <span className="text-gray-500">
                {record.acceptedRows} rows · {record.rejectedRows} rejected ·{" "}
                {record.status === "failed" ? (
                  <span className="text-red-400">failed</span>
                ) : (
                  formatDateTime(record.firstTs)
                )}
              </span>
              <button
                className="text-red-400 hover:text-red-300"
                onClick={() => {
                  if (confirm("Delete this imported dataset?")) {
                    void deleteImport({ importId: record._id });
                  }
                }}
              >
                Delete
              </button>
              {record.error && (
                <span className="w-full text-red-400">Error: {record.error}</span>
              )}
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
