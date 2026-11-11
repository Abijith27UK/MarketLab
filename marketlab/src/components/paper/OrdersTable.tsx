import React from "react";
import DataModeBadge from "@/components/market/DataModeBadge";
import { ORDER_STATUS_DESCRIPTION, ORDER_STATUS_LABEL, type PaperOrderRow } from "@/lib/paperTypes";
import { formatDateTime, formatPrice } from "@/lib/format";

interface OrdersTableProps {
  orders: PaperOrderRow[];
  /** Present only where an open order can be acted on (Trading page). */
  onCancel?: (orderId: PaperOrderRow["_id"]) => void;
  onRecheck?: (orderId: PaperOrderRow["_id"]) => void;
  busyOrderId?: string | null;
  emptyMessage?: string;
}

/**
 * Order history: every state is visible, including rejections and cancellations,
 * because they are recorded rather than silently dropped.
 */
export const OrdersTable: React.FC<OrdersTableProps> = ({
  orders,
  onCancel,
  onRecheck,
  busyOrderId = null,
  emptyMessage = "No simulated orders yet.",
}) => {
  if (orders.length === 0) {
    return (
      <p className="ml-empty" data-testid="orders-empty">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="ml-table" data-testid="orders-table">
        <thead>
          <tr>
            <th>Placed</th>
            <th>Instrument</th>
            <th>Side</th>
            <th className="is-right">Qty</th>
            <th className="is-right">Limit</th>
            <th className="is-right">Fill</th>
            <th>Status</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const fill = order.filledPrice ?? null;
            const busy = busyOrderId === order._id;
            return (
              <tr key={order._id} data-order-id={order._id} data-status={order.status}>
                <td className="whitespace-nowrap text-xs text-gray-400">
                  {formatDateTime(order.createdAt)}
                </td>
                <td>
                  <div className="flex flex-col">
                    <span className="text-gray-200">{order.symbol ?? order.instrumentId}</span>
                    <span className="text-xs text-gray-500">
                      {order.exchange ?? "—"}
                      {order.instrumentType ? ` · ${order.instrumentType}` : ""}
                    </span>
                  </div>
                </td>
                <td>
                  <span
                    className={
                      order.side === "BUY"
                        ? "ml-side-tag is-buy"
                        : "ml-side-tag is-sell"
                    }
                  >
                    {order.side}
                  </span>
                </td>
                <td className="is-right ml-mono">{order.quantity}</td>
                <td className="is-right ml-mono">
                  {order.limitPrice === null || order.limitPrice === undefined
                    ? "—"
                    : formatPrice(order.limitPrice)}
                </td>
                <td className="is-right ml-mono">
                  {fill === null ? (
                    "—"
                  ) : (
                    <span className="flex items-center justify-end gap-1.5">
                      {formatPrice(fill)}
                      {order.fillMode && <DataModeBadge mode={order.fillMode} source={order.fillSource} />}
                    </span>
                  )}
                </td>
                <td>
                  <span
                    className="ml-order-status"
                    data-status={order.status}
                    title={ORDER_STATUS_DESCRIPTION[order.status]}
                  >
                    {ORDER_STATUS_LABEL[order.status]}
                  </span>
                  {order.status === "OPEN" && (onCancel || onRecheck) && (
                    <span className="mt-1 flex gap-1">
                      {onRecheck && (
                        <button
                          type="button"
                          className="ml-row-action"
                          disabled={busy}
                          onClick={() => onRecheck(order._id)}
                        >
                          Re-check
                        </button>
                      )}
                      {onCancel && (
                        <button
                          type="button"
                          className="ml-row-action is-danger"
                          disabled={busy}
                          onClick={() => onCancel(order._id)}
                        >
                          Cancel
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td className="max-w-[16rem] text-xs text-gray-400">
                  {order.rejectionReason ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default OrdersTable;
