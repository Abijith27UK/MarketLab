# MarketLab — Phase 2 market data setup

This document explains how MarketLab's market-data layer is put together, what it can
honestly claim today, and exactly which credentials you must supply yourself.

Everything runs at **zero API subscription cost**. No paid plan is activated, and no paid
endpoint is called automatically.

---

## 1. Architecture

```
convex/market/
  types.ts            provider-neutral instruments, candles, quotes, capabilities
  time.ts             IST conversion, exchange session, range chunking
  normalize.ts        validation, de-duplication, gap detection, freshness labels, redaction
  indicators.ts       SMA / EMA / RSI / MACD / Bollinger / VWAP (shared with the UI)
  csv.ts              CSV ingestion with rejected-row reporting
  sample.ts           deterministic SAMPLE series (never labelled live)
  rateLimit.ts        per-minute window + daily quota helpers
  hash.ts             SHA-256 for provider request signing
  registry.ts         explicit capability-based provider selection
  providers/fyers.ts    FYERS API v3
  providers/breeze.ts   ICICI Direct Breeze
  providers/tapetide.ts Tapetide (fundamentals)
  providers/tejhq.ts    TejHQ keyless NSE/BSE end-of-day Bhavcopy

convex/marketData.ts    quotes, candles, search, provider status, sync, CSV import
convex/marketStore.ts   internal queries/mutations (never exposed to clients)
convex/screener.ts      screener + saved user screens
convex/chartPreferences.ts

src/components/chart/PriceChart.tsx   lightweight-charts (Apache-2.0)
src/components/market/DataModeBadge.tsx
src/hooks/useQuotes.ts                one batched request per page of quotes
src/lib/marketClient.ts               typed client bindings
src/lib/format.ts                     IST / INR formatting
src/pages/{Markets,InstrumentDetail,Screener,DataSources}.tsx
```

Every private query and mutation derives the owner from `getAuthUserId(ctx)`. No handler
trusts a client-supplied user id.

---

## 2. Data freshness labels

Every number the API returns carries a `mode`, decided **on the server**:

| Label | Meaning |
| --- | --- |
| `LIVE` | Provider tick, market open, fetched within the TTL and quoted within 120 s |
| `DELAYED` | Provider states delayed data, or the tick is older than 120 s |
| `CACHED` | Cache entry beyond its TTL, or the market is closed (last trade is not "live") |
| `HISTORICAL` | Candle series |
| `SAMPLE` | Deterministic generated data — not market data |

Rules are implemented in `classifyQuoteMode` and covered by tests, including
"stale data is never labelled LIVE".

---

## 3. Credentials

Secrets live **only** in the Convex deployment environment, read only inside actions.
They are never `VITE_`-prefixed, never bundled, and never logged (errors are redacted).

`.env.local` is for the frontend (`VITE_CONVEX_URL`) and does **not** feed Convex
functions. Set backend values with:

```bash
npx convex env set NAME value        # dev deployment
npx convex env list                  # names only, values are not printed back
```

### FYERS (primary)

| Variable | Notes |
| --- | --- |
| `FYERS_APP_ID` | e.g. `XXXXXXXX-100` |
| `FYERS_SECRET_ID` | App secret id |
| `FYERS_ACCESS_TOKEN` | Daily token; expires **06:30 IST** |
| `FYERS_REFRESH_TOKEN` | Optional; 15-day validity |

```bash
npx convex env set FYERS_APP_ID ...
npx convex env set FYERS_SECRET_ID ...
npx convex env set FYERS_ACCESS_TOKEN ...
```

The app needs the **Market Data** permission on the FYERS app (Quotes, Market Depth,
Historical Data). History limits: 100 days per request for intraday resolutions,
366 days for D/W/M; the Standard plan exposes ~1 year intraday and ~5 years daily.
Access tokens expire daily, so the token must be refreshed (the adapter contains the
documented `validate-refresh-token` call, but the new token has to be written back with
`npx convex env set` — secrets are never persisted by application code).

### ICICI Direct Breeze (secondary)

| Variable | Notes |
| --- | --- |
| `BREEZE_APP_KEY` | From the Breeze API portal |
| `BREEZE_SECRET_KEY` | Used to sign every request |
| `BREEZE_SESSION_TOKEN` | From an **interactive** ICICI Direct customer login; ~24 h |

An AppKey alone cannot read market data. Supported history intervals are
`1minute`, `5minute`, `30minute`, `1day` — MarketLab exposes **1m, 5m, 1d** only and
refuses other intervals rather than resampling. Documented limits: 100 calls/minute,
5,000/day.

### Tapetide (optional fundamentals)

| Variable | Notes |
| --- | --- |
| `TAPETIDE_API_TOKEN` | Personal token (`tpt_rt_…`) |

Free plan: 50 successful calls per IST day, 60/minute burst. Quotes are snapshots and are
always labelled `DELAYED`.

### TejHQ (keyless, no account)

TejHQ's open tier needs **no credentials at all** — no demat account, PAN, broker login,
API key or paid plan. Nothing is set in the Convex environment; the adapter is always
eligible and sits last in `PROVIDER_PRIORITY`, so a configured broker feed always wins.

| Endpoint | Use in MarketLab |
| --- | --- |
| `GET /v1/ohlcv/{exchange}/{symbol}?from&to` | Daily candles (`1d` only) |
| `GET /v1/snapshot/{exchange}?date` | EOD quotes + instrument master rows |
| `GET /v1/actions/{symbol}` | Not used (corporate actions) |
| `GET /health`, `/ready` | Liveness only |

Verified live on 2026-10-31 against `https://api.tejhq.dev/openapi.yaml`: NSE coverage from
2010-01-04, BSE from 2024-07-08, refreshed on trading days at 18:30 IST (21:30 IST retry).
`/v1/ohlcv`, `/v1/snapshot` and `/v1/actions` are keyless; `/v1/adjusted` and `/v1/symbols`
need a free key and are **not** used.

**This is DAILY / EOD data, never intraday.** Every candle is a completed session, quoted
by its IST session date and labelled `HISTORICAL`; quotes are the latest completed close,
labelled `DELAYED`. There is no `1m`/`5m`/`15m`/`1h` coverage, no streaming and no live
tick, and the adapter refuses intraday intervals instead of resampling.

Bhavcopy closes are not split/bonus adjusted, so `adjusted` is reported as `unknown`.
Indices and non-equity instruments are absent from the Bhavcopy and stay on the labelled
SAMPLE fallback.

### Public dataset vs the HTTP API (backtesting)

`tejhq/indian-markets` on Hugging Face is the same pipeline that feeds `api.tejhq.dev`:
both are built from the official exchange Bhavcopy and published from the same run, so the
dataset is **not a more authoritative source** than the API. It is only a different access
path, and MarketLab therefore keeps the HTTP adapter as the single provider.

For bulk historical backtesting the dataset would still be the better transport (no
request budget, partitioned Parquet covering NSE from 2010 and BSE from 2024-07-08, plus
back-adjusted prices and a survivorship-bias-free liquidity universe). Adopting it would
require a Parquet reader and nightly ingestion into `candleDatasets`, which is a separate
piece of work and is not wired up here. The app never downloads the dataset automatically.

---

## 4. Capabilities actually implemented

| Capability | FYERS | Breeze | Tapetide | TejHQ (keyless) |
| --- | --- | --- | --- | --- |
| Instrument lookup / master sync | ✅ public `sym_details` CSV, column layout auto-detected | ⚠️ security master is a ZIP — CSV import only | ✅ search route | ✅ full-market Bhavcopy snapshot |
| Quotes | ✅ `/data/quotes`, 50 symbols | ✅ `/quotes`, one symbol per call | ✅ `/quotes` (20), `DELAYED` | ✅ latest completed close, `DELAYED` |
| Candles | ✅ 1m 5m 15m 1h 1D 1W 1M | ✅ 1m 5m 1d | ❌ not claimed (route params unverified) | ✅ `1d` only (EOD) |
| Streaming | ❌ | ❌ | ❌ | ❌ |
| Fundamentals | ❌ | ❌ | ✅ quote fundamentals + statements | ❌ |
| Market status | derived locally from IST hours | same | same | session close timestamp only |

**Streaming is not enabled.** Both brokers offer websocket feeds, but a persistent socket
host is outside this Convex deployment. Quotes are refreshed through the server with
caching and rate limits and are labelled by freshness, never claimed as a live stream.

---

## 5. Licensing / redistribution — unresolved

* **FYERS** — redistribution of market data to other users requires FYERS and exchange
  permission. Treat as development-only until confirmed in writing.
* **ICICI Breeze** — the API terms prohibit sublicensing, permanent caching for
  redistribution, and sharing credentials. One customer's session must not serve all
  MarketLab users.
* **Tapetide** — terms prohibit redistribution and commercial exploitation without
  permission; the free tier is for evaluation.
* **TejHQ** — pipeline code is MIT, but the data is exchange-published Bhavcopy and is not
  covered by that licence. Check exchange redistribution terms before exposing it publicly.

MarketLab therefore keeps provider data in a short-lived cache (`CANDLE_CACHE_TTL_MS`,
expired caches purged) and shows sample data when no provider is configured. Before
opening the app to the public, obtain written permission or a licensed data vendor.

---

## 6. Operating the app

```bash
cd marketlab
npx convex dev        # backend (required for auth + persistence)
npm run dev           # frontend
```

Order-of-operations after pulling this branch:

1. `npx convex dev` — pushes the schema and regenerates `convex/_generated/`.
2. `npx convex env set …` — add provider credentials (optional).
3. `npm run dev` — open the app.

Instrument master: **Data Sources → Sync NSE + BSE instruments**. A failed or empty sync
never replaces existing instruments; the 15 sample records remain.

Historical CSV import: open an instrument → **Historical data**. Columns
`timestamp,open,high,low,close,volume` (header optional). Naive timestamps are read as IST.
Rows with inconsistent OHLC, unknown timestamps, or duplicates are reported.

Saved screener configurations and chart preferences are per user and enforced server-side.

---

## 7. Verification

```bash
npm run test        # vitest: indicators, IST, CSV, normalization, freshness, rate limits, adapter parsing
npm run typecheck   # tsc --noEmit (src + generated API)
npm run build       # production build
```

`npx convex dev` performs schema validation and function deployment; provider connection
tests are available per provider on the Data Sources page and only make a real documented
request when credentials are present.

---

## 8. When the backend is unreachable (demo mode)

The frontend never opens a Convex WebSocket until the deployment answers a plain HTTP
probe. This exists because a `ConvexReactClient` retries its socket indefinitely, which
previously left the dashboard blank and filled the console with `ERR_CONNECTION_REFUSED`.

The probe is two-step, because the two endpoints behave differently for browsers:

1. `POST <VITE_CONVEX_URL>/api/query` with an empty path. The HTTP API is CORS-enabled and
   rejects the empty body with a 4xx — which proves a Convex deployment (not just an open
   port) answered. Nothing is written. A 5xx counts as reachable but unhealthy.
2. If that request is blocked or fails, `GET <VITE_CONVEX_URL>/version` is fetched with
   `mode: "no-cors"`. `/version` serves no CORS headers, so a normal fetch fails from
   another origin even when the port is open; an opaque response still proves liveness,
   and a rejection means the port is closed.

How it behaves now:

| Deployment state | What the app does |
| --- | --- |
| answers the probe | creates the client, mounts `ConvexAuthProvider`, normal auth + persistence |
| does not answer | creates **no** client, shows a status banner, runs on the labelled SAMPLE dataset |
| probe recovers | client is created and the normal pages replace the sample views |

The measured empty-path 4xx appears in the browser console as one `400 (Bad Request)` line
per probe (every 30s while healthy). That is the probe itself, not a failing request from
the app; it is the price of verifying a real Convex deployment rather than any open port.

Probe cadence is bounded: 2s → 4s → 8s → 15s → 30s → 60s (cap), and every 30s while healthy.
The banner shows the target host, the last error, the attempt count, the next check, a
manual **Retry now**, and the exact steps to bring the deployment up. Pages that own user
data (watchlists, screener, profile, data sources) show an explicit "backend unavailable"
panel instead of fabricating values.

### Local deployment prerequisites

`VITE_CONVEX_URL` in `.env.local` points at `http://127.0.0.1:3210`, the deployment created
by `npx convex dev` (see `.convex/local/default/config.json`). That backend only exists while
`npx convex dev` is running on this machine.

Known blocker on this Windows host (2026-10-28): the Convex CLI resolves the backend build
`precompiled-2026-10-22-1447815` and Windows **Application Control blocks the downloaded
executable** (`Permission denied`). The older build `precompiled-2026-10-10-72ce13c` still
executes, but the CLI pins the newer one, so `npx convex dev` fails with
`Failed to run backend binary` and nothing listens on port 3210. This is a machine policy —
it must not be bypassed. Options, in order of preference:

1. Allow the binary through Application Control yourself, then run `npx convex dev`.
2. Use a hosted deployment instead: `npx convex login` → `npx convex dev` → copy the printed
   `https://<name>.convex.cloud` URL into `VITE_CONVEX_URL` and restart `npm run dev`.
3. Keep working in demo mode — everything except auth and persistence is functional.

Never put credentials in `VITE_*` variables: they are inlined into the browser bundle.
Provider secrets belong in `npx convex env set …` only.

### What demo mode shows

- Index cards (NIFTY 50, BANK NIFTY, SENSEX) and ten NSE large-cap stock cards.
- The same `StockCard` component as the live dashboard, with sparklines from the shared
  deterministic sample series.
- Instrument detail with 1m/5m/15m/1h/1D/1W/1M sample candles, candlestick/bar/line, and
  SMA/EMA/RSI/MACD/Bollinger/VWAP toggles.

Every value in this mode is labelled `SAMPLE`, no ranking (gainers/losers) is computed, and
no account balance is displayed.
