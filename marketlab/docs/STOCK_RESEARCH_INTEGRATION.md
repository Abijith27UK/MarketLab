# Stock research integration

Company research for the instrument detail page: profile, reported financials,
shareholding, company news and official filings. This document describes what is
implemented, what is verified, and what remains unverified because this
deployment has no research token.

## 1. Architecture

```
InstrumentDetail (React)
  ├── quote header + metric grid        ← useQuotes (TejHQ / NSE MCP)
  ├── Overview / Financials / ... tabs  ← research.getResearch (Convex action)
  └── Charts tab                        ← marketData.getCandles (unchanged)
```

Backend modules:

| File | Role |
| --- | --- |
| `convex/research.ts` | Public action `getResearch`. Per-section fetching, TTL cache, quota, provenance, partial-failure reporting. |
| `convex/researchStore.ts` | `researchCache` read/write/clear (raw provider JSON + retrieval time). |
| `convex/market/research/tapetide.ts` | Tapetide research calls (`/stocks/{symbol}`, `/financials`, `/shareholding`, `/news`). |
| `convex/market/research/normalize.ts` | Pure, fully tested normalization for profile, statements, shareholding, news, events, price statistics. |
| `convex/market/research/gnews.ts` | Optional GNews adapter, server-side only. |
| `src/lib/researchClient.ts` | Typed browser contract for the action result. |
| `src/components/research/ResearchPanels.tsx` | Metric grid, overview, financial tables, shareholding chart/table, news list, events, peers. |

Provider responsibilities stay separate. Research reads never write the quote
cache, never change `userProfiles.quoteProvider`, and are never used by paper
trading, alerts, portfolio valuation or backtests.

## 2. Provider integrations used

- **Quotes** — TejHQ (default) or NSE MCP, per the user's saved preference. Unchanged.
- **Company research** — Tapetide, only when `TAPETIDE_API_TOKEN` is set.
- **News** — Tapetide `/stocks/{symbol}/news` first; GNews only when the owner
  sets `GNEWS_API_KEY`. No scraping of NSE endpoints.
- **Filings** — no permitted endpoint is configured, so the section reports
  "not available" instead of inventing filings.

## 3. Tapetide endpoints actually called

**Transport: MCP, not REST.** Verified 2026-11-12: the owner's Tapetide token
answers every REST route with HTTP 200, `data: null` and
`notice.code = "api_access_not_in_plan"` (REST requires an Enterprise plan). The
same token authorises `https://mcp.tapetide.com/mcp`, which returns the data, so
research is read through MCP tools (`convex/market/research/tapetideMcp.ts`).

| Purpose | MCP tool | Cached |
| --- | --- | --- |
| Company profile + ratios | `get_company_profile` | 18 h |
| Statements (all five sections) | `get_financials { periods: 8 }` | 18 h |
| Shareholding | `get_shareholding` | 24 h |
| Company news | `get_stock_news` | 20 min |
| Corporate actions / filings | `get_corporate_actions` | 6 h |

Each call opens a short-lived MCP session (initialize → tools/list → tools/call)
and checks the tool exists before invoking it. Responses arrive as
`content[0].text` JSON; Tapetide can append a `[TRUNCATED: …]` note after the
JSON, so the parser keeps the leading document and ignores the note.

Symbol mapping uses `instruments.providerIds.tapetide` when present, otherwise the
catalogue symbol. Only `EQUITY` instruments request company research; indices and
ETFs return a clear "applies to equities" state.

## 4. Optional news API

`GNEWS_API_KEY` enables `convex/market/research/gnews.ts` when Tapetide is not
configured. The query is the quoted full company name (not the bare ticker),
`country=in`, `lang=en`, newest first. The UI states prominently that free-tier
GNews can delay articles by ~12 hours and always shows the publisher's own
publication time.

## 5. Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `TAPETIDE_API_TOKEN` | for any company research | Personal Tapetide token, backend only |
| `GNEWS_API_KEY` | optional | Alternate news source, backend only |
| `NSE_MCP_POC_ENABLED` | optional | Existing NSE MCP quote POC, untouched |

Set with `npx convex env set NAME value`. Values are never sent to the browser,
returned in results, or logged; provider errors pass through `redactError`.

## 6. Metric definitions

- **Market cap** — provider-reported. MarketLab never multiplies a price by an
  assumed share count. Tapetide documents the field in crore-scale units; the UI
  reuses the existing crore/lakh-crore formatter.
- **P/E (TTM)** — provider value when present. If absent, the UI may compute
  `price ÷ TTM EPS` and labels it "calculated". A negative or zero EPS produces
  "Not meaningful", never a negative P/E.
- **P/B, EPS, book value/share, dividend yield, ROE, ROCE, debt/equity** —
  provider-reported only; `null` renders as `—`.
- **Operating margin** — provider ratio, else operating profit ÷ revenue for the
  reported period. **Net margin** — provider ratio, else net profit ÷ revenue.
- **52-week high/low** — computed only from stored daily candles. If coverage is
  under 350 days the label becomes "Range high/low" with the actual coverage.
- **Average volume** — mean of stored sessions, needs at least five.
- **Revenue/profit growth** — computed between consecutive reported periods of
  the same statement type; absent when either period is missing.

## 7. Timestamps and freshness

Four distinct dates are kept and displayed separately:

1. quote/exchange session time (`quote.quoteTime`, provider clock);
2. financial period end (`periodEnd`) and reporting/publication date (`reportDate`);
3. news publication time (publisher time, IST display);
4. retrieval time (`fetchedAt`, cache creation).

`asOf` from a provider envelope is a payload generation time, not a publication
date. Cache TTLs affect only retrieval, never the displayed period dates.

## 8. News relevance and deduplication

Implemented in `normalize.ts` and unit-tested:

- an article is kept only if it carries this symbol in related-symbol metadata,
  contains the full company name (≥ 5 characters), or — for symbols of 4+ chars —
  matches the ticker on a word boundary; short tickers such as `ITC` and `LT` are
  never matched on their own;
- duplicates are collapsed by URL, else headline (case/whitespace-insensitive);
- items sort newest-first by publisher time; items without a date stay `null`
  rather than inheriting retrieval time;
- URLs must parse as `http(s)`; otherwise no link is shown (never invented);
- only headline, provider summary, attribution and link are displayed — no full
  article text.

Filters: category chips are built from categories actually present in the feed;
time windows are 24 h, 7 d, 30 d, all.

## 9. Limits and caching

Tapetide free plan: 50 successful requests per IST day, 60/min. Each research
call consumes one unit via the existing `providerState` quota helper and reports
the remaining retry window instead of silently failing. A stock page load costs
two requests (profile + financials); news/shareholding/events load only when
their tab is opened. `refresh` clears the relevant cache entry.

## 10. Coverage

Unverified. Expected supported: NSE-listed operating companies with Tapetide
coverage. Not supported by design: indices, ETFs, and instruments without
`EQUITY` type get a clear explanation instead of statements.

## 11. Known limitations

- **REST is unavailable on the Free plan.** Any REST path (including the quote
  route used by the Tapetide market provider) returns a plan notice; the adapter
  raises that notice as a clear error instead of "no data". Research works
  because it uses MCP.
- **Live-verified with real ITC data (2026-11-12):** profile, 3 annual + 4
  quarterly statement periods, 23 shareholding periods, 7 news rows and 27
  corporate actions. Units are ₹ crore, consolidated, with filing dates taken
  from `availability[].available_from`.
- **MCP result size limit.** Large tool responses are trimmed by the server
  (e.g. 7 of 15 news rows at 25,000 chars) and carry a trailing note; the parser
  keeps the returned rows rather than failing.
- **Balances only get an equity total when capital and reserves are both
  reported.** Otherwise equity stays `null` rather than being guessed.
- Peer comparison lists provider-mapped peer symbols only. No comparative
  valuation table is rendered because the response does not include peer metrics;
  ranking peers is intentionally not fabricated.
- Official filings are not wired: no permitted, verifiable endpoint is configured.
- GNews free tier delay (~12 h) is surfaced; paid GNews behaviour is untested.
- Shareholding periods whose categories do not sum to ~100% are flagged as
  partial rather than normalised.
- Financial statement unit is printed exactly as reported; when the provider
  states no unit the UI says so instead of assuming crore.

## 12. Tests and verification

`tests/tapetideResearchNormalize.test.ts` (12 tests): real-shape profile and
ratio mapping, missing-field nulls, statement assembly across sections, TTM
dropping, interim balance columns, fiscal labels, shareholding withholding,
news dedupe/truncation/URLs, and corporate-action mapping.

`tests/stockResearch.test.ts` (18 tests, all passing): profile mapping and
missing fields; statement merging, margins, growth, free cash flow, consolidation
unknown; negative/zero/missing EPS P/E safety; market-cap inputs; shareholding
nulls and partial flag; news relevance (short ticker), sorting, duplicate merge,
unsafe URL rejection, missing dates, empty payload; events official/unofficial;
52-week honesty for short vs full-year series.

Repository checks run for this change:

- `npx convex codegen` — pass
- `npx tsc --noEmit` — pass
- `npx vitest run` — see final report
- `npx vite build` — see final report

Verified live on 2026-11-12: Tapetide MCP profile/financials/shareholding/news/
actions for ITC, GNews for `"ITC Limited"`, and the rendered instrument page
(fundamentals grid, Financials tables, News & Events). Not verified: signed-in
-only UI flows (the browser session is signed out).

## 13. Licensing and redistribution

Tapetide and GNews data remain subject to their own terms. MarketLab stores only
what each endpoint returns for caching, shows provider attribution with every
section, links out to original articles, and does not redistribute full article
text. Do not commit tokens or raw provider payload dumps.
