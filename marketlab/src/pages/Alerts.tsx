import React, { useEffect, useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { BellRing, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { useRootContext } from "@/context/RootContext";
import { Button, Card, Input, SectionHeader, Select } from "@/components/ui";
import PageHeader from "@/components/layout/PageHeader";
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
    return (
      <div className="p-4 md:p-6" aria-busy="true">
        <span className="skeleton" style={{ display: "block", height: 26, width: 140 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 120 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 200 }} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 md:p-6">
        <PageHeader
          title="Alerts"
          description="Price threshold alerts are stored per user. Sign in to create and evaluate your own."
        />
        <Card className="max-w-md">
          <AuthPanel />
        </Card>
      </div>
    );
  }

  const activeCount = (alerts ?? []).filter((alert) => alert.status === "ACTIVE").length;
  const triggeredCount = (alerts ?? []).filter((alert) => alert.status === "TRIGGERED").length;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Alerts"
        description="Threshold checks against the latest eligible price. Evaluation is manual — there is no scheduler or notification delivery in this deployment."
        meta={
          <>
            <BellRing size={13} aria-hidden="true" />
            <span className="ml-metric__hint">
              {alerts === undefined
                ? "Loading alerts…"
                : `${alerts.length} alert${alerts.length === 1 ? "" : "s"} · ${activeCount} active · ${triggeredCount} triggered`}
            </span>
          </>
        }
        actions={
          <Button variant="secondary" size="sm" onClick={() => void runCheck()} disabled={checking}>
            {checking ? "Checking…" : "Check now"}
          </Button>
        }
      />

      <p className="ml-account-note mb-4" data-testid="alerts-caveat">
        Alerts never evaluate in the background and nothing is emailed or pushed. Each alert keeps
        the price, source and freshness label from the check that last touched it. A trigger based on
        a SAMPLE price is marked SAMPLE and is not a real market event.
      </p>

      {error && (
        <p className="ml-field-error mb-3" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="ml-ticket__notice mb-3" role="status">
          {notice}
        </p>
      )}

      <Card>
        <SectionHeader
          title={editingAlertId ? "Edit alert" : "New alert"}
          description="Equity and ETF instruments only. A triggered alert must be re-armed before editing."
        />

        <div className="ml-form-grid mt-3">
          <Input
            label="Find instrument"
            placeholder="Search symbol or company"
            value={search}
            onChange={setSearch}
          />
          <Select
            label="Instrument"
            value={instrumentId}
            onSelect={setInstrumentId}
            options={instruments}
            disabled={editingAlertId !== null}
            placeholder={results === undefined ? "Searching…" : "Select instrument"}
          />
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
          <div className="is-full">
            <Input
              label="Note (optional)"
              placeholder="Why this level matters"
              value={note}
              onChange={setNote}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void submit()} disabled={pending || !instrumentId}>
            {pending ? "Saving…" : editingAlertId ? "Update alert" : "Create alert"}
          </Button>
          {editingAlertId && (
            <Button variant="secondary" onClick={cancelEditing} disabled={pending}>
              Cancel edit
            </Button>
          )}
        </div>
      </Card>

      <Card className="mt-5">
        <SectionHeader
          title="Your alerts"
          description="Each row keeps the price and freshness label from its last check."
        />

        {alerts === undefined && (
          <div className="mt-3 flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, index) => (
              <span key={index} className="skeleton" style={{ height: 34 }} />
            ))}
          </div>
        )}

        {alerts?.length === 0 && (
          <div className="ml-empty-block mt-3" data-testid="alerts-empty">
            <p className="ml-empty-block__title">No alerts yet</p>
            <p className="ml-empty-block__body">
              Create one above, then use “Check now” to evaluate it against the latest eligible price.
            </p>
          </div>
        )}

        {alerts && alerts.length > 0 && (
          <div className="ml-table-scroll mt-3">
            <table className="ml-data-table" data-testid="alerts-table">
              <thead>
                <tr>
                  <th scope="col">Instrument</th>
                  <th scope="col">Condition</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="is-right">
                    Last price
                  </th>
                  <th scope="col" className="ml-cell-hide-sm">
                    Last checked
                  </th>
                  <th scope="col">Trigger</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert._id} data-alert-id={alert._id} data-status={alert.status}>
                    <td>
                      <span className="ml-data-table__instrument">
                        <span className="ml-data-table__symbol">{alert.symbol}</span>
                        <span className="ml-data-table__name">
                          {alert.exchange}
                          {alert.note ? ` · ${alert.note}` : ""}
                        </span>
                      </span>
                    </td>
                    <td className="is-num">
                      {formatAlertCondition(alert.direction, alert.threshold)}
                    </td>
                    <td>
                      <span className="ml-order-status" data-status={alert.status}>
                        {alert.status === "ACTIVE"
                          ? "Enabled"
                          : alert.status === "PAUSED"
                            ? "Paused"
                            : alert.status}
                      </span>
                    </td>
                    <td className="is-right is-num">
                      <span className="flex flex-col items-end gap-1">
                        <span>
                          {alert.lastPrice === null ? "—" : formatPrice(alert.lastPrice)}
                        </span>
                        {alert.lastMode && (
                          <DataModeBadge mode={alert.lastMode} source={alert.lastSource ?? undefined} />
                        )}
                      </span>
                    </td>
                    <td className="ml-cell-hide-sm whitespace-nowrap text-[11px] text-[var(--text-3)]">
                      {alert.lastEvaluatedAt === null
                        ? "never"
                        : formatDateTime(alert.lastEvaluatedAt)}
                    </td>
                    <td>
                      {alert.triggeredAt === null ? (
                        <span className="text-[var(--text-3)]">—</span>
                      ) : (
                        <span className="flex flex-col gap-1 text-[11px]">
                          <span>
                            {formatPrice(alert.triggerPrice)} ·{" "}
                            {formatDateTime(alert.triggeredAt)}
                          </span>
                          {alert.triggerMode && <DataModeBadge mode={alert.triggerMode} />}
                          {alert.triggerMode === "SAMPLE" && (
                            <span className="text-[var(--warn)]">
                              SAMPLE price — not a real market move
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {alert.status !== "TRIGGERED" && (
                          <button
                            type="button"
                            className="ml-row-action"
                            disabled={pending}
                            onClick={() => startEditing(alert)}
                          >
                            <Pencil size={11} aria-hidden="true" /> Edit
                          </button>
                        )}
                        {alert.status === "TRIGGERED" ? (
                          <button
                            type="button"
                            className="ml-row-action"
                            disabled={pending}
                            onClick={() => void act(() => rearm({ alertId: alert._id }), "Alert re-armed.")}
                          >
                            <Play size={11} aria-hidden="true" /> Re-arm
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
                            <Play size={11} aria-hidden="true" /> Resume
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
                            <Pause size={11} aria-hidden="true" /> Pause
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
                          <Trash2 size={11} aria-hidden="true" /> Delete
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
