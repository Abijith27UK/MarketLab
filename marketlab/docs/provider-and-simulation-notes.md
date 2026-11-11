# Provider integration, labelling and simulation notes (Phase 6)

This document is the audit record for the market-data adapters, the alerts
evaluation model, and the deliberate differences between backtest fills and
paper-trading fills. It separates what is **implemented and tested** from what is
**live-verified** — as of Phase 6, nothing is live-verified because no provider
credentials are configured in this deployment.

## 1. Provider matrix

| Provider | Quotes | Candles | Intervals | Auth | Documented limits | Live status |
| --- | --- | --- | --- | --- | --- | --- |
| FYERS (`fyers`) | `GET /data/quotes` (50 symbols/call) | `GET /data/history` | 1m, 5m, 15m, 1h, 1d, 1w, 1M | `FYERS_APP_ID`, `FYERS_SECRET_ID`, `FYERS_ACCESS_TOKEN` (app-level token) | ~10 req/s, 50 symbols per quote call, 100-day intraday window, 366-day D/W/M window | **UNVERIFIED** (no credentials) |
| ICICI Breeze (`breeze`) | `GET /quotes` (signed) | `GET /historicalcharts` | 1m, 5m, 1d only | `BREEZE_APP_KEY`, `BREEZE_SECRET_KEY`, `BREEZE_SESSION_TOKEN` (per-user interactive session, ~24 h) | 100 calls/min, 5,000/day, ~1000 candles/request | **UNVERIFIED** (no credentials) |
| Tapetide (`tapetide`) | `GET /quote` | — | — | `TAPETIDE_API_TOKEN` | 60/min, 50/day (free tier) | **UNVERIFIED** (no credentials) |

Shared behaviour, enforced in code and covered by `tests/providerAdapters.test.ts`:

- **Selection is explicit.** `providerFor()` only returns a provider that is
  configured *and* declares the capability and, for candles, the interval.
  Nothing is silently substituted.
- **No cross-provider mixing.** A response carries exactly one `source`; cached
  datasets are keyed by `(instrumentId, interval, source)`.
- **Timeouts.** Every outbound call goes through `fetchWithTimeout`
  (15 s default). An abort becomes `Provider request timed out after N ms`
  rather than a runtime-specific DOMException.
- **No resampling.** Breeze refuses `15m`/`1h` because its history route does not
  serve them; the registry then reports no available provider for that interval.
- **Errors are redacted.** `redactError` strips `key=value` secrets, long opaque
  values after `token`, and query strings, while leaving ordinary sentences
  ("access token has expired") readable.
- **Labels come from the data, not from success.** Quotes are labelled from
  `classifyQuoteMode` (SAMPLE → DELAYED/CACHED/LIVE per freshness), candles from
  `classifyCandleMode` (SAMPLE vs HISTORICAL).
- **Failure never upgrades a label.** A provider exception in `getCandles`
  returns a **SAMPLE** series with an explicit warning naming the provider
  error; it does not keep a HISTORICAL label.

### What would make this LIVE-VERIFIED

1. Set the provider secrets in the Convex deployment (never in chat).
2. Confirm `testProvider` succeeds for that provider.
3. Request one quote and one short candle range; check symbol mapping,
   timestamps (IST → UTC), freshness labels and rate-limit behaviour.
4. Confirm the provider's licence permits the intended storage/redistribution
   before exposing the data to other users.

## 2. Alerts evaluation model

Alerts are **on-demand only**: `alerts.evaluate` (an action) is the single
evaluation path, triggered by the "Check now" button.

Why not scheduled: this deployment has no cron/notification delivery configured,
and evaluation is quote-bound. A Convex cron could be added, but with no provider
credentials it would only ever read SAMPLE prices, which would imply background
monitoring of real prices that does not exist. The UI states this explicitly.

Guarantees:

- Evaluation prices come from `marketData.getQuotes` **server-side**; the browser
  never supplies a price.
- `applyEvaluation` re-reads each alert and re-checks `userId` and
  `status === "ACTIVE"` inside the mutation, so a duplicate or concurrent check
  cannot double-trigger or mutate someone else's row.
- A trigger records `triggerPrice`, `triggeredAt` and `triggerMode`. When the
  mode was SAMPLE the row and the UI say so ("SAMPLE price — not a real market
  move").
- An alert with no usable quote is skipped (`skippedNoPrice`), not triggered.
- Only `LIVE`, `DELAYED` and `SAMPLE` quotes may satisfy a threshold. A `CACHED`
  or `HISTORICAL` price is stored on the row for display with its own label but
  is never allowed to fire, so a frozen quote cannot look like a market move
  (`skippedStale`). The rule lives in `convex/alertsCore.ts` and is unit-tested
  in `tests/alertIntegrity.test.ts`.
- Triggered alerts must be re-armed before they can be edited or evaluated again;
  re-arming clears the trigger record.

Limits: 25 non-triggered alerts per user, thresholds rounded to 2 dp and bounded,
notes ≤ 160 characters, evaluation batches at most 25 alerts.

## 3. Backtest fills vs paper fills

These are intentionally different systems and must not be described as
equivalent.

| Aspect | Backtest (`convex/backtestCore`) | Paper trading (`convex/paper`) |
| --- | --- | --- |
| Price source | Normalised OHLCV candles from the selected dataset (CSV import, provider cache, or SAMPLE) | Latest eligible stored quote, or explicitly enabled SAMPLE quote |
| Fill timing | Signal on candle close, execution on the **next** candle's open | Immediately at the quote price (market), or at the limit when the quote satisfies it |
| Fill price | Next open adjusted by configured slippage | Quote last price (limit: capped by limit price) |
| Costs | Configurable flat + % brokerage and bps slippage, user-defined | No brokerage, taxes or slippage are modelled |
| Position sizing | Fixed quantity or % of equity, capped by max position value | Whole shares limited by available cash and sellable quantity |
| Stop-loss / take-profit | Modelled per candle with a conservative stop-first rule; ambiguous bars flagged | Not implemented (limit and market orders only) |
| State | Immutable run snapshot; nothing is written to the paper account | Ledger-backed account, positions and reservations |
| Labels | `SAMPLE` or `HISTORICAL` with dataset hash and provenance | `fillMode`/`fillSource` per order and ledger entry |
| Gaps | Detected and warned about; results cover existing candles only | Not applicable (single quote) |

Both share the same canonical instrument ids, INR rounding helpers and the same
rule that a SAMPLE price is never presented as live.

## 4. Known limitations

- No provider credentials → all current quotes, fills and alerts in this
  deployment are SAMPLE.
- No streaming: `streaming` is declared unsupported for every provider.
- Paper trading has no background limit-order matching; open orders are
  re-checked by the user or on the next submission.
- Backtests are synchronous and bounded (5,000 candles, 500 stored trades); very
  long intraday ranges must be narrowed or use a coarser interval.
- The exchange holiday calendar is not seeded, so session status ignores holidays
  (the UI says so).
