/**
 * Verified NSE index identities used by the dashboard.
 *
 * These are reference data, not quotes: the symbol is MarketLab's stable id,
 * while `nseName` is the exact string the official NSE MCP index tools accept.
 * Verified live on 2026-11-12 with `cm_get_live_indices` (group `all`):
 * NIFTY 50 / NIFTY BANK / NIFTY NEXT 50 / NIFTY FIN SERVICE are in the
 * `derivatives` group, NIFTY IT in `sectoral` and NIFTY MIDCAP 50 in `broad`.
 *
 * Nothing here invents a level. A definition with no quote simply renders as
 * "no quote available".
 */

import { makeInstrumentId, type Exchange, type NormalizedInstrument } from "./types";

export interface IndexDefinition {
  /** MarketLab's stable symbol, safe in ids and URLs. */
  symbol: string;
  /** Official display name (NSE's own spelling). */
  name: string;
  /** Exact `indexName` accepted by `cm_get_index_quote`. */
  nseName: string;
  exchange: Exchange;
  /** NSE group the bulk live-indices tool files this index under. */
  group: "derivatives" | "broad" | "sectoral" | "strategy" | "thematic" | "fixed_income";
}

export const DASHBOARD_INDEX_DEFINITIONS: IndexDefinition[] = [
  { symbol: "NIFTY50", name: "NIFTY 50", nseName: "NIFTY 50", exchange: "NSE", group: "derivatives" },
  { symbol: "BANKNIFTY", name: "NIFTY BANK", nseName: "NIFTY BANK", exchange: "NSE", group: "derivatives" },
  {
    symbol: "NIFTYNEXT50",
    name: "NIFTY NEXT 50",
    nseName: "NIFTY NEXT 50",
    exchange: "NSE",
    group: "derivatives",
  },
  { symbol: "NIFTYIT", name: "NIFTY IT", nseName: "NIFTY IT", exchange: "NSE", group: "sectoral" },
  {
    symbol: "NIFTYMIDCAP50",
    name: "NIFTY MIDCAP 50",
    nseName: "NIFTY MIDCAP 50",
    exchange: "NSE",
    group: "broad",
  },
  {
    symbol: "NIFTYFINSERVICE",
    name: "NIFTY FIN SERVICE",
    nseName: "NIFTY FIN SERVICE",
    exchange: "NSE",
    group: "derivatives",
  },
];

export const DASHBOARD_INDEX_IDS: string[] = DASHBOARD_INDEX_DEFINITIONS.map((definition) =>
  makeInstrumentId(definition.exchange, definition.symbol, "INDEX")
);

export function indexDefinitionFor(instrumentId: string): IndexDefinition | null {
  return (
    DASHBOARD_INDEX_DEFINITIONS.find(
      (definition) =>
        makeInstrumentId(definition.exchange, definition.symbol, "INDEX") === instrumentId
    ) ?? null
  );
}

/**
 * Resolves the NSE name for an index instrument.
 *
 * The catalogue symbol (`NIFTY50`) is not what NSE accepts (`NIFTY 50`), so the
 * provider id and the verified definition both take precedence over the symbol.
 */
export function nseIndexName(instrument: NormalizedInstrument): string {
  const fromProvider = instrument.providerIds?.nsemcp;
  if (typeof fromProvider === "string" && fromProvider.trim()) return fromProvider.trim();
  const definition =
    indexDefinitionFor(instrument.instrumentId) ??
    DASHBOARD_INDEX_DEFINITIONS.find(
      (entry) => entry.symbol.toUpperCase() === instrument.symbol.toUpperCase()
    );
  return definition?.nseName ?? instrument.symbol;
}

/** Normalized-instrument view of a definition, for seeding the catalogue. */
export function indexDefinitionToInstrument(definition: IndexDefinition): NormalizedInstrument {
  return {
    instrumentId: makeInstrumentId(definition.exchange, definition.symbol, "INDEX"),
    symbol: definition.symbol,
    tradingSymbol: `${definition.exchange}:${definition.symbol}-INDEX`,
    name: definition.name,
    exchange: definition.exchange,
    instrumentType: "INDEX",
    segment: "INDEX",
    providerIds: { nsemcp: definition.nseName },
    isin: null,
    tickSize: null,
    lotSize: null,
    isActive: true,
    source: "nsemcp",
    isSampleData: false,
  };
}
