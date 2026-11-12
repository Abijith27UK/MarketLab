import React, { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button, Card, Input, Select } from "@/components/ui";
import DataModeBadge from "@/components/market/DataModeBadge";
import type { Quote } from "@/lib/marketClient";
import { formatAge, formatInr, formatPrice } from "@/lib/format";

export interface TicketInstrument {
  instrumentId: string;
  symbol: string;
  name: string;
  exchange: string;
}

export interface TicketSubmission {
  clientOrderId: string;
  instrumentId: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  quantity: number;
  limitPrice: number | null;
}

interface OrderTicketProps {
  instruments: TicketInstrument[];
  search: string;
  onSearch: (value: string) => void;
  selectedInstrumentId: string;
  onSelectInstrument: (instrumentId: string) => void;
  quote: Quote | null;
  quoteLoading?: boolean;
  /** Full cash balance; the server additionally subtracts open-order reservations. */
  availableCash: number;
  reservedCash: number;
  sellableQuantity: number;
  sampleFillsEnabled: boolean;
  submitting: boolean;
  /** Resolves with the backend outcome; `ok: false` keeps the draft for a safe retry. */
  onSubmit: (submission: TicketSubmission) => Promise<{ ok: boolean; message: string }>;
}

type TicketField = "instrument" | "quantity" | "limit" | "quote" | "submit";

interface TicketError {
  field: TicketField;
  message: string;
}

function newClientOrderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** One inline error node; only ever rendered at the field it belongs to. */
const FieldError: React.FC<{ id: string; message: string }> = ({ id, message }) => (
  <p className="ml-field-error" role="alert" id={id} data-testid="ticket-error">
    <AlertTriangle size={12} aria-hidden="true" /> {message}
  </p>
);

/**
 * Simulated order ticket.
 *
 * All money decisions are re-made on the server; this component only validates
 * obvious mistakes early and asks for confirmation before anything is written.
 * The client reference is created once per confirmed attempt, so a retry of the
 * same attempt cannot produce a second order.
 */
export const OrderTicket: React.FC<OrderTicketProps> = ({
  instruments,
  search,
  onSearch,
  selectedInstrumentId,
  onSelectInstrument,
  quote,
  quoteLoading = false,
  availableCash,
  reservedCash,
  sellableQuantity,
  sampleFillsEnabled,
  submitting,
  onSubmit,
}) => {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [clientOrderId, setClientOrderId] = useState<string | null>(null);
  const [error, setError] = useState<TicketError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const spendable = Math.max(0, availableCash - reservedCash);
  const quantityValue = Number(quantity);
  const limitValue = Number(limitPrice);
  const referencePrice = orderType === "LIMIT" ? limitValue : (quote?.lastPrice ?? 0);
  const estimatedValue =
    Number.isFinite(quantityValue) && Number.isFinite(referencePrice)
      ? Math.round(quantityValue * referencePrice * 100) / 100
      : 0;

  const selected = instruments.find((item) => item.instrumentId === selectedInstrumentId) ?? null;

  const validation = useMemo((): TicketError | null => {
    if (!selectedInstrumentId) {
      return { field: "instrument", message: "Choose an instrument to simulate an order." };
    }
    if (!Number.isInteger(quantityValue) || quantityValue <= 0) {
      return {
        field: "quantity",
        message: "Quantity must be a whole number of shares above zero.",
      };
    }
    if (orderType === "LIMIT" && (!Number.isFinite(limitValue) || limitValue <= 0)) {
      return { field: "limit", message: "Enter a limit price above zero." };
    }
    if (orderType === "MARKET" && !quote) {
      return {
        field: "quote",
        message: "No eligible price is available for this instrument right now.",
      };
    }
    if (side === "BUY" && estimatedValue > spendable) {
      return {
        field: "submit",
        message: `Insufficient spendable cash: ${formatInr(estimatedValue)} needed, ${formatInr(
          spendable
        )} available.`,
      };
    }
    if (side === "SELL" && quantityValue > sellableQuantity) {
      return {
        field: "quantity",
        message: `Only ${sellableQuantity} share(s) are sellable — reduce the quantity.`,
      };
    }
    return null;
  }, [
    selectedInstrumentId,
    quantityValue,
    orderType,
    limitValue,
    quote,
    side,
    estimatedValue,
    spendable,
    sellableQuantity,
  ]);

  const resetDraft = () => {
    setConfirming(false);
    setClientOrderId(null);
  };

  const review = () => {
    setNotice(null);
    setError(validation);
    if (validation) return;
    setClientOrderId(newClientOrderId());
    setConfirming(true);
  };

  const submit = async () => {
    if (validation) {
      setError(validation);
      setConfirming(false);
      return;
    }
    const id = clientOrderId ?? newClientOrderId();
    setClientOrderId(id);
    setError(null);
    const outcome = await onSubmit({
      clientOrderId: id,
      instrumentId: selectedInstrumentId,
      side,
      orderType,
      quantity: quantityValue,
      limitPrice: orderType === "LIMIT" ? limitValue : null,
    });
    if (!outcome.ok) {
      // Keep the same client reference so a retry cannot duplicate the order.
      setError({ field: "submit", message: outcome.message });
      return;
    }
    setNotice(outcome.message);
    setConfirming(false);
    setClientOrderId(null);
    setQuantity("");
  };

  const isBuy = side === "BUY";
  const errorField = error?.field ?? null;

  return (
    <Card className="ml-ticket">
      <div className="ml-ticket__head">
        <div>
          <h2 className="ml-section-title">Paper order</h2>
          <p className="ml-section-sub">Simulated only — no order is sent to a broker.</p>
        </div>
        <span className="ml-badge">PAPER</span>
      </div>

      <div className="ml-side-toggle" role="group" aria-label="Order side">
        <button
          type="button"
          className={`ml-side-button is-buy${isBuy ? " is-active" : ""}`}
          aria-pressed={isBuy}
          disabled={submitting}
          onClick={() => {
            setSide("BUY");
            resetDraft();
          }}
        >
          Buy
        </button>
        <button
          type="button"
          className={`ml-side-button is-sell${!isBuy ? " is-active" : ""}`}
          aria-pressed={!isBuy}
          disabled={submitting}
          onClick={() => {
            setSide("SELL");
            resetDraft();
          }}
        >
          Sell
        </button>
      </div>

      <div className="ml-ticket__body">
        <Input
          label="Search instruments"
          placeholder="Symbol or company name"
          value={search}
          onChange={(value) => {
            onSearch(value);
            resetDraft();
          }}
        />
        <Select
          label="Instrument"
          value={selectedInstrumentId}
          onSelect={(value) => {
            onSelectInstrument(value);
            resetDraft();
          }}
          placeholder={instruments.length === 0 ? "No instruments match" : "Select instrument"}
          options={instruments.map((instrument) => ({
            value: instrument.instrumentId,
            label: `${instrument.symbol} · ${instrument.name} (${instrument.exchange})`,
          }))}
        />
        {selected && (
          <p className="ml-ticket__selected">
            <span className="ml-data-table__symbol">{selected.symbol}</span>
            <span className="ml-ticket__selected-name">{selected.name}</span>
            <span className="ml-data-table__exchange">{selected.exchange}</span>
          </p>
        )}
        {errorField === "instrument" && error && (
          <FieldError id="ticket-instrument-error" message={error.message} />
        )}

        <Select
          label="Order type"
          value={orderType}
          onSelect={(value) => {
            setOrderType(value as "MARKET" | "LIMIT");
            resetDraft();
          }}
          options={[
            { value: "MARKET", label: "Market" },
            { value: "LIMIT", label: "Limit" },
          ]}
        />

        <div>
          <Input
            label="Quantity (whole shares)"
            type="number"
            placeholder="0"
            value={quantity}
            onChange={(value) => {
              setQuantity(value);
              resetDraft();
            }}
          />
          {errorField === "quantity" && error && (
            <FieldError id="ticket-quantity-error" message={error.message} />
          )}
        </div>

        {orderType === "LIMIT" && (
          <div>
            <Input
              label="Limit price (₹)"
              type="number"
              placeholder="0.00"
              value={limitPrice}
              onChange={(value) => {
                setLimitPrice(value);
                resetDraft();
              }}
            />
            {errorField === "limit" && error && (
              <FieldError id="ticket-limit-error" message={error.message} />
            )}
            <p className="ml-ticket__hint">
              A limit order fills only if the eligible price already satisfies it — otherwise it
              rests as OPEN until you re-check or cancel it.
            </p>
          </div>
        )}
      </div>

      <div className="ml-ticket-quote">
        <div className="min-w-0">
          <p className="ml-metric__label">Eligible price</p>
          {quoteLoading ? (
            <p className="ml-ticket__hint">Loading quote…</p>
          ) : quote ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--text)]">
              <span className="ml-mono is-num">₹{formatPrice(quote.lastPrice)}</span>
              <DataModeBadge mode={quote.mode} source={quote.source} />
              <span className="text-[11px] text-[var(--text-3)]">
                {quote.quoteTime ? formatAge(quote.quoteTime, Date.now()) : "no timestamp"}
              </span>
            </p>
          ) : (
            <p className="text-sm text-[var(--warn)]">No eligible price available.</p>
          )}
          {errorField === "quote" && error && (
            <FieldError id="ticket-quote-error" message={error.message} />
          )}
        </div>
        <div className="text-right">
          <p className="ml-metric__label">Estimated value</p>
          <p className="ml-mono is-num text-sm text-[var(--text)]">{formatInr(estimatedValue)}</p>
        </div>
      </div>

      <dl className="ml-ticket-limits">
        <div>
          <dt>Available to trade</dt>
          <dd className="ml-mono is-num">{formatInr(spendable)}</dd>
        </div>
        <div>
          <dt>{isBuy ? "Reserved by open buys" : "Sellable quantity"}</dt>
          <dd className="ml-mono is-num">{isBuy ? formatInr(reservedCash) : sellableQuantity}</dd>
        </div>
      </dl>

      {!sampleFillsEnabled && (
        <p className="ml-ticket__hint ml-ticket__hint--warn">
          Sample fills are disabled: an order needs a provider quote before it can be priced.
        </p>
      )}

      {error && error.field === "submit" && (
        <FieldError id="ticket-submit-error" message={error.message} />
      )}
      {notice && (
        <p className="ml-ticket__notice" role="status" data-testid="ticket-notice">
          <CheckCircle2 size={13} aria-hidden="true" /> {notice}
        </p>
      )}

      {confirming ? (
        <div className="ml-ticket-confirm" data-testid="ticket-confirm">
          <p className="text-sm text-[var(--text)]">
            <strong>{side}</strong> {quantityValue} × {selected?.symbol ?? selectedInstrumentId}{" "}
            <span className="text-[var(--text-3)]">({orderType})</span>
          </p>
          <p className="ml-ticket__hint">
            {orderType === "LIMIT"
              ? `Limit ₹${formatPrice(limitValue)} — fills only if the eligible price already satisfies it, otherwise it rests as OPEN.`
              : `Fills at the eligible price above (${quote?.mode ?? "no quote"}).`}{" "}
            Estimated {formatInr(estimatedValue)}.
          </p>
          <div className="ml-ticket__actions">
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Submitting…" : "Place simulated order"}
            </Button>
            <Button variant="secondary" size="sm" onClick={resetDraft} disabled={submitting}>
              Edit
            </Button>
          </div>
          <p className="ml-ticket__hint">
            <ShieldCheck size={12} aria-hidden="true" /> This writes to your simulated ledger only.
          </p>
        </div>
      ) : (
        <Button className="mt-4 w-full" onClick={review} disabled={submitting}>
          Review order
        </Button>
      )}
    </Card>
  );
};

export default OrderTicket;
