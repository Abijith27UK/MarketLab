# Paper trading (Phase 3)

Simulated order entry and portfolio accounting. **No order reaches a broker.** All state
lives in Convex under the authenticated user, and every balance can be rebuilt from the
`paperLedger` table.

The decision logic is pure TypeScript in `convex/paperCore/` (`config.ts`, `engine.ts`), so
the unit tests exercise exactly the code the mutation runs. `convex/paper.ts` is a thin
adapter: load rows → `evaluateOrder` → persist the result in one transaction.

## Order policy

| Rule | Behaviour |
| --- | --- |
| Market buy | Fills at the ask, or the last price if the source has no book |
| Market sell | Fills at the bid, or the last price if the source has no book |
| Limit buy | Fills immediately at that reference price only when reference ≤ limit; otherwise rests as `OPEN` |
| Limit sell | Fills immediately at that reference price only when reference ≥ limit; otherwise rests as `OPEN` |
| Not modelled | Slippage, brokerage, STT, stamp duty, GST, DP charges |
| Rejected outright | Stop-loss orders, indices, derivatives, fractional shares, short selling, margin |

A resting limit is **never** filled by a background job. The simulation has no continuous
feed, so assuming an unobserved tick crossed the limit would be fabricated. `recheckOrder`
re-evaluates it on explicit user action; `cancelOrder` releases its reservation.

## Price eligibility and labels

1. A stored, non-sample `marketQuotes` row is used when present.
2. Its label is downgraded when stale: older than 5 minutes → `CACHED`, and a `LIVE` row whose
   provider tick is older than 5 minutes also becomes `CACHED`. A `HISTORICAL` series is never
   tradable.
3. With no provider quote, the deterministic sample series is used only while
   `SAMPLE_FILLS_ENABLED` is true (`convex/paperCore/config.ts`) and the fill is stored with
   mode `SAMPLE`. Set it to `false` to require a provider price for every fill.
4. Each order stores `fillMode`, `fillSource` and `fillQuoteTime`; each ledger entry stores the
   same label. Nothing is called `LIVE` because a request succeeded.

Portfolio valuation uses the same resolver. The account's overall mode is the weakest label
present, so a portfolio holding any sample-priced instrument is labelled `SAMPLE`.

## Accounting

- Rupees round to 2 decimals (`roundMoney`); per-share ratios keep 4 (`roundRatio`);
  quantities are whole shares.
- Cash, positions and P&L are written only by `paper.placeOrder` / `paper.recheckOrder`.
  No mutation accepts a balance.
- **Buys:** cash −= quantity × price; position quantity += quantity; cost basis += the same
  amount. Average cost is `costBasis / quantity`.
- **Partial sells (weighted average):** the removed cost is
  `quantity × (costBasis / quantityHeld)`; the remaining cost basis keeps the same average.
  Realised P&L = proceeds − removed cost. Selling the entire holding removes the position
  row and leaves the ledger entry behind.
- `availableCash` is the account balance. Open **buy** limits reserve `quantity × limit`;
  `spendableCash = availableCash − reservedCash`. Open **sell** limits reserve their shares,
  so the same shares cannot back two orders.
- Equity = cash + market value; total P&L = realised + unrealised.

Replaying `paperLedger` (`replayLedger` in the engine, or the Portfolio table) reproduces
`availableCash` and `realizedPnl` exactly.

## States and idempotency

`(new) → FILLED | OPEN | REJECTED`, `OPEN → FILLED | CANCELLED`.
`FILLED`, `CANCELLED`, `REJECTED` are terminal. Only `FILLED` moves cash or positions;
cancelled and rejected orders stay in the history with their reason.

Each order carries a client-generated `clientOrderId`, unique per account. A retry with the
same reference returns the existing order and writes no second ledger entry. Convex mutations
are transactional, so two concurrent orders that would overspend are serialised: the second is
re-evaluated against the updated balance and rejected.

## Security

- Owner comes from `getAuthUserId`; instrument ids are validated against the catalogue.
- Reading another user's order id returns `Order not found` (no existence leak).
- Signed-out calls return `null` / empty lists for queries and `Not authenticated` for mutations.
- Starting capital can be set only before the first order; afterwards it is locked so past
  performance cannot be rewritten.
- Provider credentials stay in the Convex deployment; the browser receives only env var
  *names* for setup instructions.

## Data presented to the user

All values are virtual. The trading and portfolio views carry a paper-trading notice, and each
position, fill and ledger row shows its data-mode badge. Sample prices are never presented as
provider prices, and simulated returns are never presented as real brokerage performance.
