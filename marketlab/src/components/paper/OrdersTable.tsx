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
  emptyAction?: React.ReactNode;
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
  emptyAction,
}) => {
  if (orders.length === 0) {
    return (
      <div className="ml-empty-block" data-testid="orders-empty">
        <p className="ml-empty-block__title">No orders yet</p>
        <p className="ml-empty-block__body">{emptyMessage}</p>
        {emptyAction}
      </div>
    );
  }

  return (
    <div className="ml-table-scroll">
      <table className="ml-data-table" data-testid="orders-table">
        <thead>
          <tr>
            <th scope="col" className="ml-cell-hide-sm">
              Placed
            </th>
            <th scope="col">Instrument</th>
            <th scope="col">Side</th>
            <th scope="col" className="is-right">
              Qty
            </th>
            <th scope="col" className="is-right ml-cell-hide-sm">
              Limit
            </th>
            <th scope="col" className="is-right">
              Fill
            </th>
            <th scope="col">Status</th>
            <th scope="col" className="ml-cell-hide-sm">
              Reason
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const fill = order.filledPrice ?? null;
            const busy = busyOrderId === order._id;
            return (
              <tr key={order._id} data-order-id={order._id} data-status={order.status}>
                <td className="ml-cell-hide-sm whitespace-nowrap text-[11px] text-[var(--text-3)]">
                  {formatDateTime(order.createdAt)}
                </td>
                <td>
                  <span className="ml-data-table__instrument">
                    <span className="ml-data-table__symbol">{order.symbol ?? order.instrumentId}</span>
                    <span className="ml-data-table__name">
                      {order.exchange ?? "—"}
                      {order.instrumentType ? ` · ${order.instrumentType}` : ""}
                      {order.orderType ? ` · ${order.orderType}` : ""}
                    </span>
                  </span>
                </td>
                <td>
                  <span className={order.side === "BUY" ? "ml-side-tag is-buy" : "ml-side-tag is-sell"}>
                    {order.side}
                  </span>
                </td>
                <td className="is-right is-num">{order.quantity}</td>
                <td className="is-right is-num ml-cell-hide-sm">
                  {order.limitPrice === null || order.limitPrice === undefined
                    ? "—"
                    : formatPrice(order.limitPrice)}
                </td>
                <td className="is-right">
                  {fill === null ? (
                    <span className="text-[var(--text-3)]">—</span>
                  ) : (
                    <span className="flex flex-col items-end gap-1">
                      <span className="is-num">{formatPrice(fill)}</span>
                      {order.fillMode && (
                        <DataModeBadge mode={order.fillMode} source={order.fillSource} />
                      )}
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
                <td className="ml-cell-hide-sm max-w-[16rem] text-[11px] text-[var(--text-3)]">
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
