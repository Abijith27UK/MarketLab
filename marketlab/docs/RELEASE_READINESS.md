# MarketLab — Release Readiness (Phase 7)

Scope of this document: the state of the application after Phase 7 (defect
closure, regression, and release preparation). It records what was actually
executed, not what was intended.

Terms used throughout:

- **IMPLEMENTED** — code exists in the repository.
- **TESTED** — an automated or manual test was executed and passed.
- **LIVE-VERIFIED** — a genuine external service or provider response was
  observed.
- **UNVERIFIED** — insufficient evidence; treat as unknown.

## 1. Environment and deployment status

| Item | Value |
| --- | --- |
| Branch | `version_1` |
| Frontend | Vite + React 18, local dev server on `http://localhost:5173` |
| Backend | Local Convex deployment on `http://127.0.0.1:3210` (`convex dev`) |
| Auth issuer | `http://127.0.0.1:3211` (local Convex Auth) |
| Production deployment | **Not performed.** No hosted/production deployment exists or was attempted. |
| Market-data provider credentials | **None configured.** Every price in this environment is `SAMPLE`. |

No live broker, real-money trading, paid service, or production deploy was
introduced in this phase.

## 2. Commands actually run (Phase 7)

| Command | Result |
| --- | --- |
| `npx convex codegen` | Passed. Functions uploaded to the local dev deployment; generated bindings and `convex/_generated/api.d.ts` refreshed. |
| `npx tsc --noEmit` | Passed, exit 0, no output. |
| `npx vitest run` | Passed. **22 test files, 313 tests, 0 failures.** |
| `npx vite build` | Passed. Chunks: index 180.51 kB, charts 166.74 kB, react 142.93 kB, convex 86.51 kB, vendor 38.06 kB, css 34.49 kB. No build warnings. |

Baseline before this phase was 277 tests in 19 files; this phase added 36 tests
in 3 new files (`tests/candleFallback.test.ts`, `tests/alertIntegrity.test.ts`,
`tests/phase7Integrity.test.ts`).

## 3. Closed verification gaps

### 3.1 Candle provider-failure / fallback labelling — IMPLEMENTED, TESTED

- New pure module `convex/market/fallback.ts` owns the entire fallback path:
  `sampleCandleFallback`, `providerFallbackWarning`, `noProviderNote`,
  `sampleScreenerQuote`.
- `marketData.getCandles` now builds its sample series through that module, so
  the tested code is the shipped code.
- Verified by `tests/candleFallback.test.ts` (12 tests): result mode is always
  `SAMPLE` with source `sample`; never `HISTORICAL`, `LIVE`, or a provider id;
  the series is deterministic and capped; the provider's redacted message is
  kept while stating the data is not market history; the three no-provider notes
  are distinct and all say "sample".
- `REAL_ONLY` refusal is enforced in `convex/backtests.ts` (throws rather than
  substituting sample candles) — **code-reviewed here, browser-verified in
  Phase 4.1**, not re-executed in this phase.
- Live behaviour confirmed in the browser: instrument detail shows
  "No configured provider serves 1d candles — showing sample data." with
  `SAMPLE` badges, 524 candles, 208 gaps reported.

### 3.2 Alert integrity — IMPLEMENTED, TESTED, LIVE-VERIFIED

- New `convex/alertsCore.ts` holds the evaluation rules; `alerts.evaluate` uses
  `planAlertEvaluation`, so the tests exercise the shipped decision path.
- Rule added: only `LIVE`, `DELAYED` and `SAMPLE` quotes may satisfy a
  threshold. A `CACHED` or `HISTORICAL` price is recorded on the row with its own
  label but **never fires**, and is counted in a new `skippedStale` field shown
  in the Alerts page notice.
- `tests/alertIntegrity.test.ts` (13 tests) covers: only ACTIVE alerts evaluated;
  paused/triggered leave no observation; re-armed alerts fire again; no duplicate
  trigger on repeat runs; missing/zero/NaN/Infinity prices skipped; another
  instrument's quote is never borrowed; SAMPLE crossings counted separately;
  mixed runs keep provider and sample rows distinguishable; the Convex comparison
  matches the UI helper `isAlertConditionMet` at every boundary.
- Server-side re-checks (`userId`, `status === "ACTIVE"`) inside
  `internal.alerts.applyEvaluation` were reviewed; they are executed by the
  deployment but not by an in-process test harness (see §7 limits).

### 3.3 Paper-trading and saved-backtest integrity — IMPLEMENTED, TESTED

- `tests/phase7Integrity.test.ts` (11 tests) adds: a buy that exactly consumes
  available cash settles at zero rather than negative; one rupee short is
  rejected with no cash/position side effect; sells never exceed the position;
  only the unreserved part of a position is sellable; a resting limit order
  touches no cash or position while reserving its worst case; reservations stay
  per instrument; currency rounds to paise at 2 decimals.
- Backtest identity: identical inputs produce an identical `inputHash`, equity
  curve and trade list; the hash changes when cost assumptions change and when
  the sizing rule changes; `ENGINE_VERSION` is stamped on the result; a SAMPLE
  dataset is reported as given (the engine cannot upgrade its own provenance).
- Saved-run immutability confirmed in the browser: after editing the strategy
  (stop-loss added, version `v1 → v2`), the earlier run still displayed its
  original final equity ₹1,14,382.37, dataset hash and `input hash 5a73b582c9c7`.
  A new run produced a new hash (`3350fb2f3246`) and a second SAMPLE-labelled
  entry in the run history.

## 4. Defect found and fixed in this phase

**Screener listed quote-less instruments as results** (`convex/screener.ts`).
With no provider configured, a screen returned 15 rows with every price column
`—` while reporting "15 of 15 evaluated" — misleading placeholder content, and
the UI's advice to "load quotes on the Markets page first" did not actually
populate stored quotes in this deployment.

Fix, keeping the no-fake-data rule intact:

- Unquoted instruments are now priced from the deterministic SAMPLE series via
  `sampleScreenerQuote` (in the same audited fallback module), so a screen always
  filters on complete data.
- Every such row is labelled `SAMPLE` / `sample`, and the response carries a new
  `samplePriced` count that the page renders as an amber notice: "N rows priced
  from the deterministic SAMPLE series — no provider quote is stored for those
  instruments."
- The response note now reads "No provider quotes are stored, so every price here
  is the deterministic SAMPLE series — not market data…".
- Preset hints were corrected (the Gainers/Losers labels no longer claim a
  "stored quote"), and the zero-match message now names both remediation paths.
- Covered by tests in `tests/candleFallback.test.ts` (fallback is labelled and
  deterministic) and verified in the browser: 15 rows with live-looking prices,
  sorted by change, all labelled SAMPLE, with the notice present; a saved screen
  ("Phase 7 gainers") persisted and re-loaded.

## 5. Browser workflows verified in this phase

Desktop viewport 1440×900, mobile viewport 390×844. Browser: Chromium via the
in-app preview (real DOM events, real network).

| Workflow | 1440 px | 390 px | Evidence |
| --- | --- | --- | --- |
| Dashboard, indices, top stocks, movers | Pass | Pass | SAMPLE badges, "Not enough real source data to rank movers", no invented values |
| Session restored after reload | Pass | — | Paper account + cash + positions identical before/after reload |
| Global search (Ctrl+K, typing, ↑/↓, Enter) | Pass | — | 2 results for "REL"; Enter opened NSE RELIANCE detail |
| Markets → instrument detail, chart, gaps | Pass | — | Candles, gap count, SAMPLE label, fundamentals gated behind an explicit Load |
| Watchlists add + persist | Pass | — | HDFCBANK added to "Phase 5 Core" with SAMPLE label |
| Alerts: create, evaluate, duplicate, trigger, re-arm, edit, pause, resume, delete | Pass | — | See §5.1 |
| Paper trading: market buy, resting limit order, cancel | Pass | — | See §5.2 |
| Portfolio + order history + reconciliation | Pass | Pass | Cash + positions = account value; tables scroll inside their own container at 390 px |
| Screener: run, presets, save screen | Pass | — | See §4 |
| Strategy: create/edit, run backtest, saved runs, immutable snapshot | Pass | — | See §3.3 |
| Profile: preferences, locked starting capital | Pass | — | "Starting capital … is locked because orders already exist" |
| Data Sources: provider status, missing env names, setup commands | Pass | — | Names only, no values |
| Signed-out dashboard and gating | Pass | — | Sample market data + sign-in card; no private records rendered |
| Page-level horizontal overflow | None | None | `scrollWidth` 374 ≤ 390 on all pages checked |

### 5.1 Alerts evidence

- `Check now` on one active alert → notice "Checked 1 alert · 1 triggered · 1 of
  those triggered on SAMPLE prices."
- Immediate second check → "Checked 0 alerts · 0 triggered." (no duplicate
  trigger; triggered rows are excluded until re-armed).
- Triggered row displays `SAMPLE` + "SAMPLE price — not a real market move" and
  offers only Re-arm / Delete.
- Re-arm returned the row to ACTIVE and Edit reappeared; Pause → PAUSED and
  Resume → ACTIVE both persisted.

### 5.2 Paper-trading evidence

- Market buy 1 × BHARTIARTL filled at ₹2,125.97 · `SAMPLE` · sample; cash
  95,748.06 → 93,622.09; position 2 → 3 shares at a weighted average of 2,125.97.
- Limit buy 1 @ ₹1,000 rested `OPEN`, spendable cash dropped to 92,622.09
  (reservation), then Cancel returned it to 93,622.09 with no ledger movement and
  status `CANCELLED`.
- Portfolio arithmetic matched the backend: 93,622.09 cash + 6,377.76 positions =
  99,999.85 account value; invested cost 6,377.91; unrealised −0.15.

## 6. Security, ownership and isolation tests performed

Two real authenticated sessions were used: Account A (demo user, existing data)
and **Account B** created in this phase (`phase7.userb@example.test`) through the
normal signup form. No identity was forged and no auth path was bypassed.

- B's own private state: no paper account, no watchlist instruments, no alerts —
  it does not inherit A's records.
- Cross-user **reads** with B's JWT using A's record ids, via the Convex HTTP API
  (`127.0.0.1:3210/api/query`):
  - `backtests:get` → `null`
  - `backtests:listForStrategy` → `[]`
  - `strategies:get` → `null`
- Cross-user **writes** with B's JWT against A's ids:
  - `alerts:update`, `alerts:remove` → "Not authorized"
  - `watchlists:rename` → "Not authorized"
  - `strategies:remove` → "Strategy not found"
  - `backtests:remove` → "Run not found"
  - `paper:cancelOrder` → "Order not found"
- **Signed-out** requests: `alerts:list` and `paper:orders` return `[]`;
  `paper:ensureAccount` → "Not authenticated".
- After all attempts, A's data was unchanged: alert still ACTIVE at ₹2,100, two
  saved runs, strategy at v2, watchlist still named "Phase 5 Core".
- Client bundle check: provider secrets are read only inside Convex actions
  (`readEnv()`), never in `src/`; the Data Sources page lists missing variable
  names and never their values.

## 7. Known limitations and unresolved risks

1. **No provider credentials are configured.** Every price, fill and backtest in
   this environment is `SAMPLE`. Provider adapters are covered by deterministic
   mock/contract tests (`tests/providerAdapters.test.ts`, `tests/providers.test.ts`)
   only — no genuine FYERS, Breeze or Tapetide request has ever been observed.
   Treat all provider integration as **UNVERIFIED**.
2. **No Convex in-process test harness.** Tests exercise the pure modules the
   backend calls (`convex/market/*`, `convex/paperCore/*`, `convex/backtestCore/*`,
   `convex/alertsCore.ts`). Mutation-level behaviour — the `applyEvaluation`
   re-authorisation, `placeOrder` idempotency index, atomic reservation
   arithmetic — is verified by code review plus the browser sessions in §5, not
   by `convex-test`. Adding that harness is the single highest-value follow-up.
3. **Alerts are manual.** `alerts.evaluate` runs only when the user presses
   "Check now". There is no cron, no email and no push delivery, and the UI says
   so. A `CACHED`/`HISTORICAL` price can never fire an alert.
4. **Screener technical filters need stored candle history.** Sample candles are
   not persisted, so RSI/price-vs-SMA filters skip instruments until a dataset is
   imported (CSV) or cached from a provider. Non-technical screens now work on
   labelled sample prices.
5. **Screener fundamentals filters** (P/E, market cap) need a stored fundamentals
   snapshot, which requires the Tapetide token.
6. **Backtest execution policy differences** are documented in
   `docs/provider-and-simulation-notes.md`: backtests fill at the next candle's
   open with modelled costs; paper orders fill at the current eligible quote with
   no costs. They are intentionally not equivalent.
7. **Alert delivery and scheduling** are not implemented and must not be
   described as implemented.
8. **Account B cleanup is not automated.** `phase6.userb@example.test` and
   `phase7.userb@example.test` remain in the dev deployment, along with the
   records created while testing. They are isolated test accounts on a local
   development deployment; deleting users is not exposed by the app.

## 8. Development data left in place (dev deployment only)

No records were deleted. Created or changed during this phase, all owned by the
demo user (A): one extra BHARTIARTL market buy and one cancelled limit order, one
extra backtest run, strategy `New MA crossover` advanced to v2 with a 2%
stop-loss, one saved screen "Phase 7 gainers", the BHARTIARTL alert re-armed to
ACTIVE at ₹2,100, and HDFCBANK added to "Phase 5 Core". Account B owns nothing
but its profile. If a clean demo is wanted, remove these from the owning account
while signed in as that account — no server-side cleanup script exists.

## 9. Configuring a provider securely (when credentials become available)

Credentials live only in the Convex deployment environment; they are never put in
`.env.local`, the client bundle, Git, or this document.

```bash
# FYERS (server app token; access token expires daily ~06:30 IST)
npx convex env set FYERS_APP_ID <your-app-id>
npx convex env set FYERS_SECRET_ID <your-secret-id>
npx convex env set FYERS_ACCESS_TOKEN <daily-access-token>

# ICICI Direct Breeze (per-user session token from an interactive login)
npx convex env set BREEZE_APP_KEY <your-app-key>
npx convex env set BREEZE_SECRET_KEY <your-secret-key>
npx convex env set BREEZE_SESSION_TOKEN <session-token>

# Tapetide (fundamentals, single personal token)
npx convex env set TAPETIDE_API_TOKEN <your-token>
```

Then: open **Data Sources** and press "Test connection" (it reports latency and
a redacted error), refresh quotes on **Markets**, and confirm the badges change
from `SAMPLE` to `DELAYED`/`LIVE`/`HISTORICAL`. Provider data licensing and
redistribution constraints are summarised in `docs/market-data-setup.md` and on
the Data Sources page. Do not paste secrets into chat.

## 10. Release checklist

| # | Item | Status |
| --- | --- | --- |
| 1 | Convex codegen + dev deployment updated | **PASS** |
| 2 | TypeScript clean (`tsc --noEmit`) | **PASS** |
| 3 | Automated suite (313 tests / 22 files) | **PASS** |
| 4 | Production build (`vite build`) | **PASS** |
| 5 | Auth: signup, sign-in, session restore, sign-out | **PASS** (browser, local dev deployment) |
| 6 | Per-user isolation for alerts, watchlists, paper records, strategies, runs, preferences | **PASS** (two real sessions, direct HTTP API attempts) |
| 7 | Signed-out gating and empty responses | **PASS** |
| 8 | Paper trading: fills, limits, cancel, reservations, reconciliation | **PASS** (browser + pure tests) |
| 9 | Backtest reproducibility and immutable saved runs | **PASS** |
| 10 | SAMPLE labelling everywhere; no SAMPLE shown as real history | **PASS** |
| 11 | Desktop (1440 px) and mobile (390 px) workflows | **PASS** |
| 12 | Real provider quotes/candles | **UNVERIFIED** (no credentials) |
| 13 | Scheduled/background alert evaluation and delivery | **FAIL / not implemented** (documented, UI states it) |
| 14 | Hosted or production deployment | **FAIL / not attempted** (no authorization) |
| 15 | Convex mutation-level automated harness | **UNVERIFIED** (not built) |
| 16 | Screener technical/fundamental filters without stored data | **UNVERIFIED** (requires import or provider) |

**Readiness conclusion:** the application is ready for a **controlled demo on the
local development deployment** with all prices labelled `SAMPLE`, and its
limitations are stated in the UI. It is **not** production-ready: no genuine
provider response has been observed, alert delivery does not exist, and no
production deployment or hosting has been validated.

## 11. Files changed in this phase

Added:

- `convex/market/fallback.ts` — sample fallback, warning/note text, screener
  sample quote.
- `convex/alertsCore.ts` — pure alert evaluation rules.
- `tests/candleFallback.test.ts`, `tests/alertIntegrity.test.ts`,
  `tests/phase7Integrity.test.ts` — 36 new tests.
- `docs/RELEASE_READINESS.md` — this document.

Changed:

- `convex/marketData.ts` — candle fallback now routed through the fallback module.
- `convex/alerts.ts` — uses `planAlertEvaluation`; summary carries `skippedStale`.
- `convex/screener.ts` — sample-priced fallback for quote-less instruments plus
  `samplePriced` count.
- `src/lib/marketClient.ts` — `ScreenerResult.samplePriced`.
- `src/pages/Alerts.tsx` — notice line for stale-only alerts.
- `src/pages/Screener.tsx` — sample-pricing notice, corrected preset hints and
  zero-match message.
- `docs/provider-and-simulation-notes.md` — documents that stale quotes never
  fire an alert.
- `convex/_generated/api.d.ts` (regenerated by `npx convex codegen`).

Unchanged: authentication, ownership checks, the paper engine and ledger, the
backtest engine, the Convex schema, and all existing tests.
