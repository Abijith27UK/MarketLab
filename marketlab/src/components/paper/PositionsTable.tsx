import React from "react";
import { ArrowUpRight } from "lucide-react";
import DataModeBadge from "@/components/market/DataModeBadge";
import type { PaperPosition } from "@/lib/paperTypes";
import { formatInr, formatPercent, formatPrice, formatSignedInr, toneClass } from "@/lib/format";

interface PositionsTableProps {
  positions: PaperPosition[];
  onOpenInstrument?: (instrumentId: string) => void;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
}

/**
 * Open paper positions with the valuation price and its freshness label.
 * Numbers are right-aligned and tabular so quantity, cost, value and P&L line
 * up down the column.
 */
export const PositionsTable: React.FC<PositionsTableProps> = ({
  positions,
  onOpenInstrument,
  emptyMessage = "Filled buys appear here with their average cost and live valuation.",
  emptyAction,
}) => {
  if (positions.length === 0) {
    return (
      <div className="ml-empty-block" data-testid="positions-empty">
        <p className="ml-empty-block__title">No holdings yet</p>
        <p className="ml-empty-block__body">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="ml-table-scroll">
      <table className="ml-data-table" data-testid="positions-table">
        <thead>
          <tr>
            <th scope="col">Instrument</th>
            <th scope="col" className="is-right">
              Qty
            </th>
            <th scope="col" className="is-right">
              Avg cost
            </th>
            <th scope="col" className="is-right">
              Current price
            </th>
            <th scope="col" className="is-right">
              Market value
            </th>
            <th scope="col" className="is-right">
              P&amp;L
            </th>
            <th scope="col">
              <span className="sr-only">Details</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.instrumentId} data-instrument-id={position.instrumentId}>
              <td>
                <span className="ml-data-table__instrument">
                  {onOpenInstrument ? (
                    <button
                      type="button"
                      className="ml-data-table__symbol"
                      onClick={() => onOpenInstrument(position.instrumentId)}
                    >
                      {position.symbol}
                    </button>
                  ) : (
                    <span className="ml-data-table__symbol">{position.symbol}</span>
                  )}
                  <span className="ml-data-table__name" title={position.name}>
                    {position.name || position.instrumentType}
                  </span>
                </span>
              </td>
              <td className="is-right is-num">{position.quantity}</td>
              <td className="is-right is-num">{formatPrice(position.averageCost)}</td>
              <td className="is-right">
                <span className="flex flex-col items-end gap-1">
                  <span className="is-num">{formatPrice(position.price)}</span>
                  <span className="flex items-center gap-1.5">
                    <DataModeBadge mode={position.mode} source={position.source} />
                    {position.eod && position.quoteTime ? (
                      <span className="text-[10px] text-[var(--text-3)]">
                        EOD {new Date(position.quoteTime).toLocaleDateString("en-IN")}
                      </span>
                    ) : null}
                  </span>
                </span>
              </td>
              <td className="is-right is-num">{formatInr(position.marketValue)}</td>
              <td className={`is-right is-num ${toneClass(position.unrealizedPnl)}`}>
                <span className="block font-medium">{formatSignedInr(position.unrealizedPnl)}</span>
                <span className="block text-[10px]">{formatPercent(position.unrealizedPercent)}</span>
              </td>
              <td className="is-right">
                {onOpenInstrument && (
                  <button
                    type="button"
                    className="ml-data-table__action"
                    onClick={() => onOpenInstrument(position.instrumentId)}
                    aria-label={`Open ${position.symbol} details`}
                  >
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PositionsTable;
