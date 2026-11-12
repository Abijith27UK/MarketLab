# Market data coverage and chart sources

Investigation and fixes for two reported problems: a Markets/Search experience
limited to a handful of stocks, and charts that stayed on TejHQ history after
selecting NSE MCP.

Provider checks were run against the live services on **2026-11-12** from this
workspace. No token or key value appears in this document.

## 1. Root causes of the limited catalogue

1. **The catalogue had never been synced.** The database held exactly the
   `demo_catalogue` seed — 15 sample rows and **zero** provider rows. TejHQ's
   full-market master was therefore never loaded, so `WIPRO` returned no search
   hits and Markets/browse showed only the sample rows.
2. **Sync required an interactive sign-in, and nothing bootstrapped it.** The
   `marketData.syncInstruments` action correctly requires a user, but a fresh or
   signed-out deployment stays on the 15-row seed indefinitely. There was no
   admin/CLI path to seed shared reference data.
3. **Catalogue limits were not the cause.** `searchInstruments`
   (`convex/marketData.ts:193`) already paginates with `by_symbol` and uses
   `search_symbol` / `search_name` full-text indexes; `getQuotes` caps quotes at
   60 per request (`MAX_QUOTE_SYMBOLS`), and NSE MCP caps its own quote loop at
   12 symbols per call. Those are quote limits, not catalogue limits.
4. **Charts were hard-wired to the default candle provider.** `getCandles`
   called `providerFor(env, "candles", interval)` with no preference, and only
   TejHQ declared candle support. So selecting NSE MCP changed quotes only.
5. **Cache rows were not source-scoped.** `latestDataset`
   (`convex/marketStore.ts:680`) picked the newest dataset for an
   instrument/interval regardless of `source`, so a TejHQ cache could be served
   after switching the chart source.

Dashboard "featured stocks" (7 cards) is intentional and unrelated to either bug.

## 2. Fixes implemented

| Area | Change |
| --- | --- |
| Catalogue | `marketData.syncCatalogue` internal action (CLI-only) seeds/refreshes the master without a browser session. Idempotent: existing rows are patched in place, so watchlists/research links keep their `_id`. |
| Catalogue | Ran it for NSE: **2,969 inserted, 9 existing sample rows upgraded in place** (ITC, RELIANCE, TCS, …), master total 2,978 rows. |
| Chart source | `userProfiles.chartSource` (`"tejhq" \| "nsemcp"`), `users.setChartSource`, `marketStore.preferredChartSource`, and a `source` argument on `getCandles`. |
| Chart source | `getCandles` resolves an explicit source → saved preference → TejHQ. An explicit source that cannot serve the interval throws instead of silently swapping providers. |
| Chart source | New chart-source control in the Charts tab (TejHQ EOD / NSE Bhavcopy EOD), disabled until the backend reports it available and when signed out. 5Y/MAX are disabled for NSE Bhavcopy (12-month cap). |
| Cache | `latestDataset` accepts a `source` filter: provider caches are matched by source; user CSV imports stay eligible. |
| Providers | NSE MCP now declares daily candles and implements `fetchCandles` via the bhavcopy server. The registry keeps TejHQ as the *default* candle provider; NSE history is opt-in only, so backtests and existing charts keep their source. |

## 3. Provider verification (live, 2026-11-12)

### NSE MCP — current market (`https://mcp.nseindia.in/cmmkt/mcp`)

- Feature flag `NSE_MCP_POC_ENABLED` is **true** on the deployment (it was not
  changed by this work).
- Handshake: MCP `2025-06-18`, 15 tools including `cm_get_stock_quote`,
  `cm_get_index_quote`, `cm_get_equity_stocks`.
- Quotes verified earlier in this workspace: RELIANCE 1335.0 (−0.03%),
  NIFTY 50 25229.85, NIFTY BANK 61318.9, TCS 2429.6, HDFCBANK 810.2, INFY 1144.2.
  Provider timestamps were ~5–7 s behind request time; all labels remain
  DELAYED, never LIVE.
- No intraday candle tool exists. No bulk instrument-master sync is advertised
  (the catalogue is seeded from TejHQ's snapshot).

### NSE MCP — Bhavcopy (`https://mcp.nseindia.in/bhavcopy/cm/mcp`)

- Handshake: MCP `2025-06-18`, **21 tools**.
- Stock history: `get_stock_history(symbol, months, endDate)`.
- Verified call `{symbol:"ITC", months:3, endDate:"2026-11-11"}` returned
  `trading_days: 63` with rows `{symbol, series, open, high, low, close, volume,
  date}` from 2026-08-11 to 2026-11-11.
- Passing `from`/`to` instead of the advertised arguments makes the server throw
  a Java NPE, so the client builds arguments strictly from the discovered input
  schema.
- Normalized into **62 chart candles** (EQ rows, validated, de-duplicated,
  sorted) for the probe window. Prices are unadjusted; `adjusted` is reported as
  `unknown`.
- Additional tools observed (not used by charts): `search_symbols`,
  `nse_lookup_symbol`, `get_bulk_quote`, `get_index_history`, `get_quote`,
  `get_52_week_high_low`, `moving_average`, `get_corporate_actions`.

### TejHQ

- Keyless EOD snapshot verified: `GET /v1/snapshot/nse?date=2026-11-11` →
  **2,978 rows** with symbol/series/ISIN/name/OHLCV. This is the catalogue and
  default chart source.

### Tapetide (research)

- `TAPETIDE_API_TOKEN` is present. **REST is not included in the Free plan**:
  every route returns HTTP 200 with `data: null` and
  `notice.code = "api_access_not_in_plan"` (ITC and RELIANCE, including
  `/me/usage`). No REST request is charged.
- The same token works on the MCP server (`https://mcp.tapetide.com/mcp`, 55
  tools). Research now reads MCP and was verified live for ITC: profile
  (PE 18.88, PB 4.99, ROE 29.3%, ROCE 38.9%, D/E 0.01, market cap
  ₹3,60,502.98 Cr, EPS 15.08, dividend yield 5.09%), 3 annual + 4 quarterly
  statements, 23 shareholding periods, 7 news rows and 27 corporate actions.
  Full detail in `docs/STOCK_RESEARCH_INTEGRATION.md`.

### GNews

- `GNEWS_API_KEY` is present. One live query for `"ITC Limited"` returned 1
  article: *"ITC to participate in CITIC CLSA and Morgan Stanley investor
  forums"*, publisher `scanx.trade`, with a publication timestamp and a valid
  URL. Free-tier delay (~12 h) applies and is surfaced in the UI.
- Coverage is query-sensitive: the quoted full company name is precise but
  narrow. Relevance filtering and dedupe run on every result.

## 4. Catalogue coverage and search

- Total instruments after the sync: ~2,987 (2,978 NSE master rows plus the
  BSE/index sample rows kept for offline use).
- `WIPRO` now resolves to a `tejhq`-sourced catalogue row; previously 0 hits.

Verified TejHQ EOD quotes (all DELAYED, session 2026-11-11, one batched request):
RELIANCE 1335.4 · TCS 2472.1 · INFY 1155 · HDFCBANK 806.6 · ICICIBANK 1571.6 ·
ITC 285 · SBIN 1061.2 · WIPRO 197.99 · HINDUNILVR 2022.4 · TATASTEEL 189.28 ·
IRCTC 472.1 · DABUR 382.6 · EICHERMOT 7592 · AUROPHARMA 1827.5 · COFORGE 2017.5.

Historical NSE Bhavcopy coverage verified live: ITC 62 candles, RELIANCE 62,
WIPRO 62, INFY 62 (30-day probe window). NSE current-market quotes were verified
earlier for RELIANCE/TCS/HDFCBANK/INFY/ICICIBANK and the two indices only; no
wider NSE quote sweep was run (12 symbols per request cap).
- Markets browse paginates with a Convex cursor; search uses full-text indexes on
  symbol and name. Quote fetching is bounded and separate from listing, so an
  instrument can exist in the catalogue with no current quote.

## 5. Quote source vs chart source

| Concern | Default | Alternative |
| --- | --- | --- |
| Informational quote | TejHQ EOD | NSE MCP delayed snapshot |
| Historical chart | TejHQ EOD daily | NSE Bhavcopy daily (max 12 months) |

Both are chosen independently and labelled in the UI (quote block shows the
quote provider and session time; the chart note names the history source).

## 6. Intraday

**Official NSE MCP intraday candlestick history is not available through the
verified tools.** The current-market server exposes session statistics only, so
no intraday candles are generated from snapshots. Intraday intervals remain
whatever the configured provider genuinely serves (TejHQ: none).

## 7. Caching and freshness

- Candle caches are per instrument + interval + source, with a TTL and a
  freshness check; switching source never reuses another provider's rows.
- Bhavcopy history is fetched in ≤3-month chunks, capped at 12 months and 4 MCP
  calls per chart request, then cached.
- Provider timestamps, trading dates, retrieval time and cache update time stay
  distinct in the UI and API responses.

## 8. Tests and checks

- `tests/nseBhavcopyCandles.test.ts` — envelope unwrap, EQ filtering, sorting,
  duplicate dates, malformed/inconsistent bars, volume handling, intraday and
  non-equity rejection, feature-flag guard, capability registration.
- `tests/liveNseBhavcopyProbe.test.ts` — opt-in live probe
  (`LIVE_NSE_BHAVCOPY=1`): tool discovery plus a real 62-candle normalization.
- `tests/providers.test.ts` — explicit NSE candle selection, TejHQ default kept,
  no intraday NSE history, no NSE master sync.
- `npx convex codegen`, `npx tsc --noEmit`, `npx vitest run`, `npx vite build` —
  results in the task report.

## 9. Remaining limitations

- Tapetide returns no data with the current token, so company research stays
  unverified. This is a credential/permission problem, not a UI one.
- Bhavcopy history is unadjusted for splits/bonus; long ranges need multiple
  calls and are capped at 12 months per request.
- NSE MCP quotes are fetched one symbol per call (12 per request), so a Markets
  page shows quotes for only part of its visible rows. This is a quote limit, not
  a catalogue limit.
- NSE MCP index history is not wired to charts; the bhavcopy stock-history tool
  used here covers equities only.
- BSE catalogue rows depend on TejHQ's BSE snapshot; the NSE sync above does not
  add BSE rows.
