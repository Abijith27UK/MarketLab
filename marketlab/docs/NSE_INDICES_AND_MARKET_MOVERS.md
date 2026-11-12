# NSE indices and official market movers

Status: implemented and live-verified against the official NSE MCP servers on
2026-11-12. This document records the causes that were found, the tools that were
actually discovered, and exactly what was and was not verified.

---

## 1. Root cause — empty Market Indices

Three independent faults stacked up:

1. **Index rows were not in the catalogue.** The NSE bhavcopy instrument master
   (and therefore `syncCatalogue`) contains equities only. The dashboard asked
   `searchInstruments({ instrumentType: "INDEX" })` and had nothing to find.
2. **The explorer applied filters after pagination.** `searchInstruments` in
   browse mode paged the `by_symbol` index and only then filtered the page by
   exchange/type. The first alphabetical page contains no index rows, so even a
   seeded index was filtered out of a page that never included it. Fixed by
   scanning forward (bounded to five pages) until the requested page is full.
3. **The dashboard depended on the equity catalogue.** Indices now come from a
   dedicated six-row reference list (`convex/market/indexCatalogue.ts`) with its
   own query, so six cards no longer require 2,900 equities to be synced.

The "No index instruments yet" screenshot was therefore a data **and** query
bug, not a rendering problem.

## 2. Root cause — wrong Gainers/Losers

`Dashboard.tsx` built the widget as:

```ts
const ranked = [...realQuotes].sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
const gainers = ranked.slice(0, 5);
const losers = ranked.slice(-5).reverse();
```

`realQuotes` was the ~18 quotes already on screen (8 indices + 10 catalogue rows +
watchlist). Consequences:

* the "market" ranking was really a ranking of the dashboard cards;
* `slice(-5).reverse()` did **not** filter by sign, so a +0.16% row could appear
  under Losers whenever fewer than five genuine losers existed;
* losers were sorted worst-last (reverse of ascending);
* the footer said "10 qualifying quotes", which described the sample, not a market.

Market Movers no longer reads local quotes at all. It is served by
`convex/marketMovers.ts`, which requests the official ranking from NSE MCP.

## 3. NSE MCP tools discovered (live, 2026-11-12)

`initialize` → `tools/list` on `https://mcp.nseindia.in/cmmkt/mcp` returns 15
tools (`cm-market-mcp 1.0.0`, MCP `2025-06-18`).

| Purpose | Tool | Schema (discovered) |
| --- | --- | --- |
| Both mover lists | `nse_get_market_movers` | `{ indexName: string, limit: integer }` — both required; `indexName: ""` = all securities, `limit` 0 = default, max 50 |
| Gainers only | `nse_get_gainers` | `{ limit: integer }` |
| Losers only | `nse_get_losers` | `{ limit: integer }` |
| Gainers/losers by variation | `cm_get_live_market_data` | `{ index: "gainers" \| "loosers" }` |
| Bulk indices | `cm_get_live_indices` | `{ group: string, nameFilter: string }` — `group: "all"` returns every group |
| Single index | `cm_get_index_quote` | `{ indexName: string }` |
| Ranking freshness | `cm_get_data_status` | `{}` — returns `gainers`/`loosers` `lastCrawled` and `crawlIntervalMinutes: 5` |

`nse_get_market_movers` is preferred because it returns **both directions in one
call**, from one crawl, with `gainersUpdatedAt` / `losersUpdatedAt`.

Historical bhavcopy tools (`get_top_movers`, `get_index_history`) were **not**
needed: the current-market ranking was available and returned valid session
metadata, so no historical substitute is used.

## 4. Ranking universe and source

* Source: `NSE MCP` → `nse_get_market_movers`.
* Request: `{ indexName: "", limit: 20 }`.
* Provider universe: `segment: "allSec"` (all NSE securities).
* MarketLab keeps **EQ series only** and shows the top 10 per direction after
  filtering, so SME/trade-to-trade/bond series are never mixed into an equity
  ranking. The widget labels itself **"All NSE equities (EQ series)"**.
* No fallback to `get_gainers` is needed at runtime, but the adapter would fail
  loudly if `nse_get_market_movers` disappeared rather than pretending.

## 5. Index data source routing

* `marketData:dashboardIndices` returns six verified identities, whether or not
  the catalogue has them:
  `NIFTY 50`, `NIFTY BANK`, `NIFTY NEXT 50`, `NIFTY IT`, `NIFTY MIDCAP 50`,
  `NIFTY FIN SERVICE` (NSE's own name for the financial-services index).
* Stable ids: `NSE:NIFTY50:INDEX`, `NSE:BANKNIFTY:INDEX`,
  `NSE:NIFTYNEXT50:INDEX`, `NSE:NIFTYIT:INDEX`, `NSE:NIFTYMIDCAP50:INDEX`,
  `NSE:NIFTYFINSERVICE:INDEX`.
* Provider identifier: `providerIds.nsemcp` holds the exact NSE name
  (`NIFTY 50`), because the catalogue symbol (`NIFTY50`) is not what NSE accepts.
* `getQuotes` idempotently seeds those six rows before quoting them
  (`ensureIndexInstruments`), preserving `_id`s and never deleting.
* With NSE MCP selected, `fetchIndexQuotes` makes **one** bulk call
  (`cm_get_live_indices { group: "all", nameFilter: "" }`, 139 indices) and falls
  back to `cm_get_index_quote` only for names missing from the bulk response.
* With TejHQ selected, indices are **not** relabelled: TejHQ cannot quote them,
  so the dashboard shows an explicit unsupported-source card and a button that
  switches the quote source to NSE MCP. (Indices are provider-aware, unlike
  Market Movers, which is fixed to NSE MCP.)
* Index levels are **points**: `FinancialValue withCurrency={false}`, so no `₹`
  precedes NIFTY 50.

## 6. Market Movers fixed-source architecture

`convex/marketMovers.ts` → action `marketMovers:getMarketMovers`

* Does **not** read `userProfiles.quoteProvider`, accepts no provider argument.
* Cache key: `nsemcp:market-movers:allSec:eq:20:v1` — fixed provider, tool,
  universe and limit; no user or preference component.
* Cache table `marketMoversCache` (new): normalized payload JSON, session date,
  quote timestamp, `fetchedAt`, `expiresAt`.
* TTL: 60 s while the session is open, 15 min outside it (NSE crawls every ~5 min
  and keeps a 15-minute Redis TTL).
* If a refresh fails, the last ranking is returned with `mode: "CACHED"`,
  `stale: true` and a warning naming the failure and the original retrieval time.
  If there is no ranking at all, the action returns `available: false` with a
  reason; the widget shows "Official NSE rankings unavailable" and a Retry.
* Local quote samples are never used, so switching TejHQ ↔ NSE MCP changes Top
  Stocks and Indices but **cannot** change Market Movers.

## 7. Market open vs historical session

`cm_get_data_status` reports `crawlIntervalMinutes: 5`, and the payload carries
`gainersUpdatedAt` / `losersUpdatedAt`. The action:

* uses the current-market ranking at all times;
* labels the data `DELAYED` (NSE documents a 1–3 minute delay; the actual crawl
  time is displayed, not assumed);
* takes the **session date** from the provider crawl timestamps in IST;
* refuses to show the two tabs if their crawl dates differ (`sessionMismatch`),
  rather than mixing a current Gainers list with a previous-session Losers list.

No historical bhavcopy movers are blended in. A closed-session response is the
last completed session, and it is labelled with that session date rather than
being presented as intraday.

## 8. Timestamp and cache corrections

* The header time came from `Date.now()` on the client, while the quote time came
  from NSE's IST timestamp fields. They are now displayed as **separate clocks**
  ("session", "quote", "retrieved") with IST formatting.
* `parseQuoteTime` already pinned naive NSE timestamps to `+05:30`; the observed
  `timeVal: "12-Nov-2026 15:40"` parses to 10:10 UTC. No double conversion.
* New `sanitizeQuoteTime` drops a provider timestamp more than 5 minutes ahead of
  the server clock; `labelQuote` does the same for cached/equity quotes. Such a
  value becomes "no quote timestamp" instead of "fresh" — nothing is replaced
  with a manufactured time.
* ISO crawl timestamps with 9 fractional digits (`...190244815Z`) are truncated
  to milliseconds before parsing (`parseIsoTimestamp`); `Date.parse` rejects them
  otherwise.
* Cache freshness and quote freshness are distinct: the widget prints the quote
  time, the session date, the retrieval time and the cache state separately.

## 9. Top Stocks default selection

`searchInstruments({ instrumentType: "EQUITY", exchange: "NSE", limit: 10 })`
in browse mode returns the alphabetically first ten symbols (20MICRONS,
21STCENMGM, 360ONE, 3BBLACKBIO…). That was the whole selection logic.

`marketData:featuredInstruments` now resolves a curated list in order:
RELIANCE, HDFCBANK, ICICIBANK, INFY, TCS, ITC, SBIN, LT. Symbols missing from the
catalogue are reported ("Not in the catalogue yet: …"), never replaced by
whatever sorts first. Prices still follow the user's quote source. Dashboard
section preferences (`dashboardSections`) are untouched; there is no per-stock
customisation feature to preserve.

## 10. Verified live

### Indices (live provider call, `LIVE_NSE_MCP=1`)

| Index | Tool | Value | Change | Quote time (IST) | Mode |
| --- | --- | --- | --- | --- | --- |
| NIFTY 50 | `cm_get_live_indices` (bulk) | 25,299.35 | +44.30 (+0.18%) | 15:40 | DELAYED |
| NIFTY BANK | bulk | 61,518.50 | +726.10 (+1.19%) | 15:40 | DELAYED |
| NIFTY IT | bulk | 32,163.55 | −132.05 (−0.41%) | 15:40 | DELAYED |

### Market movers (`marketMovers:getMarketMovers` through Convex)

* Tool: `nse_get_market_movers`, segment `allSec`, session `2026-11-12`.
* 10 gainers, 10 losers, all EQ series, all resolved to catalogue names.
* Gainers: ORCHASP +20.00%, PROZONER +19.98%, FLEXITUFF +19.94%, ANTGRAPHIC
  +19.67%, SPCENET +19.38% …
* Losers: PAGEIND −12.91%, LOKESHMACH −8.59%, JAIPURKURT −7.57%, INSPIRISYS
  −7.22%, NECCLTD −7.16% …
* `gainers.every(pct > 0) === true`, `losers.every(pct < 0) === true`, both lists
  sorted correctly, and the second call was served from cache (`fromCache: true`).

## 11. Automated tests and build

* `tests/nseIndicesAndMovers.test.ts` (18 tests): index identity mapping, bulk
  index normalization, point/percentage derivation, missing values, mover sign
  and sort rules, zero/invalid/non-EQ exclusion, dedupe, short lists, session
  mismatch, fixed source and cache key, ISO/IST timestamps, future guard.
* `tests/dashboardIndicesMovers.test.tsx` (8 tests): index card formats points
  without `₹`, direction/provider labels, unavailable level; movers panel source
  badge, universe/session footer, tab sign separation, catalogue-only navigation,
  unavailable state, stale cache + refresh.
* `tests/liveNseIndices.test.ts` and `tests/liveNseMoversProbe.test.ts`: opt-in
  (`LIVE_NSE_MCP=1`) probes against the real NSE MCP servers.
* Full suite, `npx convex codegen`, `npx tsc --noEmit` and `npx vite build` are
  listed in the final report.

## 12. Browser verification

Signed-out session:

* Market Movers shows official NSE rows (Gainers and Losers), correct signs,
  source badge `NSE MCP`, universe and session/retrieval footer.
* Top Stocks shows RELIANCE…LT with TejHQ EOD labels, not alphabetical symbols.
* Indices show the explicit "Indices require NSE MCP (sign in to select it)"
  state, as designed for a TejHQ/selected-other source.

Not browser-verified: the six index cards with NSE MCP active (requires a
signed-in session to persist the quote-source preference). That path is covered
by live provider calls and component tests, but it was not clicked through.

## 13. Remaining limitations

1. **Mover names require the catalogue.** NSE's mover payload has no company
   name; names come from `instruments`. A symbol outside the catalogue is shown
   unlinked with "sync the instrument catalogue" rather than navigating to a
   guessed instrument. Current catalogue covers all 10+10 observed rows.
2. **EQ-series filter changes the tail.** Requesting 20 rows and filtering to EQ
   means a ranked list can be shorter than 10 if many top movers are BE/SM.
   That is deliberate: a clean equity ranking over a padded mixed one.
3. **NSE MCP stays disabled by default.** `NSE_MCP_POC_ENABLED=true` is required;
   otherwise movers return an explicit unavailable state and indices show
   "sign in / enable NSE MCP", never substitute data.
4. **No index history.** Index sparklines stay empty: the bhavcopy server exposes
   no verified index-history tool, and inventing one is not acceptable.
5. **NSE MCP is a private proof of concept.** Not for redistribution, not used for
   paper fills, portfolio valuation or execution.
6. **Rate limits.** The dashboard now polls quotes every 5 minutes instead of
   every 60 seconds to stay inside the 12 requests/minute budget; movers cache for
   60 s (open) / 15 min (closed).
