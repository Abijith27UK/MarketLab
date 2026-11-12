import React, { useCallback, useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useRootContext } from "@/context/RootContext";
import { marketApi, type ProviderOverview } from "@/lib/marketClient";
import { Button } from "@/components/ui";

export type QuoteSourceId = "tejhq" | "nsemcp";

export interface QuoteSourceSelectProps {
  /** Called after the preference is saved so the caller can refetch quotes. */
  onChanged?: () => void;
}

/**
 * Compact informational quote-source switch.
 *
 * The selection is persisted per user in Convex and actually changes the
 * provider behind `marketData:getQuotes`. NSE MCP is only selectable when the
 * deployment flag has enabled it; otherwise the option is visibly unavailable
 * rather than a button that pretends to work.
 */
export const QuoteSourceSelect: React.FC<QuoteSourceSelectProps> = ({ onChanged }) => {
  const { isAuthenticated, backendOnline } = useRootContext();
  const runOverview = useAction(marketApi.providerOverview);
  const saveProvider = useMutation(marketApi.setQuoteProvider);

  const [overview, setOverview] = useState<ProviderOverview | null>(null);
  const [saving, setSaving] = useState<QuoteSourceId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await runOverview());
    } catch {
      // The selector is auxiliary: a status failure must not break the page.
    }
  }, [runOverview]);

  useEffect(() => {
    if (!backendOnline) return;
    void load();
  }, [backendOnline, load]);

  const choose = async (provider: QuoteSourceId) => {
    setSaving(provider);
    setError(null);
    try {
      await saveProvider({ provider });
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch quote source");
    } finally {
      setSaving(null);
    }
  };

  const active: QuoteSourceId =
    overview?.preferredQuoteProvider === "nsemcp" ? "nsemcp" : "tejhq";
  const nseAvailable = Boolean(overview?.nseMcpEnabled);

  return (
    <div className="ml-quote-source">
      <span className="ml-quote-source__label">Quote source</span>
      <div className="ml-quote-source__options" role="group" aria-label="Quote source">
        <button
          type="button"
          className={`ml-source-btn${active === "tejhq" ? " is-active" : ""}`}
          aria-pressed={active === "tejhq"}
          disabled={saving !== null || active === "tejhq" || !isAuthenticated}
          title="End-of-day close of the latest completed session"
          onClick={() => void choose("tejhq")}
        >
          TejHQ
          <span className="ml-source-btn__meta">EOD</span>
        </button>
        <button
          type="button"
          className={`ml-source-btn${active === "nsemcp" ? " is-active" : ""}`}
          aria-pressed={active === "nsemcp"}
          disabled={saving !== null || active === "nsemcp" || !isAuthenticated || !nseAvailable}
          title={
            nseAvailable
              ? "Experimental NSE MCP quotes (provider-delayed)"
              : "Unavailable: NSE_MCP_POC_ENABLED is not set on this deployment"
          }
          onClick={() => void choose("nsemcp")}
        >
          NSE MCP
          <span className="ml-source-btn__meta">{nseAvailable ? "Experimental" : "Disabled"}</span>
        </button>
      </div>
      {!isAuthenticated ? (
        <span className="ml-quote-source__hint">Sign in to switch · TejHQ default</span>
      ) : null}
      {isAuthenticated && !nseAvailable ? (
        <span className="ml-quote-source__hint">NSE MCP is not enabled on this deployment</span>
      ) : null}
      {error ? (
        <span className="ml-quote-source__error" role="alert">
          {error}
        </span>
      ) : null}
      {saving ? <span className="ml-quote-source__hint">Switching…</span> : null}
    </div>
  );
};

export default QuoteSourceSelect;
