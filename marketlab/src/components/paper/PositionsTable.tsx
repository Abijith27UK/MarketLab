import React from "react";
import DataModeBadge from "@/components/market/DataModeBadge";
import type { PaperPosition } from "@/lib/paperTypes";
import { formatInr, formatPercent, formatPrice, formatSignedInr, toneClass } from "@/lib/format";

interface PositionsTableProps {
  positions: PaperPosition[];
  onOpenInstrument?: (instrumentId: string) => void;
  emptyMessage?: string;
}

/** Open paper positions with the valuation price and its freshness label. */
export const PositionsTable: React.FC<PositionsTableProps> = ({
  positions,
  onOpenInstrument,
  emptyMessage = "No open positions yet. Filled buys appear here.",
}) => {
  if (positions.length === 0) {
    return (
      <p className="ml-empty" data-testid="positions-empty">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="ml-table" data-testid="positions-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th className="is-right">Qty</th>
            <th className="is-right">Avg cost</th>
            <th className="is-right">Price</th>
            <th className="is-right">Value</th>
            <th className="is-right">P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr key={position.instrumentId} data-instrument-id={position.instrumentId}>
              <td>
                <div className="flex flex-col">
                  {onOpenInstrument ? (
                    <button
                      type="button"
                      className="ml-position-link"
                      onClick={() => onOpenInstrument(position.instrumentId)}
                    >
                      {position.symbol}
                    </button>
                  ) : (
                    <span className="text-gray-200">{position.symbol}</span>
                  )}
                  <span className="text-xs text-gray-500">
                    {position.exchange} · {position.name || position.instrumentType}
                  </span>
                </div>
              </td>
              <td className="is-right ml-mono">{position.quantity}</td>
              <td className="is-right ml-mono">{formatPrice(position.averageCost)}</td>
              <td className="is-right ml-mono">
                <span className="flex flex-col items-end gap-1">
                  <span className="flex items-center justify-end gap-1.5">
                    {formatPrice(position.price)}
                    <DataModeBadge mode={position.mode} source={position.source} />
                  </span>
                  {position.eod && position.quoteTime ? (
                    <span className="text-[11px] font-normal text-gray-500">
                      EOD close · {new Date(position.quoteTime).toLocaleDateString("en-IN")} ·
                      valuation only
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="is-right ml-mono">{formatInr(position.marketValue)}</td>
              <td className={`is-right ml-mono ${toneClass(position.unrealizedPnl)}`}>
                <span className="block">{formatSignedInr(position.unrealizedPnl)}</span>
                <span className="text-xs">{formatPercent(position.unrealizedPercent)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default PositionsTable;
