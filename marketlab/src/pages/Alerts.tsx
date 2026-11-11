import React, { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useRootContext } from "@/context/RootContext";
import { Button, Card, Input, Select } from "@/components/ui";
import AuthPanel from "@/components/AuthPanel";
import BackendRequired from "@/components/system/BackendRequired";
import DataModeBadge from "@/components/market/DataModeBadge";
import { marketApi } from "@/lib/marketClient";
import { instrumentIdOf } from "@/lib/stockModels";
import {
  ALERT_DIRECTION_LABEL,
  formatAlertCondition,
  validateAlertDraft,
  type AlertDirection,
} from "@/lib/alerts";
import { formatAge, formatDateTime, formatPrice } from "@/lib/format";
import { friendlyError } from "@/lib/errors";

/**
 * Price threshold alerts.
 *
 * This deployment has no background scheduler and no delivery channel, so alerts
 * are evaluated only when the owner runs a check. The button says so, the result
 * reports exactly how many alerts were seen, and every row keeps the price and
 * freshness label that was actually used. A SAMPLE price can trigger an alert,
 * and when it does the trigger is labelled SAMPLE instead of being presented as a
 * real market event.
 */
const AlertsLive: React.FC = () => {
  const { isAuthenticated, loading } = useRootContext();
  const alerts = useQuery(api.alerts.list, {});
  const createAlert = useMutation(api.alerts.create);
  const updateAlert = useMutation(api.alerts.update);
  const setStatus = useMutation(api.alerts.setStatus);
  const rearm = useMutation(api.alerts.rearm);
  const removeAlert = useMutation(api.alerts.remove);
  const evaluate = useAction(api.alerts.evaluate);

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [instrumentId, setInstrumentId] = useState("");
  const [direction, setDirection] = useState<AlertDirection>("ABOVE");
  const [threshold, setThreshold] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [editingAlertId, setEditingAlertId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const results = useQuery(marketApi.searchInstruments, {
    search: debounced,
    exchange: "NSE",
    instrumentType: "EQUITY",
    limit: 20,
  });

  const instruments = useMemo(
    () =>
      (results?.items ?? []).map((row) => ({
        value: instrumentIdOf(row),
        label: `${row.symbol} — ${row.name}`,
      })),
    [results]
  );

  useEffect(() => {
    if (instruments.length === 0) return;
    if (instruments.some((instrument) => instrument.value === instrumentId)) return;
    setInstrumentId(instruments[0].value);
  }, [instruments, instrumentId]);

  const submit = async () => {
    const problem = validateAlertDraft({ instrumentId, direction, threshold, note });
    if (problem) {
      setError(problem);
      setNotice(null);
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      if (editingAlertId) {
        await updateAlert({
          alertId: editingAlertId as Id<"priceAlerts">,
          threshold: Number(threshold),
          direction,
          note: note.trim(),
        });
        setEditingAlertId(null);
        setThreshold("");
        setNote("");
        setNotice("Alert updated. Run a check to evaluate the new level.");
      } else {
        await createAlert({
          instrumentId,
          direction,
          threshold: Number(threshold),
          note: note.trim() || undefined,
        });
        setThreshold("");
        setNote("");
        setNotice("Alert created. Use “Check now” to evaluate it against the latest eligible price.");
      }
    } catch (err) {
      setError(friendlyError(err, editingAlertId ? "Could not update the alert." : "Could not create the alert."));
    } finally {
      setPending(false);
    }
  };

  const startEditing = (alert: NonNullable<typeof alerts>[number]) => {
    setEditingAlertId(alert._id);
    setInstrumentId(alert.instrumentId);
    setDirection(alert.direction);
    setThreshold(String(alert.threshold));
    setNote(alert.note);
    setError(null);
    setNotice(null);
  };

  const cancelEditing = () => {
    setEditingAlertId(null);
    setThreshold("");
    setNote("");
  };

  const runCheck = async () => {
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      const summary = await evaluate({});
      const parts = [
        `Checked ${summary.evaluated} alert${summary.evaluated === 1 ? "" : "s"}`,
        `${summary.triggered} triggered`,
      ];
      if (summary.skippedNoPrice > 0) parts.push(`${summary.skippedNoPrice} had no usable price`);
      if (summary.skippedStale > 0) {
        parts.push(`${summary.skippedStale} only had a stale price, so they were not fired`);
      }
      if (summary.skippedEod > 0) {
        parts.push(
          `${summary.skippedEod} only had an end-of-day close, which is recorded but never fires`
        );
      }
      if (summary.triggeredSample > 0) {
        parts.push(`${summary.triggeredSample} of those triggered on SAMPLE prices`);
      }
      setNotice(`${parts.join(" · ")}. Evaluated ${formatAge(summary.asOf, Date.now())}.`);
    } catch (err) {
      setError(friendlyError(err, "The alert check failed."));
    } finally {
      setChecking(false);
    }
  };

  const act = async (action: () => Promise<unknown>, message: string) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
    } catch (err) {
      setError(friendlyError(err, "That action failed."));
    } finally {
      setPending(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-gray-400">Loading alerts…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="ml-page-title">Alerts</h1>
        <p className="ml-page-sub">
          Price threshold alerts are stored per user. Sign in to create and evaluate your own.
        </p>
        <Card className="mt-5 max-w-md">
          <AuthPanel />
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <header className="ml-page-head">
        <div>
          <h1 className="ml-page-title">Alerts</h1>
          <p className="ml-page-sub">
            Threshold checks against the latest eligible price. Evaluation is manual — there is no
            scheduler or notification delivery in this deployment.
          </p>
        </div>
        <div className="ml-page-head-side">
          <Button variant="secondary" size="sm" onClick={() => void runCheck()} disabled={checking}>
            {checking ? "Checking…" : "Check now"}
          </Button>
        </div>
      </header>

      <p className="ml-alert-caveat" data-testid="alerts-caveat">
        Alerts never evaluate in the background and nothing is emailed or pushed. Each alert keeps
        the price, source and freshness label from the check that last touched it. A trigger based on
        a SAMPLE price is marked SAMPLE and is not a real market event.
      </p>

      {error && (
        <p className="ml-inline-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ml-inline-notice" role="status">
          {notice}
        </p>
      )}

      <Card className="mt-5">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">
              {editingAlertId ? "Edit alert" : "New alert"}
            </h2>
            <p className="ml-section-sub">
              Equity and ETF instruments only. A triggered alert must be re-armed before editing.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Input
              label="Find instrument"
              placeholder="Search symbol or company"
              value={search}
              onChange={setSearch}
            />
            <div className="mt-3">
              <Select
                label="Instrument"
                value={instrumentId}
                onSelect={setInstrumentId}
                options={instruments}
                disabled={editingAlertId !== null}
                placeholder={results === undefined ? "Searching…" : "Select instrument"}
              />
            </div>
          </div>
          <Select
            label="Condition"
            value={direction}
            onSelect={(value) => setDirection(value as AlertDirection)}
            options={[
              { value: "ABOVE", label: ALERT_DIRECTION_LABEL.ABOVE },
              { value: "BELOW", label: ALERT_DIRECTION_LABEL.BELOW },
            ]}
          />
          <Input
            label="Threshold (₹)"
            type="number"
            placeholder="e.g. 1500"
            value={threshold}
            onChange={setThreshold}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[2fr_auto] md:items-end">
          <Input
            label="Note (optional)"
            placeholder="Why this level matters"
            value={note}
            onChange={setNote}
          />
          <div className="flex items-end gap-2">
            <Button onClick={() => void submit()} disabled={pending || !instrumentId}>
              {pending ? "Saving…" : editingAlertId ? "Update alert" : "Create alert"}
            </Button>
            {editingAlertId && (
              <Button variant="secondary" onClick={cancelEditing} disabled={pending}>
                Cancel edit
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="mt-6">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">Your alerts</h2>
            <p className="ml-section-sub">
              {alerts === undefined
                ? "Loading…"
                : `${alerts.length} alert${alerts.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {alerts === undefined && <p className="ml-empty">Loading alerts…</p>}
        {alerts?.length === 0 && (
          <p className="ml-empty" data-testid="alerts-empty">
            No alerts yet. Create one above, then use “Check now” to evaluate it.
          </p>
        )}

        {alerts && alerts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="ml-table" data-testid="alerts-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Condition</th>
                  <th>Status</th>
                  <th className="is-right">Last price</th>
                  <th>Last checked</th>
                  <th>Trigger</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert._id} data-alert-id={alert._id} data-status={alert.status}>
                    <td>
                      <div className="flex flex-col">
                        <span className="text-gray-200">{alert.symbol}</span>
                        <span className="text-xs text-gray-500">
                          {alert.exchange}
                          {alert.note ? ` · ${alert.note}` : ""}
                        </span>
                      </div>
                    </td>
                    <td className="ml-mono text-sm">
                      {formatAlertCondition(alert.direction, alert.threshold)}
                    </td>
                    <td>
                      <span className="ml-order-status" data-status={alert.status}>
                        {alert.status}
                      </span>
                    </td>
                    <td className="is-right ml-mono">
                      <span className="flex items-center justify-end gap-1.5">
                        {alert.lastPrice === null ? "—" : formatPrice(alert.lastPrice)}
                        {alert.lastMode && (
                          <DataModeBadge mode={alert.lastMode} source={alert.lastSource ?? undefined} />
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-xs text-gray-400">
                      {alert.lastEvaluatedAt === null
                        ? "never"
                        : formatDateTime(alert.lastEvaluatedAt)}
                    </td>
                    <td className="text-xs">
                      {alert.triggeredAt === null ? (
                        "—"
                      ) : (
                        <span className="flex flex-col gap-1">
                          <span>
                            {formatPrice(alert.triggerPrice)} ·{" "}
                            {formatDateTime(alert.triggeredAt)}
                          </span>
                          {alert.triggerMode && <DataModeBadge mode={alert.triggerMode} />}
                          {alert.triggerMode === "SAMPLE" && (
                            <span className="text-amber-400">
                              SAMPLE price — not a real market move
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex justify-end gap-2">
                        {alert.status !== "TRIGGERED" && (
                          <button
                            type="button"
                            className="ml-row-action"
                            disabled={pending}
                            onClick={() => startEditing(alert)}
                          >
                            Edit
                          </button>
                        )}
                        {alert.status === "TRIGGERED" ? (
                          <button
                            type="button"
                            className="ml-row-action"
                            disabled={pending}
                            onClick={() => void act(() => rearm({ alertId: alert._id }), "Alert re-armed.")}
                          >
                            Re-arm
                          </button>
                        ) : alert.status === "PAUSED" ? (
                          <button
                            type="button"
                            className="ml-row-action"
                            disabled={pending}
                            onClick={() =>
                              void act(
                                () => setStatus({ alertId: alert._id, status: "ACTIVE" }),
                                "Alert resumed."
                              )
                            }
                          >
                            Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ml-row-action"
                            disabled={pending}
                            onClick={() =>
                              void act(
                                () => setStatus({ alertId: alert._id, status: "PAUSED" }),
                                "Alert paused."
                              )
                            }
                          >
                            Pause
                          </button>
                        )}
                        <button
                          type="button"
                          className="ml-row-action is-danger"
                          disabled={pending}
                          onClick={() => {
                            if (editingAlertId === alert._id) cancelEditing();
                            void act(
                              () => removeAlert({ alertId: alert._id as Id<"priceAlerts"> }),
                              "Alert deleted."
                            );
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

const Alerts: React.FC = () => {
  const { backendOnline } = useRootContext();
  if (!backendOnline) {
    return (
      <BackendRequired
        feature="Alerts"
        description="Alerts and their evaluation history are stored per user in Convex, so none can be shown or created while the backend is unreachable."
      />
    );
  }
  return <AlertsLive />;
};

export default Alerts;
