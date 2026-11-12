/**
 * Normalization for the Tapetide MCP research payloads.
 *
 * Shapes were observed live on 2026-11-12 (ITC):
 *
 *  profile        { data: { company, fundamentals, price_metrics, quote, … } }
 *  financials     { data: [ { section, period_type, data: { row: { period: value } },
 *                            periods, row_order, availability, … } ] }
 *  shareholding   { data: [ { data: { Promoters|FIIs|DIIs|Public|Government|Others:
 *                            { period: pct } }, periods, withheld } ], meta }
 *  news           { data: [ { title, body, sentiment, category, sub_category,
 *                            publish_date, source_url, related_isins } ] }
 *  actions        { data: [ { action_type, ex_date, announcement_date,
 *                            record_date, description } ] }
 *
 * Nothing is inferred: a row the provider does not report stays null, a withheld
 * shareholding bucket stays null (never zero), and no article link is invented.
 */

import {
  normalizeFinancials,
  type CompanyProfile,
  type CorporateEvent,
  type FinancialStatements,
  type NewsFeed,
  type NewsItem,
  type ResearchProvenance,
  type ResearchRatios,
  type ShareholdingPeriod,
} from "./normalize";

type Record_ = Record<string, unknown>;

function record(value: unknown): Record_ | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record_)
    : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/* ------------------------------------------------------------------ */
/* Profile + ratios                                                    */
/* ------------------------------------------------------------------ */

export function normalizeTapetideProfile(
  payload: unknown,
  provenance: ResearchProvenance
): { profile: CompanyProfile; ratios: ResearchRatios } | null {
  const data = record(record(payload)?.data);
  if (!data) return null;
  const company = record(data.company);
  if (!company) return null;
  const fundamentals = record(data.fundamentals);
  const priceMetrics = record(data.price_metrics);

  const name = str(company.name) ?? str(company.display_name);
  if (!name) return null;

  const asOf =
    str(priceMetrics?.as_of) ??
    str(fundamentals?.updated_at) ??
    provenance.asOf;

  return {
    profile: {
      symbol: str(company.nse_symbol) ?? str(company.exchange_symbol) ?? name,
      name,
      sector: str(fundamentals?.sector) ?? str(company.macro_sector),
      industry: str(fundamentals?.industry) ?? str(company.industry),
      description: str(company.about),
      website: null,
      exchange: str(company.exchange),
      isin: str(company.isin),
      employees: num(company.employees),
      peers: [],
      provenance: { ...provenance, asOf, reportDate: null },
    },
    ratios: {
      // Tapetide reports market cap in ₹ crore, matching the UI formatter.
      marketCap: num(fundamentals?.market_cap),
      peTtm: num(fundamentals?.stock_pe) ?? num(priceMetrics?.pe_ttm),
      pb: num(fundamentals?.price_to_book) ?? num(priceMetrics?.pb),
      eps: num(fundamentals?.eps) ?? num(priceMetrics?.eps_ttm),
      bookValuePerShare: num(fundamentals?.book_value) ?? num(priceMetrics?.book_value),
      dividendYieldPct: num(fundamentals?.dividend_yield),
      roePct: num(fundamentals?.roe),
      rocePct: num(fundamentals?.roce),
      debtToEquity: num(fundamentals?.debt_to_equity),
      operatingMarginPct: null,
      netMarginPct: null,
      sharesOutstanding: null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Financial statements                                                */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** "Mar 2026" → 2026-03-31; "TTM" and anything unparseable → null. */
export function tapetidePeriodEnd(label: string): string | null {
  const match = /^([A-Za-z]{3})\s+(\d{4})$/.exec(label.trim());
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  const year = Number(match[2]);
  if (!month || !Number.isFinite(year)) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

const PL_KEYS: Record<string, string> = {
  sales: "revenue",
  expenses: "expenses",
  "operating profit": "operating_profit",
  "net profit": "net_profit",
  "eps in rs": "eps",
};

const BALANCE_KEYS: Record<string, string> = {
  "equity capital": "equity_capital",
  reserves: "reserves",
  borrowings: "debt",
  "total liabilities": "total_liabilities",
  "total assets": "total_assets",
};

const CASH_KEYS: Record<string, string> = {
  "cash from operating activity": "operating_cash_flow",
  "cash from investing activity": "investing_cash_flow",
  "cash from financing activity": "financing_cash_flow",
  "free cash flow": "free_cash_flow",
};

/**
 * Turns one section's row-major table into per-period rows.
 *
 * `availability` carries the real filing/publication date per period; when it is
 * absent the report date stays null rather than borrowing the retrieval time.
 */
function sectionPeriods(
  section: Record_,
  keyMap: Record<string, string>
): Array<{ period: string; values: Record<string, number | string | null> }> {
  const periods = Array.isArray(section.periods)
    ? section.periods.filter((value): value is string => typeof value === "string")
    : [];
  const rows = record(section.data) ?? {};
  const availability = Array.isArray(section.availability) ? section.availability : [];
  const availableByPeriod = new Map<string, string>();
  for (const entry of availability) {
    const row = record(entry);
    const period = str(row?.period);
    const available = str(row?.available_from);
    if (period && available) availableByPeriod.set(period, available.slice(0, 10));
  }

  return periods.map((period) => {
    const values: Record<string, number | string | null> = {};
    for (const [label, byPeriod] of Object.entries(rows)) {
      const key = keyMap[label.trim().toLowerCase()];
      if (!key) continue;
      const series = record(byPeriod);
      if (!series) continue;
      values[key] = num(series[period]);
    }
    const periodEnd = tapetidePeriodEnd(period);
    if (periodEnd) values.period_end = periodEnd;
    values.period = period;
    const reportDate = availableByPeriod.get(period);
    if (reportDate) values.report_date = reportDate;
    return { period, values };
  });
}

export function normalizeTapetideFinancials(
  payload: unknown,
  provenance: ResearchProvenance
): FinancialStatements | null {
  const data = record(payload)?.data;
  if (!Array.isArray(data)) return null;

  const sections = data.map(record).filter((value): value is Record_ => value !== null);
  const annual = new Map<string, Record<string, unknown>>();
  const quarterly = new Map<string, Record<string, unknown>>();
  const annualPlPeriods = new Set<string>();

  const merge = (
    target: Map<string, Record<string, unknown>>,
    rows: Array<{ period: string; values: Record<string, number | string | null> }>
  ) => {
    for (const row of rows) {
      target.set(row.period, { ...(target.get(row.period) ?? {}), ...row.values });
    }
  };

  for (const section of sections) {
    const name = str(section.section) ?? "";
    const periodType = str(section.period_type) ?? "";
    const isQuarterly = name === "quarterly" || periodType === "quarterly";

    if (isQuarterly) {
      merge(quarterly, sectionPeriods(section, PL_KEYS));
    } else if (name === "profit_loss") {
      const plRows = sectionPeriods(section, PL_KEYS);
      // The balance sheet can carry an interim (e.g. half-year) column that is
      // not an annual period. Annual statements are the P&L's annual periods.
      for (const row of plRows) annualPlPeriods.add(row.period);
      merge(annual, plRows);
    } else if (name === "balance_sheet") {
      merge(annual, sectionPeriods(section, BALANCE_KEYS));
    } else if (name === "cash_flow") {
      const cashRows = sectionPeriods(section, CASH_KEYS);
      merge(annual, cashRows);
    }
  }

  if (annual.size === 0 && quarterly.size === 0) return null;

  const dropTtm = (rows: Record<string, unknown>[]) =>
    rows.filter((row) => String(row.period ?? "").trim().toUpperCase() !== "TTM");
  const annualRows = (rows: Record<string, unknown>[]) =>
    dropTtm(rows).filter((row) =>
      annualPlPeriods.size === 0 ? true : annualPlPeriods.has(String(row.period))
    );

  const statements = normalizeFinancials(
    {
      annual: { periods: annualRows([...annual.values()]) },
      quarterly: { periods: dropTtm([...quarterly.values()]) },
      consolidated: true,
      unit: "crore",
    },
    provenance
  );
  if (!statements) return null;

  // Equity is reported as share capital + reserves. Only computed when both exist.
  for (const period of [...statements.annual, ...statements.quarterly]) {
    const raw = annual.get(period.label) ?? quarterly.get(period.label);
    if (!raw) continue;
    const capital = num(raw.equity_capital);
    const reserves = num(raw.reserves);
    if (period.equity === null && capital !== null && reserves !== null) {
      period.equity = capital + reserves;
    }
    if (raw.free_cash_flow !== undefined) {
      const fcf = num(raw.free_cash_flow);
      if (fcf !== null) period.freeCashFlow = fcf;
    }
  }

  return statements;
}

/* ------------------------------------------------------------------ */
/* Shareholding                                                        */
/* ------------------------------------------------------------------ */

const HOLDING_ROWS: Record<string, keyof Pick<
  ShareholdingPeriod,
  "promoterPct" | "fiiPct" | "diiPct" | "publicPct" | "governmentPct"
>> = {
  promoters: "promoterPct",
  fiis: "fiiPct",
  diis: "diiPct",
  public: "publicPct",
  government: "governmentPct",
};

export function normalizeTapetideShareholding(
  payload: unknown,
  provenance: ResearchProvenance
): ShareholdingPeriod[] {
  const data = record(payload)?.data;
  if (!Array.isArray(data) || data.length === 0) return [];
  const section = record(data[0]);
  if (!section) return [];
  const rows = record(section.data) ?? {};
  const periods = Array.isArray(section.periods)
    ? section.periods.filter((value): value is string => typeof value === "string")
    : [];

  const periodsOut = periods
    .map((label) => {
      const entry: ShareholdingPeriod = {
        label,
        asOf: tapetidePeriodEnd(label),
        promoterPct: null,
        fiiPct: null,
        diiPct: null,
        publicPct: null,
        governmentPct: null,
        partial: false,
        provenance,
      };
      for (const [rowLabel, byPeriod] of Object.entries(rows)) {
        const key = HOLDING_ROWS[rowLabel.trim().toLowerCase()];
        if (!key) continue;
        const value = num(record(byPeriod)?.[label]);
        if (value !== null) entry[key] = value;
      }
      const present = [
        entry.promoterPct,
        entry.fiiPct,
        entry.diiPct,
        entry.publicPct,
        entry.governmentPct,
      ].filter((value): value is number => value !== null);
      const total = present.reduce((sum, value) => sum + value, 0);
      entry.partial = present.length > 1 && Math.abs(total - 100) > 1.5;
      return entry;
    })
    .filter((entry) => entry.asOf !== null || entry.promoterPct !== null)
    .sort((a, b) => (b.asOf ?? "").localeCompare(a.asOf ?? ""));

  return periodsOut;
}

/* ------------------------------------------------------------------ */
/* News                                                                */
/* ------------------------------------------------------------------ */

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function publisherFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function sentimentLabel(value: unknown): string | null {
  if (typeof value === "string") return value;
  const recordValue = record(value);
  return (
    str(recordValue?.label) ??
    str(recordValue?.sentiment) ??
    str(recordValue?.polarity) ??
    null
  );
}

export function normalizeTapetideNews(
  payload: unknown,
  provenance: ResearchProvenance,
  options: { summaryLimit?: number } = {}
): NewsFeed {
  const data = record(payload)?.data;
  const rows = Array.isArray(data) ? data : [];
  const seen = new Set<string>();
  const items: NewsItem[] = [];
  let duplicatesRemoved = 0;

  for (const entry of rows) {
    const row = record(entry);
    if (!row) continue;
    const headline = str(row.title);
    if (!headline) continue;
    const url = safeUrl(str(row.source_url));
    const key = (url ?? headline).toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);

    const body = str(row.body);
    const publishedRaw = str(row.publish_date);
    const publishedAt = publishedRaw ? Date.parse(publishedRaw) : NaN;
    items.push({
      id: url ?? `${headline}|${publishedRaw ?? ""}`,
      headline,
      summary: body
        ? body.length > (options.summaryLimit ?? 400)
          ? `${body.slice(0, options.summaryLimit ?? 400).trimEnd()}…`
          : body
        : null,
      url,
      publisher: publisherFromUrl(url) ?? "Tapetide",
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
      symbols: [],
      category: str(row.sub_category) ?? str(row.category),
      sentiment: sentimentLabel(row.sentiment),
    });
  }

  items.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  return { items, provenance, filteredIrrelevant: 0, duplicatesRemoved };
}

/* ------------------------------------------------------------------ */
/* Corporate actions / filings                                         */
/* ------------------------------------------------------------------ */

const ACTION_TITLES: Record<string, string> = {
  result: "Financial results",
  dividend: "Dividend",
  "stock split": "Stock split",
  "bonus issue": "Bonus issue",
  "annual general meeting": "Annual general meeting",
  "board meeting": "Board meeting",
};

export function normalizeTapetideActions(
  payload: unknown,
  provenance: ResearchProvenance
): CorporateEvent[] {
  void provenance;
  const data = record(payload)?.data;
  const rows = Array.isArray(data) ? data : [];

  return rows
    .map((entry, index): CorporateEvent | null => {
      const row = record(entry);
      if (!row) return null;
      const actionType = str(row.action_type) ?? "corporate action";
      const description = str(row.description);
      const dateValue = str(row.announcement_date) ?? str(row.ex_date) ?? str(row.record_date);
      const date = dateValue ? Date.parse(dateValue) : NaN;
      return {
        id: `${actionType}-${dateValue ?? index}-${index}`,
        type: ACTION_TITLES[actionType.toLowerCase()] ?? actionType,
        title: description ?? ACTION_TITLES[actionType.toLowerCase()] ?? actionType,
        date: Number.isFinite(date) ? date : null,
        period: null,
        url: null,
        source: "Tapetide corporate actions",
        // Exchange-sourced corporate actions, not press coverage.
        official: true,
      };
    })
    .filter((event): event is CorporateEvent => event !== null)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}
