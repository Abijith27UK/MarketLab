import React from "react";
import { Button, Card } from "@/components/ui";
import DataModeBadge from "@/components/market/DataModeBadge";
import EquityChart from "./EquityChart";
import TradeChart from "./TradeChart";
import { EXIT_REASON_LABEL, type BacktestRunRow } from "@/lib/backtestTypes";
import {
  formatDateTime,
  formatInr,
  formatPercent,
  formatPrice,
  formatSignedInr,
  toneClass,
} from "@/lib/format";

interface BacktestResultsProps {
  run: BacktestRunRow;
  onDelete?: (runId: BacktestRunRow["_id"]) => void;
}

const Metric: React.FC<{ label: string; value: React.ReactNode; tone?: string }> = ({
  label,
  value,
  tone,
}) => (
  <div className="ml-backtest-metric">
    <p className="ml-paper-stat-label">{label}</p>
    <p className={`ml-mono text-base font-semibold ${tone ?? "text-gray-100"}`}>{value}</p>
  </div>
);

const optionalMoney = (value: number | null) => (value === null ? "—" : formatSignedInr(value));
const optionalPercent = (value: number | null) => (value === null ? "—" : `${value.toFixed(2)}%`);

/**
 * Stored backtest result.
 *
 * Everything shown comes from the run document the backend computed; the
 * dataset label, engine version and input hash are displayed so a result can be
 * traced back to exactly the candles and rules that produced it.
 */
export const BacktestResults: React.FC<BacktestResultsProps> = ({ run, onDelete }) => {
  const { metrics } = run;
  const symbol = run.instrumentId.split(":")[1] ?? run.instrumentId;

  return (
    <div className="mt-5" data-testid="backtest-results">
      <Card>
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">
              {run.strategyName}{" "}
              <span className="text-xs font-normal text-gray-500">v{run.strategyVersion}</span>
            </h2>
            <p className="ml-section-sub">
              {run.instrumentId} · {run.interval} ·{" "}
              {formatDateTime(run.datasetFirstTs)} → {formatDateTime(run.datasetLastTs)} ·{" "}
              {run.datasetRowCount} candles · engine {run.engineVersion}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DataModeBadge mode={run.dataMode} source={run.datasetSource} />
            {onDelete && (
              <Button variant="secondary" size="sm" onClick={() => onDelete(run._id)}>
                Delete run
              </Button>
            )}
          </div>
        </div>

        <p className="ml-backtest-provenance" data-testid="run-provenance">
          {run.datasetLabel} · dataset hash{" "}
          <span className="ml-mono">{run.datasetHash.slice(0, 12)}</span> · input hash{" "}
          <span className="ml-mono">{run.inputHash.slice(0, 12)}</span>
        </p>

        {run.datasetSource === "tejhq" && (
          <p className="ml-backtest-provenance" data-testid="run-eod-notice">
            Daily end-of-day bars from TejHQ (completed sessions only). Entries fill on the next
            session's open; no intraday candles exist for this source.
          </p>
        )}

        {run.dataMode === "SAMPLE" && (
          <p className="ml-backtest-sample" data-testid="run-sample-notice">
            <strong>SAMPLE DATA.</strong> These results come from the deterministic sample series,
            not Indian market history. They show that the engine works — they say nothing about how
            this strategy would have performed on real prices.
          </p>
        )}

        <div className="ml-backtest-metrics">
          <Metric label="Final equity" value={formatInr(metrics.finalEquity)} />
          <Metric
            label="Net P&L"
            value={formatSignedInr(metrics.netPnl)}
            tone={toneClass(metrics.netPnl)}
          />
          <Metric
            label="Return"
            value={formatPercent(metrics.returnPct)}
            tone={toneClass(metrics.returnPct)}
          />
          <Metric
            label="Max drawdown"
            value={`${metrics.maxDrawdownPct.toFixed(2)}%`}
            tone={metrics.maxDrawdownPct < 0 ? "text-red-400" : undefined}
          />
          <Metric label="Trades" value={metrics.tradeCount} />
          <Metric label="Win rate" value={optionalPercent(metrics.winRatePct)} />
          <Metric label="Wins / losses" value={`${metrics.winningTrades} / ${metrics.losingTrades}`} />
          <Metric label="Average win" value={optionalMoney(metrics.averageWin)} />
          <Metric label="Average loss" value={optionalMoney(metrics.averageLoss)} />
          <Metric
            label="Profit factor"
            value={metrics.profitFactor === null ? "—" : metrics.profitFactor.toFixed(2)}
          />
          <Metric label="Time in market" value={`${metrics.exposurePct.toFixed(1)}%`} />
          <Metric label="Costs (brokerage + slippage)" value={formatInr(metrics.totalCosts)} />
        </div>

        {run.warnings.length > 0 && (
          <ul className="ml-backtest-warnings" data-testid="run-warnings">
            {run.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <TradeChart prices={run.priceCurve} trades={run.trades} symbol={symbol} />
        </Card>
        <Card>
          <EquityChart points={run.equityCurve} initialCapital={metrics.initialCapital} />
        </Card>
      </div>

      <Card className="mt-4">
        <div className="ml-section-head">
          <div>
            <h2 className="ml-section-title">Trades</h2>
            <p className="ml-section-sub">
              Signal on close, execution on the next open. Costs include the configured brokerage and
              slippage.
            </p>
          </div>
          {run.truncatedTrades && (
            <span className="text-xs text-amber-400/80">
              Showing the first {run.trades.length} of {metrics.tradeCount} trades
            </span>
          )}
        </div>

        {run.trades.length === 0 ? (
          <p className="ml-empty" data-testid="trades-empty">
            This strategy produced no trades over the selected range. Check the warm-up periods and
            the entry rules before concluding the strategy is inactive.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ml-table" data-testid="trades-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th className="is-right">Qty</th>
                  <th className="is-right">Entry px</th>
                  <th className="is-right">Exit px</th>
                  <th className="is-right">Net P&amp;L</th>
                  <th className="is-right">Return</th>
                  <th>Exit reason</th>
                </tr>
              </thead>
              <tbody>
                {run.trades.map((trade, index) => (
                  <tr key={`${trade.entryTs}-${trade.exitTs}-${index}`}>
                    <td className="text-gray-500">{index + 1}</td>
                    <td className="whitespace-nowrap text-xs text-gray-400">
                      {formatDateTime(trade.entryTs)}
                    </td>
                    <td className="whitespace-nowrap text-xs text-gray-400">
                      {formatDateTime(trade.exitTs)}
                    </td>
                    <td className="is-right ml-mono">{trade.quantity}</td>
                    <td className="is-right ml-mono">{formatPrice(trade.entryPrice)}</td>
                    <td className="is-right ml-mono">{formatPrice(trade.exitPrice)}</td>
                    <td className={`is-right ml-mono ${toneClass(trade.netPnl)}`}>
                      {formatSignedInr(trade.netPnl)}
                    </td>
                    <td className={`is-right ml-mono ${toneClass(trade.returnPct)}`}>
                      {formatPercent(trade.returnPct)}
                    </td>
                    <td className="text-xs">
                      {EXIT_REASON_LABEL[trade.exitReason]}
                      {trade.ambiguousExit && (
                        <span
                          className="ml-1 text-amber-400"
                          title="Stop-loss and take-profit were both inside one candle; the stop-loss was assumed to fill first."
                        >
                          ambiguous
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-xs text-gray-500">
        Past simulated performance does not predict future returns. Results depend on the dataset
        shown above, the execution policy (next-open fills, stop-loss before take-profit) and the
        cost assumptions you configured — not on real brokerage, taxes or statutory charges.
      </p>
    </div>
  );
};

export default BacktestResults;
