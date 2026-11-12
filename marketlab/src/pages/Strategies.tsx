import React, { useEffect, useMemo, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Plus, Play } from "lucide-react";
import { Button, Card, Input, Select, SectionHeader } from "@/components/ui";
import PageHeader from "@/components/layout/PageHeader";
import RuleEditor from "@/components/backtest/RuleEditor";
import BacktestResults from "@/components/backtest/BacktestResults";
import NumberField from "@/components/backtest/NumberField";
import { configFromRow, defaultStrategyConfig, payloadFromDraft, type BacktestRunRow } from "@/lib/backtestTypes";
import { instrumentIdOf } from "@/lib/stockModels";
import { marketApi } from "@/lib/marketClient";
import { dateInputToMs, dateInputValue } from "@/lib/backtestTypes";
import type { StrategyConfig } from "@backtest/types";

const INTERVALS = [
  { value: "1d", label: "Daily (1d)" },
  { value: "1h", label: "Hourly (1h)" },
  { value: "15m", label: "15 minutes" },
];

const SIZING = [
  { value: "PERCENT_OF_EQUITY", label: "% of equity" },
  { value: "FIXED_QUANTITY", label: "Fixed quantity" },
];

const DATASET = [
  { value: "AUTO", label: "Auto (prefer real if available)" },
  { value: "REAL_ONLY", label: "Real data only" },
  { value: "SAMPLE", label: "Sample only" },
];

type Props = { onOpenInstrument: (id: string) => void };

const emptyMessages: Record<string, string> = {
  entry: "Define at least one entry condition, or this strategy will never open a trade.",
  exit: "Exit conditions are optional, but a strategy with no exit rules will only leave positions at end-of-data or via stop/take-profit.",
};

/**
 * Strategy builder and backtest runner.
 *
 * Rules are structured (never arbitrary code). The backend runs the deterministic
 * engine against the selected instrument's candle history and stores the full
 * result so it can be reloaded and compared.
 */
const Strategies: React.FC<Props> = ({ onOpenInstrument }) => {
  const { isAuthenticated } = useConvexAuth();
  const instruments = useQuery(api.instruments.list) ?? [];
  const strategies = useQuery(api.strategies.list) ?? [];
  const createStrategy = useMutation(api.strategies.create);
  const updateStrategy = useMutation(api.strategies.update);
  const duplicateStrategy = useMutation(api.strategies.duplicate);
  const deleteStrategy = useMutation(api.strategies.remove);
  const runBacktest = useMutation(api.backtests.run);
  const prepareData = useAction(marketApi.prepareBacktestData);
  const deleteRun = useMutation(api.backtests.remove);

  const [activeId, setActiveId] = useState<Id<"strategies"> | null>(null);
  const [name, setName] = useState("New MA crossover");
  const [description, setDescription] = useState("Price crosses above a moving average to enter, below to exit.");
  const [config, setConfig] = useState<StrategyConfig | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [prepareStatus, setPrepareStatus] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<Id<"backtestRuns"> | null>(null);

  const activeStrategy = useMemo(
    () => strategies.find((s) => s._id === activeId) ?? null,
    [strategies, activeId]
  );

  // Start a new draft when no strategy is selected.
  //
  // Seeded demo rows legitimately have no `instrumentId` column, so the canonical
  // `EXCHANGE:SYMBOL:TYPE` id is derived instead. Without this fallback the page
  // stayed on "Loading instruments…" forever against a demo-only catalogue.
  useEffect(() => {
    if (!activeId && instruments.length > 0 && !config) {
      setConfig(defaultStrategyConfig(instrumentIdOf(instruments[0])));
    }
  }, [activeId, instruments, config]);

  // Load an existing strategy into the builder.
  useEffect(() => {
    if (activeStrategy && configFromRow(activeStrategy)) {
      setName(activeStrategy.name);
      setDescription(activeStrategy.description);
      setConfig(configFromRow(activeStrategy));
      setSelectedRunId(null);
      setRunError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStrategy?._id]);

  const runs = useQuery(
    api.backtests.listForStrategy,
    activeId ? { strategyId: activeId } : "skip"
  ) as BacktestRunRow[] | undefined;

  const selectedRun = useMemo(
    () => (runs ?? []).find((r) => r._id === selectedRunId) ?? (runs ?? [])[0] ?? null,
    [runs, selectedRunId]
  );

  useEffect(() => {
    if (runs && runs.length > 0 && !selectedRunId) {
      setSelectedRunId(runs[0]._id as Id<"backtestRuns">);
    }
  }, [runs, selectedRunId]);

  const canSave = isAuthenticated && config !== null && name.trim().length > 0;

  const save = async () => {
    if (!config || !canSave) return;
    const payload = payloadFromDraft(name.trim(), description.trim(), config);
    if (activeId) {
      await updateStrategy({ strategyId: activeId, ...payload });
    } else {
      const id = await createStrategy(payload);
      setActiveId(id);
    }
  };

  const duplicate = async () => {
    if (!activeId) return;
    const id = await duplicateStrategy({ strategyId: activeId });
    setActiveId(id);
  };

  const remove = async () => {
    if (!activeId) return;
    if (!window.confirm("Delete this strategy and all its saved runs?")) return;
    await deleteStrategy({ strategyId: activeId });
    setActiveId(null);
    setConfig(instruments.length > 0 ? defaultStrategyConfig(instrumentIdOf(instruments[0])) : null);
    setName("New MA crossover");
    setDescription("Price crosses above a moving average to enter, below to exit.");
  };

  const run = async () => {
    if (!activeId || !config) return;
    setRunning(true);
    setRunError(null);
    setPrepareStatus(null);
    try {
      // `run` is a mutation and cannot fetch. REAL_ONLY therefore loads daily
      // candles through the provider first and reports exactly what came back.
      if (config.datasetMode === "REAL_ONLY") {
        const prepared = await prepareData({ strategyId: activeId });
        if (!prepared.ready) {
          throw new Error(
            `No genuine ${config.interval} candles were available for this range (${prepared.rowCount} rows from ${prepared.source}). Nothing was substituted — import a CSV or check the provider on Data Sources.`
          );
        }
        setPrepareStatus(
          `${prepared.source.toUpperCase()} · ${prepared.mode}${prepared.eod ? " (EOD daily)" : ""} · ${
            prepared.rowCount
          } candles${prepared.fromCache ? " (cached)" : ""}`
        );
      }
      const result = await runBacktest({ strategyId: activeId });
      setSelectedRunId(result.runId as Id<"backtestRuns">);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const deleteRunAction = async (runId: Id<"backtestRuns"> | string) => {
    if (!window.confirm("Delete this saved backtest run?")) return;
    await deleteRun({ runId: runId as Id<"backtestRuns"> });
    if (selectedRunId === (runId as Id<"backtestRuns">)) setSelectedRunId(null);
  };

  if (!config) {
    return (
      <div className="p-4 md:p-6" aria-busy="true">
        <span className="skeleton" style={{ display: "block", height: 26, width: 180 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 120 }} />
        <span className="skeleton mt-4" style={{ display: "block", height: 240 }} />
      </div>
    );
  }

  const updateConfig = (patch: Partial<StrategyConfig>) => setConfig({ ...config, ...patch });

  const entryValid = config.entry.conditions.length > 0;
  const exitValid = config.exit.conditions.length > 0;

  return (
    <div className="p-4 md:p-6">
      <PageHeader
        title="Strategies"
        description="Build structured rules, backtest against historical candles, and inspect reproducible results. Long-only equity only — no broker orders."
        meta={
          <>
            <span className="ml-badge">BACKTEST</span>
            <span className="ml-metric__hint">
              {strategies.length} saved strateg{strategies.length === 1 ? "y" : "ies"} ·{" "}
              {(runs ?? []).length} saved run{(runs ?? []).length === 1 ? "" : "s"}
            </span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setActiveId(null)}>
              <Plus size={13} aria-hidden="true" /> New strategy
            </Button>
            {activeId && (
              <>
                <Button variant="secondary" size="sm" onClick={duplicate}>
                  Duplicate
                </Button>
                <Button variant="secondary" size="sm" onClick={remove}>
                  Delete
                </Button>
              </>
            )}
            <Button variant="secondary" size="sm" onClick={save} disabled={!canSave}>
              {activeId ? "Save changes" : "Save strategy"}
            </Button>
            {activeId && (
              <Button onClick={run} disabled={running || !entryValid}>
                <Play size={13} aria-hidden="true" />
                {running ? "Running…" : "Run backtest"}
              </Button>
            )}
          </>
        }
      />

      {!isAuthenticated && (
        <p className="ml-ticket__hint ml-ticket__hint--warn mb-4">
          Sign in to save strategies and run backtests. The builder stays readable either way, and
          nothing is written to your account until you save.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="xl:sticky xl:top-[76px] xl:self-start">
          <Card>
            <SectionHeader
              title="Saved strategies"
              description="Private to your account."
            />
            {strategies.length === 0 ? (
              <div className="ml-empty-block mt-3">
                <p className="ml-empty-block__title">No saved strategies</p>
                <p className="ml-empty-block__body">
                  Configure the draft on the right, then save it to keep it here.
                </p>
              </div>
            ) : (
              <ul className="ml-strategy-list mt-3">
                {strategies.map((s) => (
                  <li key={s._id}>
                    <button
                      type="button"
                      className={`ml-strategy-item${activeId === s._id ? " is-active" : ""}`}
                      onClick={() => setActiveId(s._id)}
                    >
                      <span className="ml-strategy-name">{s.name}</span>
                      <span className="ml-strategy-meta">
                        {s.instrumentId} · {s.interval} · v{s.version}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {activeId && runs && runs.length > 0 && (
              <>
                <h3 className="ml-metric__label mt-4">Saved runs</h3>
                <ul className="ml-strategy-list mt-2">
                  {runs.map((r) => (
                    <li key={r._id}>
                      <button
                        type="button"
                        className={`ml-strategy-item${selectedRunId === r._id ? " is-active" : ""}`}
                        onClick={() => setSelectedRunId(r._id)}
                      >
                        <span className="ml-strategy-name">
                          {r.status === "COMPLETED"
                            ? `₹${r.metrics.finalEquity.toLocaleString("en-IN")}`
                            : r.status}
                        </span>
                        <span className="ml-strategy-meta">
                          {new Date(r.createdAt).toLocaleString("en-IN")} · {r.dataMode}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>

        <div className="min-w-0">
          <Card>
            <SectionHeader
              title="Strategy details"
              description="Name, instrument, dates and assumptions. Everything here is stored with the strategy."
            />

            <div className="ml-form-grid mt-3">
              <Input label="Strategy name" value={name} onChange={setName} />
              <Input label="Description" value={description} onChange={setDescription} />
              <Select
                label="Instrument"
                value={config.instrumentId}
                onSelect={(value) => updateConfig({ instrumentId: value })}
                options={instruments
                  .filter((i) => typeof i.instrumentId === "string")
                  .map((i) => ({ value: i.instrumentId as string, label: `${i.symbol} · ${i.exchange}` }))}
              />
              <Select
                label="Interval"
                value={config.interval}
                onSelect={(value) => updateConfig({ interval: value as StrategyConfig["interval"] })}
                options={INTERVALS}
              />
              <Input
                label="Start date"
                type="date"
                value={dateInputValue(config.fromMs)}
                onChange={(value) => updateConfig({ fromMs: dateInputToMs(value) })}
              />
              <Input
                label="End date"
                type="date"
                value={dateInputValue(config.toMs)}
                onChange={(value) => updateConfig({ toMs: dateInputToMs(value) })}
              />
            </div>
          </Card>

          <Card className="mt-4">
            <SectionHeader
              title="Capital, costs & data"
              description="Position sizing, risk limits and the costs the engine charges each fill."
            />

            <div className="ml-form-grid mt-3">
              <NumberField
                label="Initial capital (INR)"
                value={config.initialCapital}
                onChange={(value) => updateConfig({ initialCapital: value === null ? 100000 : value })}
              />
              <Select
                label="Position sizing"
                value={config.sizing.kind}
                onSelect={(value) =>
                  updateConfig({
                    sizing: { ...config.sizing, kind: value as "PERCENT_OF_EQUITY" | "FIXED_QUANTITY" },
                  })
                }
                options={SIZING}
              />
              {config.sizing.kind === "PERCENT_OF_EQUITY" ? (
                <NumberField
                  label="% of equity per trade"
                  value={config.sizing.percentOfEquity}
                  onChange={(value) => updateConfig({ sizing: { ...config.sizing, percentOfEquity: value } })}
                />
              ) : (
                <NumberField
                  label="Fixed quantity (shares)"
                  value={config.sizing.quantity}
                  onChange={(value) =>
                    updateConfig({ sizing: { ...config.sizing, quantity: value === null ? 1 : value } })
                  }
                />
              )}
              <NumberField
                label="Max position % of equity"
                value={config.sizing.maxPositionValuePct}
                onChange={(value) =>
                  updateConfig({
                    sizing: { ...config.sizing, maxPositionValuePct: value === null ? 100 : value },
                  })
                }
              />
              <NumberField
                label="Stop-loss %"
                value={config.stopLossPct}
                onChange={(value) => updateConfig({ stopLossPct: value })}
              />
              <NumberField
                label="Take-profit %"
                value={config.takeProfitPct}
                onChange={(value) => updateConfig({ takeProfitPct: value })}
              />
              <NumberField
                label="Brokerage flat (INR)"
                value={config.costs.brokerageFlat}
                onChange={(value) => updateConfig({ costs: { ...config.costs, brokerageFlat: value ?? 0 } })}
              />
              <NumberField
                label="Slippage (bps)"
                value={config.costs.slippageBps}
                onChange={(value) => updateConfig({ costs: { ...config.costs, slippageBps: value ?? 0 } })}
              />
              <Select
                label="Dataset"
                value={config.datasetMode}
                onSelect={(value) => updateConfig({ datasetMode: value as StrategyConfig["datasetMode"] })}
                options={DATASET}
              />
            </div>
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <RuleEditor
                title="Entry rules"
                description="Conditions that open a long position when true on the signal candle."
                ruleSet={config.entry}
                onChange={(entry) => updateConfig({ entry })}
                allowEmpty={false}
              />
              {!entryValid && <p className="ml-rule-error">{emptyMessages.entry}</p>}
            </Card>
            <Card>
              <RuleEditor
                title="Exit rules"
                description="Conditions that close the position. Leave empty to rely on stop/take-profit or end-of-data."
                ruleSet={config.exit}
                onChange={(exit) => updateConfig({ exit })}
                allowEmpty
                emptyHint={emptyMessages.exit}
              />
            </Card>
          </div>

          {runError && (
            <p className="ml-field-error mt-4" role="alert">
              {runError}
            </p>
          )}

          {prepareStatus && (
            <p className="ml-ticket__notice mt-4" role="status">
              Data loaded for this run: {prepareStatus}
            </p>
          )}

          {selectedRun && <BacktestResults run={selectedRun} onDelete={deleteRunAction} />}

          {activeId && (!runs || runs.length === 0) && !running && (
            <div className="ml-empty-block mt-4">
              <p className="ml-empty-block__title">No runs yet</p>
              <p className="ml-empty-block__body">
                Save the strategy and run a backtest to generate a deterministic result you can
                reload later.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenInstrument(config.instrumentId)}
              >
                View instrument chart
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Strategies;
