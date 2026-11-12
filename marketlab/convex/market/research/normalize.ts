/**
 * Pure normalization for company-research payloads.
 *
 * Everything here is defensive: provider field names are matched against small
 * alias lists, missing values stay `null`, and derived metrics are only produced
 * when every input they need is present. Nothing is guessed or filled in.
 *
 * Shape coverage is documented but NOT live-verified: this deployment has no
 * `TAPETIDE_API_TOKEN`, so no real research payload has been observed. The
 * aliases below follow the provider's documented field names plus the common
 * snake_case variants; `docs/STOCK_RESEARCH_INTEGRATION.md` lists this as the
 * first thing to confirm once a token exists.
 */

export type ResearchSource = "tapetide" | "gnews";

export interface ResearchProvenance {
  source: ResearchSource;
  /** Provider generation timestamp for the payload, when it reports one. */
  asOf: string | null;
  /** When MarketLab stored this payload. */
  fetchedAt: number;
  /** Reporting/publication timestamp of the underlying facts, when reported. */
  reportDate: string | null;
}

export interface CompanyProfile {
  symbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  website: string | null;
  exchange: string | null;
  isin: string | null;
  employees: number | null;
  peers: string[];
  provenance: ResearchProvenance;
}

export interface FinancialPeriod {
  /** Human label exactly as reported, e.g. "FY2024" or "Q2 FY25". */
  label: string;
  /** Period end date (ISO `YYYY-MM-DD` when parseable). */
  periodEnd: string | null;
  /** Date the figures became public, when the provider reports it. */
  reportDate: string | null;
  revenue: number | null;
  expenses: number | null;
  operatingProfit: number | null;
  operatingMarginPct: number | null;
  netProfit: number | null;
  eps: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  equity: number | null;
  debt: number | null;
  cash: number | null;
  operatingCashFlow: number | null;
  investingCashFlow: number | null;
  financingCashFlow: number | null;
  freeCashFlow: number | null;
  revenueGrowthPct: number | null;
  profitGrowthPct: number | null;
}

export interface FinancialStatements {
  annual: FinancialPeriod[];
  quarterly: FinancialPeriod[];
  /** `true` consolidated, `false` standalone, `null` when not stated. */
  consolidated: boolean | null;
  currency: string;
  unit: string | null;
  provenance: ResearchProvenance;
}

export interface ShareholdingPeriod {
  label: string;
  asOf: string | null;
  promoterPct: number | null;
  fiiPct: number | null;
  diiPct: number | null;
  publicPct: number | null;
  governmentPct: number | null;
  /** Categories were returned but did not sum to ~100%. */
  partial: boolean;
  provenance: ResearchProvenance;
}

/** Provider-reported ratios, mirrored by `src/lib/researchClient.ts`. */
export interface ResearchRatios {
  marketCap: number | null;
  peTtm: number | null;
  pb: number | null;
  eps: number | null;
  bookValuePerShare: number | null;
  dividendYieldPct: number | null;
  roePct: number | null;
  rocePct: number | null;
  debtToEquity: number | null;
  operatingMarginPct: number | null;
  netMarginPct: number | null;
  sharesOutstanding: number | null;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string | null;
  url: string | null;
  publisher: string | null;
  publishedAt: number | null;
  symbols: string[];
  category: string | null;
  sentiment: string | null;
}

export interface NewsFeed {
  items: NewsItem[];
  provenance: ResearchProvenance;
  /** Articles dropped because they did not mention this company. */
  filteredIrrelevant: number;
  duplicatesRemoved: number;
}

export interface CorporateEvent {
  id: string;
  type: string;
  title: string;
  date: number | null;
  period: string | null;
  url: string | null;
  source: string;
  /** Official filing vs press coverage — never mixed in the UI. */
  official: boolean;
}

/* ------------------------------------------------------------------ */
/* Primitive readers                                                   */
/* ------------------------------------------------------------------ */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,%\s₹]/g, "").replace(/[()]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function pickNumber(record: Record<string, unknown> | null, keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = toNumber(record[key]);
    if (value !== null) return value;
  }
  return null;
}

export function pickString(record: Record<string, unknown> | null, keys: string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toIsoDate(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function normalizeProfile(
  payload: unknown,
  fallback: { symbol: string },
  provenance: ResearchProvenance
): CompanyProfile | null {
  const record = asRecord(payload);
  if (!record) return null;
  // Some envelopes nest the company under `stock` / `profile` / `company`.
  const inner =
    asRecord(record.stock) ?? asRecord(record.profile) ?? asRecord(record.company) ?? record;

  const peers = [
    ...asArray(record.peers),
    ...asArray(inner.peers),
    ...asArray(record.competitors),
  ]
    .map((peer) => {
      const peerRecord = asRecord(peer);
      return typeof peer === "string"
        ? peer.trim().toUpperCase()
        : (pickString(peerRecord, ["symbol", "ticker", "nse_symbol"]) ?? "").toUpperCase();
    })
    .filter((symbol) => Boolean(symbol) && symbol !== fallback.symbol.toUpperCase());

  const name = pickString(inner, ["name", "company_name", "companyName", "long_name"]);
  const description = pickString(inner, [
    "description",
    "business_description",
    "businessSummary",
    "about",
    "company_profile",
  ]);
  if (!name && !description) return null;

  return {
    symbol: fallback.symbol,
    name,
    sector: pickString(inner, ["sector", "sector_name"]),
    industry: pickString(inner, ["industry", "industry_name", "sub_industry"]),
    description,
    website: pickString(inner, ["website", "url", "homepage"]),
    exchange: pickString(inner, ["exchange", "listing_exchange"]),
    isin: pickString(inner, ["isin", "isin_code"]),
    employees: pickNumber(inner, ["employees", "employee_count", "no_of_employees"]),
    peers: [...new Set(peers)].slice(0, 8),
    provenance,
  };
}

/* ------------------------------------------------------------------ */
/* Financial statements                                                */
/* ------------------------------------------------------------------ */

const PERIOD_KEYS = ["period", "label", "fiscal_period", "quarter", "year", "fy", "period_label"];
const PERIOD_END_KEYS = ["period_end", "periodEnd", "end_date", "date", "to_date", "fiscal_year_end"];
const REPORT_DATE_KEYS = ["report_date", "reported_at", "announcement_date", "filing_date"];

const REVENUE_KEYS = ["revenue", "total_revenue", "net_revenue", "sales", "totalIncome", "income"];
const EXPENSE_KEYS = ["expenses", "total_expenses", "totalExpenses", "operating_expenses"];
const OPERATING_PROFIT_KEYS = ["operating_profit", "operatingProfit", "ebitda", "ebit", "operating_income"];
const NET_PROFIT_KEYS = ["net_profit", "netProfit", "pat", "profit_after_tax", "net_income"];
const EPS_KEYS = ["eps", "eps_ttm", "earnings_per_share", "basic_eps", "diluted_eps"];
const ASSET_KEYS = ["total_assets", "totalAssets", "assets"];
const LIABILITY_KEYS = ["total_liabilities", "totalLiabilities", "liabilities"];
const EQUITY_KEYS = ["equity", "shareholders_equity", "total_equity", "net_worth", "shareholder_equity"];
const DEBT_KEYS = ["debt", "total_debt", "borrowings", "total_borrowings"];
const CASH_KEYS = ["cash", "cash_and_equivalents", "cash_equivalents", "cash_and_cash_equivalents"];
const CFO_KEYS = ["operating_cash_flow", "cfo", "net_cash_from_operating"];
const CFI_KEYS = ["investing_cash_flow", "cfi", "net_cash_from_investing"];
const CFF_KEYS = ["financing_cash_flow", "cff", "net_cash_from_financing"];
const CAPEX_KEYS = ["capex", "capital_expenditure"];

/** Flattens one statement section into period rows, whatever its envelope. */
function sectionRows(section: unknown): Record<string, unknown>[] {
  const record = asRecord(section);
  if (!record) return asArray(section).map(asRecord).filter((row): row is Record<string, unknown> => row !== null);

  for (const key of ["periods", "data", "rows", "annual", "quarterly", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
    }
  }
  return [];
}

function periodLabel(row: Record<string, unknown>, index: number): string {
  return pickString(row, PERIOD_KEYS) ?? `Period ${index + 1}`;
}

/**
 * Builds one merged row per reported period across the P&L, balance sheet and
 * cash-flow sections. Missing sections simply leave their fields null.
 */
function mergePeriods(
  sources: Record<string, unknown>[],
  reporting: "annual" | "quarterly",
  provenance: ResearchProvenance
): FinancialPeriod[] {
  const byLabel = new Map<string, Record<string, unknown>>();

  for (const source of sources) {
    const section =
      asRecord(source[reporting]) ??
      asRecord(source.statements) ??
      asRecord(source.financials) ??
      source;
    const containers = [
      section,
      asRecord(source.income) ?? asRecord(source.income_statement) ?? asRecord(source.profit_and_loss),
      asRecord(source.balance_sheet) ?? asRecord(source.balance),
      asRecord(source.cash_flow) ?? asRecord(source.cashflow),
    ].filter((value): value is Record<string, unknown> => value !== null);

    for (const container of containers) {
      for (const direct of ["periods", "data", "rows"]) {
        const rows = sectionRows(container[direct] ?? container);
        rows.forEach((row, index) => {
          const label = periodLabel(row, index);
          byLabel.set(label, { ...(byLabel.get(label) ?? {}), ...row });
        });
      }
    }
  }

  const rows = [...byLabel.entries()]
    .map(([label, row], index): FinancialPeriod => {
      const revenue = pickNumber(row, REVENUE_KEYS);
      const operatingProfit = pickNumber(row, OPERATING_PROFIT_KEYS);
      const operatingCashFlow = pickNumber(row, CFO_KEYS);
      const capex = pickNumber(row, CAPEX_KEYS);
      const eps = pickNumber(row, EPS_KEYS);
      const periodEnd = toIsoDate(row[PERIOD_END_KEYS[0]]) ?? pickStringDate(row, PERIOD_END_KEYS);
      return {
        label: label || `Period ${index + 1}`,
        periodEnd,
        reportDate: pickStringDate(row, REPORT_DATE_KEYS),
        revenue,
        expenses: pickNumber(row, EXPENSE_KEYS),
        operatingProfit,
        operatingMarginPct:
          operatingProfit !== null && revenue !== null && revenue !== 0
            ? round2((operatingProfit / revenue) * 100)
            : null,
        netProfit: pickNumber(row, NET_PROFIT_KEYS),
        eps,
        totalAssets: pickNumber(row, ASSET_KEYS),
        totalLiabilities: pickNumber(row, LIABILITY_KEYS),
        equity: pickNumber(row, EQUITY_KEYS),
        debt: pickNumber(row, DEBT_KEYS),
        cash: pickNumber(row, CASH_KEYS),
        operatingCashFlow,
        investingCashFlow: pickNumber(row, CFI_KEYS),
        financingCashFlow: pickNumber(row, CFF_KEYS),
        freeCashFlow:
          operatingCashFlow !== null && capex !== null
            ? operatingCashFlow - Math.abs(capex)
            : null,
        revenueGrowthPct: null,
        profitGrowthPct: null,
      };
    })
    .filter((row) => row.periodEnd !== null || row.revenue !== null || row.netProfit !== null)
    .sort((a, b) => (a.periodEnd ?? "").localeCompare(b.periodEnd ?? ""));

  // Growth is computed only between two consecutive reported periods.
  for (let i = 0; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    if (!previous) continue;
    const current = rows[i];
    if (current.revenue !== null && previous.revenue !== null && previous.revenue !== 0) {
      current.revenueGrowthPct = round2(
        ((current.revenue - previous.revenue) / Math.abs(previous.revenue)) * 100
      );
    }
    if (current.netProfit !== null && previous.netProfit !== null && previous.netProfit !== 0) {
      current.profitGrowthPct = round2(
        ((current.netProfit - previous.netProfit) / Math.abs(previous.netProfit)) * 100
      );
    }
  }

  void provenance;
  return rows;
}

function pickStringDate(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const iso = toIsoDate(record[key]);
    if (iso) return iso;
  }
  return null;
}

export function normalizeFinancials(
  payload: unknown,
  provenance: ResearchProvenance
): FinancialStatements | null {
  const record = asRecord(payload);
  if (!record) return null;
  const inner = asRecord(record.financials) ?? asRecord(record.stock) ?? record;

  const consolidatedRaw =
    inner.consolidated ?? inner.is_consolidated ?? record.consolidated ?? record.is_consolidated;
  const consolidated =
    typeof consolidatedRaw === "boolean"
      ? consolidatedRaw
      : typeof consolidatedRaw === "string"
        ? /consolidated/i.test(consolidatedRaw)
        : null;

  const annual = mergePeriods([inner], "annual", provenance);
  const quarterly = mergePeriods([inner], "quarterly", provenance);
  if (annual.length === 0 && quarterly.length === 0) return null;

  return {
    annual,
    quarterly,
    consolidated,
    currency: pickString(inner, ["currency", "reporting_currency"]) ?? "INR",
    unit: pickString(inner, ["unit", "scale"]),
    provenance,
  };
}

/* ------------------------------------------------------------------ */
/* Shareholding                                                        */
/* ------------------------------------------------------------------ */

const PROMOTER_KEYS = ["promoter", "promoters", "promoter_pct", "promoters_pct", "promoterHolding"];
const FII_KEYS = ["fii", "fii_pct", "foreign_institutional", "foreign_institutional_pct", "fpi"];
const DII_KEYS = ["dii", "dii_pct", "domestic_institutional", "domestic_institutional_pct"];
const PUBLIC_KEYS = ["public", "public_pct", "retail", "public_shareholding"];
const GOV_KEYS = ["government", "government_pct", "govt_pct"];

export function normalizeShareholding(
  payload: unknown,
  provenance: ResearchProvenance
): ShareholdingPeriod[] {
  const record = asRecord(payload);
  if (!record) return [];
  const raw =
    asArray(record.periods).length > 0
      ? asArray(record.periods)
      : asArray(record.data).length > 0
        ? asArray(record.data)
        : asArray(record.shareholding).length > 0
          ? asArray(record.shareholding)
          : [record];

  return raw
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row, index) => {
      const promoterPct = pickNumber(row, PROMOTER_KEYS);
      const fiiPct = pickNumber(row, FII_KEYS);
      const diiPct = pickNumber(row, DII_KEYS);
      const publicPct = pickNumber(row, PUBLIC_KEYS);
      const governmentPct = pickNumber(row, GOV_KEYS);
      const present = [promoterPct, fiiPct, diiPct, publicPct, governmentPct].filter(
        (value): value is number => value !== null
      );
      const total = present.reduce((sum, value) => sum + value, 0);
      return {
        label:
          pickString(row, ["period", "quarter", "label", "as_of"]) ?? `Report ${index + 1}`,
        asOf: pickStringDate(row, ["as_of", "date", "period_end", "quarter_end"]),
        promoterPct,
        fiiPct,
        diiPct,
        publicPct,
        governmentPct,
        // Only claim completeness when the reported categories actually add up.
        partial: present.length > 1 && Math.abs(total - 100) > 1.5,
        provenance,
      };
    })
    .filter((row) => row.asOf !== null || row.promoterPct !== null);
}

/* ------------------------------------------------------------------ */
/* News                                                                */
/* ------------------------------------------------------------------ */

const HEADLINE_KEYS = ["headline", "title", "news_title", "heading"];
const SUMMARY_KEYS = ["summary", "description", "excerpt", "content_snippet"];
const PUBLISHER_KEYS = ["publisher", "source", "source_name", "provider"];
const PUBLISHED_KEYS = ["published_at", "publishedAt", "published", "date", "datetime", "pubDate"];
const URL_KEYS = ["url", "link", "article_url", "source_url"];
const CATEGORY_KEYS = ["category", "news_category", "type"];
const SENTIMENT_KEYS = ["sentiment", "sentiment_label"];

function isSafeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Keeps only articles that actually belong to this company.
 *
 * Matching is deliberately conservative: an article must name the company in its
 * related-symbol metadata, or contain the full company name / a distinctive
 * symbol in the headline. Short symbols (2–3 characters, e.g. `LT`, `ITC`) are
 * never matched on their own — "ITC" appears inside unrelated words.
 */
export function isRelevantArticle(
  item: { symbols: string[]; headline: string; summary: string | null },
  match: { symbol: string; name: string | null }
): boolean {
  const symbol = match.symbol.trim().toUpperCase();
  if (item.symbols.some((value) => value.trim().toUpperCase() === symbol)) return true;

  const text = `${item.headline} ${item.summary ?? ""}`.toLowerCase();
  const companyName = (match.name ?? "").trim().toLowerCase();
  if (companyName.length >= 5 && text.includes(companyName)) return true;

  // Symbol-as-word only for longer tickers, matched on word boundaries.
  if (symbol.length >= 4) {
    const pattern = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) return true;
  }
  return false;
}

export function normalizeNews(
  payload: unknown,
  match: { symbol: string; name: string | null },
  provenance: ResearchProvenance
): NewsFeed {
  const record = asRecord(payload);
  const raw =
    asArray(record?.news).length > 0
      ? asArray(record?.news)
      : asArray(record?.articles).length > 0
        ? asArray(record?.articles)
        : asArray(record?.data).length > 0
          ? asArray(record?.data)
          : asArray(payload);

  const seen = new Set<string>();
  let filteredIrrelevant = 0;
  let duplicatesRemoved = 0;
  const items: NewsItem[] = [];

  for (const entry of raw) {
    const row = asRecord(entry);
    if (!row) continue;
    const headline = pickString(row, HEADLINE_KEYS);
    if (!headline) continue;

    const related = [
      ...asArray(row.symbols),
      ...asArray(row.related_symbols),
      ...asArray(row.relatedSymbols),
      ...asArray(row.tickers),
    ]
      .map((value) => (typeof value === "string" ? value : pickString(asRecord(value), ["symbol"])))
      .filter((value): value is string => Boolean(value));

    const item: NewsItem = {
      id:
        pickString(row, ["id", "news_id", "_id"]) ??
        `${headline.toLowerCase()}|${pickString(row, URL_KEYS) ?? ""}`,
      headline,
      summary: pickString(row, SUMMARY_KEYS),
      url: isSafeHttpUrl(pickString(row, URL_KEYS)),
      publisher: pickString(row, PUBLISHER_KEYS),
      publishedAt: toTimestamp(
        PUBLISHED_KEYS.map((key) => row[key]).find((value) => toTimestamp(value) !== null)
      ),
      symbols: related,
      category: pickString(row, CATEGORY_KEYS),
      sentiment: pickString(row, SENTIMENT_KEYS),
    };

    if (!isRelevantArticle(item, match)) {
      filteredIrrelevant += 1;
      continue;
    }
    const dedupeKey = (item.url ?? item.headline).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(dedupeKey)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(dedupeKey);
    items.push(item);
  }

  items.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));

  return { items, provenance, filteredIrrelevant, duplicatesRemoved };
}

/* ------------------------------------------------------------------ */
/* Corporate events                                                    */
/* ------------------------------------------------------------------ */

export function normalizeEvents(
  payload: unknown,
  fallbackSource: string,
  provenance: ResearchProvenance
): CorporateEvent[] {
  const record = asRecord(payload);
  const raw =
    asArray(record?.events).length > 0
      ? asArray(record?.events)
      : asArray(record?.filings).length > 0
        ? asArray(record?.filings)
        : asArray(record?.announcements).length > 0
          ? asArray(record?.announcements)
          : asArray(record?.data);

  return raw
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row, index) => {
      const title =
        pickString(row, ["title", "subject", "headline", "description"]) ?? "Company filing";
      const type = pickString(row, ["type", "category", "event_type"]) ?? "Filing";
      const dateValue = ["date", "filed_at", "announcement_date", "published_at", "broadcast_date"]
        .map((key) => row[key])
        .find((value) => toTimestamp(value) !== null);
      return {
        id: pickString(row, ["id", "filing_id"]) ?? `${type}-${index}`,
        type,
        title,
        date: dateValue === undefined ? null : toTimestamp(dateValue),
        period: pickString(row, ["period", "financial_period", "quarter"]),
        url: isSafeHttpUrl(pickString(row, URL_KEYS)),
        source: pickString(row, ["source"]) ?? fallbackSource,
        official: row.official !== false,
      };
    })
    .filter((event) => event.title !== "Company filing")
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

/* ------------------------------------------------------------------ */
/* Derived price statistics (candles only)                             */
/* ------------------------------------------------------------------ */

export interface PriceStatistics {
  high52w: number | null;
  low52w: number | null;
  /** Days actually covered by the series that produced the 52-week values. */
  coverageDays: number | null;
  /** True only when the series really spans ~52 weeks. */
  fullYear: boolean;
  averageVolume: number | null;
  averageVolumeWindows: number | null;
}

/**
 * Computes 52-week extremes and average volume from stored candles.
 *
 * The label must be honest: if the series covers only 3 months, `fullYear` is
 * false and the UI says "3-month range", not "52-week".
 */
export function priceStatistics(
  candles: { ts: number; high: number; low: number; volume: number | null }[],
  nowMs: number
): PriceStatistics {
  const usable = candles.filter(
    (candle) =>
      Number.isFinite(candle.ts) && Number.isFinite(candle.high) && Number.isFinite(candle.low)
  );
  if (usable.length === 0) {
    return {
      high52w: null,
      low52w: null,
      coverageDays: null,
      fullYear: false,
      averageVolume: null,
      averageVolumeWindows: null,
    };
  }

  const yearAgo = nowMs - 365 * 24 * 60 * 60 * 1000;
  const windowRows = usable.filter((candle) => candle.ts >= yearAgo);
  const rows = windowRows.length > 0 ? windowRows : usable;
  const coverageDays = Math.round((usable[usable.length - 1].ts - usable[0].ts) / 86_400_000);
  const volumes = rows.map((candle) => candle.volume).filter((value): value is number => value !== null);

  return {
    high52w: rows.reduce((max, candle) => Math.max(max, candle.high), rows[0].high),
    low52w: rows.reduce((min, candle) => Math.min(min, candle.low), rows[0].low),
    coverageDays,
    fullYear: coverageDays >= 350,
    averageVolume:
      volumes.length >= 5 ? Math.round(volumes.reduce((sum, v) => sum + v, 0) / volumes.length) : null,
    averageVolumeWindows: volumes.length >= 5 ? volumes.length : null,
  };
}

/**
 * A negative-earnings company has no meaningful trailing P/E: the ratio would be
 * displayed as a negative number that reads as "cheap". Return null instead.
 */
export function safePeRatio(price: number | null, eps: number | null): number | null {
  if (price === null || eps === null || eps <= 0) return null;
  return round2(price / eps);
}

/** Market cap requires a price AND a share count; never infer either. */
export function derivedMarketCap(
  price: number | null,
  sharesOutstanding: number | null
): number | null {
  if (price === null || sharesOutstanding === null || sharesOutstanding <= 0) return null;
  return price * sharesOutstanding;
}
