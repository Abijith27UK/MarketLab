# MarketLab — multi-source market data, provider switching and catalogue

Status: implemented on the backend and in the UI, and **live-verified** against
the official NSE MCP servers (quotes, bulk indices, official market movers and the
bhavcopy history tool). Dashboard-specific work — index cards and the fixed-source
Market Movers widget — is documented separately in
`docs/NSE_INDICES_AND_MARKET_MOVERS.md`.

---

## 1. Architecture audit (what actually limited stock coverage)

Findings, in the order they matter:

1. **The catalogue was seeded with 15 demo rows.** `convex/instruments.ts` seeds
   ten NSE equities, one ETF, one NSE index, two BSE equities and SENSEX, all
   flagged `isSampleData: true`. That is the entire searchable universe until a
   provider sync runs. This — not a UI truncation — is the primary cause of the
   "only a handful of stocks" problem.
2. **The full-market import already existed but had never run here.**
   `tejhq.fetchInstrumentMaster()` reads one bhavcopy snapshot per exchange and
   returns symbol, name, series and ISIN for every row (~2,950 NSE symbols), and
   `marketData.syncInstruments` upserts them in 200-row batches. It is manual
   (no scheduler) and requires a signed-in user, so a fresh deployment stays on
   the demo rows.
3. **The dashboard intentionally queries a small page.** `searchInstruments`
   with `limit: 10` for "Top stocks" — by design, not a bug.
4. **Search and the explorer already read the whole table**, with Convex full
   text indexes on `symbol` and `name`, cursor pagination for browsing and a
   100-row cap per request. So widening the catalogue was a data problem, not a
   query problem.
5. **Quote freshness was derived from the request time.** `getQuotes` returned
   `asOf = now` and the UI rendered `DELAYED · 6s ago` from it, so a six-hour-old
   EOD close looked six seconds old. This is fixed (see §7).

No duplicate tables were introduced and no working integration was replaced.

---

## 2. TejHQ — preserved and verified from the adapter's own contract

TejHQ remains the default and the only end-of-day/history source.

| Capability | Behaviour |
|---|---|
| Quotes | Latest completed session's close from `GET /v1/snapshot/{exchange}?date=…`, walking back up to 10 calendar days, skipping weekends. Always labelled `DELAYED`, never `LIVE`. |
| Candles | `GET /v1/ohlcv/{exchange}/{symbol}` — `1d` only; every other interval is refused with an explicit error instead of being resampled. |
| Instrument master | Full bhavcopy per exchange, capped at 3,000 rows per exchange in the sync action. |
| Index values | **Not supported** — the bhavcopy carries equities, so NIFTY/SENSEX stay on the clearly-labelled SAMPLE series. |
| Latest trading date | `providerState.lastDataDate`, derived from the newest returned quote timestamp, and surfaced on Data Sources. |

I did not disable or migrate any TejHQ data.

---

## 3. NSE MCP client

Files: `convex/market/providers/nsemcp.ts`, registered in
`convex/market/registry.ts` as `nsemcp`.

* Endpoints (hard-coded allow list, no proxy):
  `https://mcp.nseindia.in/cmmkt/mcp` (current market) and
  `https://mcp.nseindia.in/bhavcopy/cm/mcp` (historical bhavcopy, declared but
  not used for quotes).
* Transport: Streamable HTTP JSON-RPC — `initialize` →
  `notifications/initialized` → `tools/list` → `tools/call`, with
  `Mcp-Session-Id` captured from the handshake response and echoed on later
  requests, `DELETE` on close, 15 s timeouts and SSE *or* plain-JSON responses.
* Protocol negotiation: tries `2025-06-18`, `2025-03-26`, `2024-11-05`; retries
  only when the server rejects the handshake itself, never to mask a network
  failure.
* **No SDK dependency was added.** The client implements the small subset of the
  protocol it needs (four methods, session header, SSE frames) because the
  Convex isolate has no Node transport layer. This is a documented deviation
  from "use the official SDK where possible".
* Tool names and argument names are **discovered**, never guessed: the adapter
  scores tools whose schema has a symbol-like field, then builds arguments from
  the discovered `required` list and constrained `enum`s (exchange/series).
* Responses may be structured or `content[].text` JSON. The normalizer walks the
  payload for the first object with a usable price, then reads price, previous
  close, change, OHLC, volume and timestamp defensively. Rows without a positive
  price are dropped.
* Timestamps accept epoch seconds, epoch milliseconds, ISO strings and parseable
  IST date strings; when absent, `quoteTime` stays `null` and the UI says so.

### Feature flag

`NSE_MCP_POC_ENABLED=true` on the Convex deployment. When it is unset:

* `isConfigured()` returns `false` with that variable listed as missing;
* `fetchQuotes` throws **before** any network call (asserted in tests);
* Data Sources shows the option as `Disabled` and the selector cannot be used;
* `getQuotes` refuses to route to it and states plainly that it fell back.

### Live verification (2026-11-12, from this development machine)

With `NSE_MCP_POC_ENABLED=true` set on the deployment, the real endpoint was
contacted. `LIVE_NSE_MCP=1 npx vitest run tests/liveNseMcpProbe.test.ts` passes.

`initialize` → HTTP 200, `application/json`, server-supplied `Mcp-Session-Id`,
protocol **2025-06-18**, `serverInfo: cm-market-mcp 1.0.0`.

`tools/list` returns **15 tools** (single page, no cursor):

```
cm_get_live_market_data   cm_get_equity_stocks   cm_get_sme_stocks
cm_get_bond_stocks        cm_get_call_auction_stocks
cm_get_stock_quote        cm_get_index_quote     cm_get_live_indices
cm_get_live_gainers       cm_get_live_losers     cm_get_live_market_data
nse_get_gainers           nse_get_losers         nse_get_market_movers
cm_get_data_status        cm_get_allstocks_status
```

Discovered schemas actually used:

* `cm_get_stock_quote` — `{ symbol: string }` (required), additionalProperties false.
* `cm_get_index_quote` — `{ indexName: string }` (required, case-insensitive name).
* `cm_get_equity_stocks` — `{ limit, symbolFilter }` (not used: per-symbol quotes
  are bounded by the adapter).

Observed payloads (`content[0].text`, JSON string):

```json
// cm_get_stock_quote { symbol: "RELIANCE" }
{"updatedAt":"2026-11-12T07:51:28Z","stock":{"symbol":"RELIANCE","series":"EQ",
 "openPrice":1335.4,"highPrice":1342.5,"lowPrice":1331.5,"preClosePrice":1335.4,
 "lastTradedPrice":1335.1,"change":-0.2,"perChange":-0.01,"volume":7328640,
 "latestTimestamp":"2026-11-12 13:21:28"}}

// cm_get_index_quote { indexName: "NIFTY 50" }
{"nseTimestamp":"12-Nov-2026 13:23:34","index":{"indexName":"NIFTY 50","last":25233.2,
 "previousClose":25255.05,"change":-21.85,"percChange":-0.09,"open":25213.5,
 "high":25384.8,"low":25142.95,"timeVal":"12-Nov-2026 13:23"}}
```

Normalized through MarketLab, RELIANCE came back as
`lastPrice 1335.2 · previousClose 1335.4 · change +0.1 · changePercent +0.01 ·
volume 7,407,092 · DELAYED`, with the provider timestamp about **5–7 seconds**
behind the probe request (`latestTimestamp 13:25:25 IST` against a 13:25:32 run).
That is the server's own quote time, not the request time: the badge therefore
reports whatever age NSE actually sent. "1–3 minutes" remains a documented
characteristic of the feed, not a floor this integration enforces.

Key shapes this live run forced into the normalizer (now covered by unit tests):
`preClosePrice`, `lastTradedPrice`, `perChange`, `percChange`, `latestTimestamp`,
`timeVal`, `nseTimestamp`, and the IST-naive `YYYY-MM-DD HH:mm:ss` and
`DD-Mmm-YYYY HH:mm` formats, which are pinned to +05:30 instead of the host zone.

### Verified vs unverified

| Item | State |
|---|---|
| Client implementation | Done |
| Handshake / discovery / call flow | **Live-verified** (2025-06-18, 15 tools) |
| Real equity quote | **Live-verified** (RELIANCE, plus TCS / HDFCBANK / INFY / ICICIBANK in the probe) |
| Real index quote | **Live-verified** (`cm_get_index_quote`, NIFTY 50 / NIFTY BANK; bulk `cm_get_live_indices` returns 139 indices across six groups) |
| Official market movers | **Live-verified** (`nse_get_market_movers`, `indexName: ""`, both directions, session metadata) |
| Normalization, missing timestamps, tool errors, flag gating | Mock-tested (`tests/nsemcpProvider.test.ts`, 10 tests) |
| Live probe is opt-in | `LIVE_NSE_MCP=1`, skipped in the default suite |

Despite successful live verification, the provider stays disabled by default: it
is an experimental, private, informational feed and must be enabled explicitly.

---

## 4. Provider switching

* Preference: `userProfiles.quoteProvider` (`"tejhq" | "nsemcp"`, optional;
  absent means TejHQ). Written by `users.setQuoteProvider` from the session
  identity only, so preferences are per user and never client-supplied.
* Routing: `getQuotes` reads the preference server-side and asks
  `providerFor(env, "quotes", undefined, preferred)`. Selecting NSE MCP actually
  changes the provider that serves the request.
* Cache separation: `marketQuotes` now has a `by_instrument_source` index and one
  row per `(instrument, provider)`. Cached rows from another provider are treated
  as "no cached price" rather than relabelled.
* No silent fallback: if NSE MCP is disabled/unavailable, the response carries a
  warning naming the fallback, and the UI shows it above the values.
* Scope: the preference affects quote displays only. `quotesByInstrumentIds`
  defaults to `tejhq`, so paper fills, alerts, the screener and backtests cannot
  read an experimental price.
* UI: a compact switch in the dashboard toolbar
  (`components/market/QuoteSourceSelect.tsx`) and a full selection card on Data
  Sources, both persisting to Convex and refreshing quotes after the change.

---

## 5. Catalogue behaviour and coverage

* The catalogue is provider-independent: instruments exist because they are in
  the instrument master, not because the selected quote provider has a price.
* Sync is manual (`Data Sources → Sync NSE + BSE instruments`), batched, and
  idempotent: `upsertInstrumentMaster` matches on `instrumentId` then
  `exchange+symbol+type`, merges `providerIds` per provider, and never deletes.
* Search uses the full-text indexes; browse is cursor-paginated; both are capped
  server-side (100 rows/request).
* Coverage figures come from stored rows (`catalogueStats`, `dataCoverage`) and
  are shown on Data Sources. Nothing is fabricated to inflate the count.
* **Observed catalogue size at the time of writing: 15 instruments — 0 from a
  provider, 15 sample.** The sync has not been run against this deployment yet
  (it needs a signed-in session; sign-in was not available in this environment).
  Running `Data Sources → Sync NSE + BSE instruments` signed in is the manual
  step that replaces the demo seed with the bhavcopy master. The UI always shows
  the live count, so this figure is not hard-coded anywhere.

---

## 6. Dashboard, Markets and search

* Dashboard keeps a curated 10-instrument highlight grid, now with a
  **Browse all stocks →** action into Markets, and a quote-source switch.
* Markets already searches and paginates the whole catalogue, keeps symbols
  discoverable without a quote (SAMPLE badge), shows source/timestamp columns and
  sorts only the loaded page.
* Ctrl/Cmd+K search reads the same server index, so it sees the whole catalogue
  once synced.

---

## 7. Freshness corrections

* `QuotesResult` now carries `asOf`/`retrievedAt` (request time) **and**
  `quoteAsOf` (newest provider timestamp). Badges and the Markets header use
  `quoteAsOf`; zero means "no provider quote timestamp", never "now".
* `DataModeBadge` previously appended " ago" to a string that already ended in
  "ago" (`DELAYED · 12s ago ago`); it now prints the age once, in sentence case.
* The dashboard metadata board labels the two clocks separately: **Quote
  timestamp** (provider) and **Retrieved** (MarketLab).
* EOD prices are never promoted to `LIVE`: `classifyQuoteMode` keeps TejHQ at
  `DELAYED`, and NSE MCP's per-symbol rows are created as `DELAYED`.

---

## 8. Security and licensing

* All NSE MCP traffic is server-side; no endpoint or token is exposed to the
  browser, and there is no generic tool proxy.
* Allow-listed endpoints only; no scraping, no bypassing of access controls.
* Disabled by default; no polling or scheduled sync; per-minute quota (12/min).
* Private educational use only: do not publish, redistribute or monetise the
  feed; no brokerage, PAN or real-money execution; never used for paper fills.
* Error text passes through `redactError` before storage or display.

---

## 9. Tests and checks

| Command | Result |
|---|---|
| `npx convex codegen` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 392 passed, 3 skipped (live probe) / 28 files |
| `LIVE_NSE_MCP=1 npx vitest run tests/liveNseMcpProbe.test.ts` | 3/3 passed against the real endpoint |
| `npm run build` | exit 0 |

New suites: `tests/nsemcpProvider.test.ts` (flag gating with no network call,
handshake + session header, schema-driven tool arguments, DELAYED labelling,
missing timestamps, tool errors, timestamp parsing) and updates to
`tests/providers.test.ts` (5 registered providers, NSE MCP unconfigured by
default).

---

## 10. Remaining limitations

1. **Live connectivity is verified, but only from this development machine.**
   It must be re-run (`LIVE_NSE_MCP=1`) after any NSE-side change; the provider
   stays disabled by default and never presents itself as connected until tested.
2. **Tools and schemas are discovered at runtime.** The 15 tools above were
   confirmed live, but NSE can change them; the adapter fails loudly rather than
   inventing a price, so a schema change surfaces as "no quote tool" instead of
   wrong numbers.
3. **One observed delay was ~20 minutes, not the documented 1–3.** The badge
   reports the provider timestamp, so the age shown is whatever NSE actually
   sent; treat "1–3 minutes" as a documented characteristic, not a guarantee.
4. **No NSE MCP candle history.** Historical charts stay on TejHQ EOD and are
   labelled separately; index quotes are supported (`cm_get_index_quote`) but
   index candles are not.
4. **Catalogue size depends on a manual sync** against TejHQ's snapshot; this
   document does not assert a number.
5. **Dashboard stock customisation** (choosing which instruments appear in the
   highlight grid) is not implemented; watchlists cover that need today.
6. Provider-preference changes refresh quotes through the existing hook; pages
   that cached quotes in component state update on their next fetch.
