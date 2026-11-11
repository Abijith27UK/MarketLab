import React, { useMemo, useState } from "react";
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

function newClientOrderId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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
  const [error, setError] = useState<string | null>(null);
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

  const validation = useMemo((): string | null => {
    if (!selectedInstrumentId) return "Choose an instrument to simulate an order.";
    if (!Number.isInteger(quantityValue) || quantityValue <= 0) {
      return "Quantity must be a whole number of shares above zero.";
    }
    if (orderType === "LIMIT" && (!Number.isFinite(limitValue) || limitValue <= 0)) {
      return "Enter a limit price above zero.";
    }
    if (orderType === "MARKET" && !quote) {
      return "No eligible price is available for this instrument right now.";
    }
    if (side === "BUY" && estimatedValue > spendable) {
      return `Insufficient spendable cash: ${formatInr(estimatedValue)} needed, ${formatInr(spendable)} available.`;
    }
    if (side === "SELL" && quantityValue > sellableQuantity) {
      return `Only ${sellableQuantity} share(s) are sellable — reduce the quantity.`;
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
      setError(outcome.message);
      return;
    }
    setNotice(outcome.message);
    setConfirming(false);
    setClientOrderId(null);
    setQuantity("");
  };

  return (
    <Card className="ml-ticket" >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="ml-section-title">Order ticket</h2>
          <p className="ml-section-sub">Simulated only — no order is sent to a broker.</p>
        </div>
        <span className="ml-badge">PAPER</span>
      </div>

      <div className="ml-side-toggle" role="group" aria-label="Order side">
        <button
          type="button"
          className={`ml-side-button is-buy${side === "BUY" ? " is-active" : ""}`}
          aria-pressed={side === "BUY"}
          onClick={() => {
            setSide("BUY");
            resetDraft();
          }}
        >
          Buy
        </button>
        <button
          type="button"
          className={`ml-side-button is-sell${side === "SELL" ? " is-active" : ""}`}
          aria-pressed={side === "SELL"}
          onClick={() => {
            setSide("SELL");
            resetDraft();
          }}
        >
          Sell
        </button>
      </div>

      <div className="mt-4 space-y-3">
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
        {orderType === "LIMIT" && (
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
        )}
      </div>

      <div className="ml-ticket-quote">
        <div>
          <p className="ml-paper-stat-label">Eligible price</p>
          {quoteLoading ? (
            <p className="text-sm text-gray-400">Loading quote…</p>
          ) : quote ? (
            <p className="flex flex-wrap items-center gap-2 text-sm text-gray-200">
              <span className="ml-mono">₹{formatPrice(quote.lastPrice)}</span>
              <DataModeBadge mode={quote.mode} source={quote.source} />
              <span className="text-xs text-gray-500">
                {quote.quoteTime ? formatAge(quote.quoteTime, Date.now()) : "no timestamp"}
              </span>
            </p>
          ) : (
            <p className="text-sm text-amber-400/80">No eligible price available.</p>
          )}
        </div>
        <div className="text-right">
          <p className="ml-paper-stat-label">Estimated value</p>
          <p className="ml-mono text-sm text-gray-200">{formatInr(estimatedValue)}</p>
        </div>
      </div>

      <dl className="ml-ticket-limits">
        <div>
          <dt>Spendable cash</dt>
          <dd className="ml-mono">{formatInr(spendable)}</dd>
        </div>
        <div>
          <dt>Sellable quantity</dt>
          <dd className="ml-mono">{sellableQuantity}</dd>
        </div>
      </dl>

      {!sampleFillsEnabled && (
        <p className="mt-2 text-xs text-amber-400/80">
          Sample fills are disabled: an order needs a provider quote before it can be priced.
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm text-red-400" role="alert" data-testid="ticket-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-3 text-sm text-emerald-400" role="status" data-testid="ticket-notice">
          {notice}
        </p>
      )}

      {confirming ? (
        <div className="ml-ticket-confirm" data-testid="ticket-confirm">
          <p className="text-sm text-gray-200">
            <strong>{side}</strong> {quantityValue} × {selected?.symbol ?? selectedInstrumentId}{" "}
            <span className="text-gray-500">({orderType})</span>
          </p>
          <p className="mt-1 text-xs text-gray-400">
            {orderType === "LIMIT"
              ? `Limit ₹${formatPrice(limitValue)} — fills only if the eligible price already satisfies it, otherwise it rests as OPEN.`
              : `Fills at the eligible price above (${quote?.mode ?? "no quote"}).`}{" "}
            Estimated {formatInr(estimatedValue)}.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={() => void submit()} disabled={submitting}>
              {submitting ? "Submitting…" : "Place simulated order"}
            </Button>
            <Button variant="secondary" size="sm" onClick={resetDraft} disabled={submitting}>
              Edit
            </Button>
          </div>
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
