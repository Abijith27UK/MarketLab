import { makeFunctionReference } from "convex/server";

/**
 * Typed client contract for company research (profile, financials,
 * shareholding, news, corporate events).
 *
 * These types mirror `convex/market/research/normalize.ts`. They are declared
 * here rather than imported so the browser bundle never pulls in server
 * normalization code.
 */

export type ResearchSection = "profile" | "financials" | "shareholding" | "news" | "events";

export type ResearchSource = "tapetide" | "gnews";

export interface ResearchProvenance {
  source: ResearchSource;
  /** Provider generation timestamp of the payload, when it reports one. */
  asOf: string | null;
  /** When MarketLab stored the payload. */
  fetchedAt: number;
  /** Reporting/publication date of the underlying facts. */
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
  label: string;
  periodEnd: string | null;
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
  partial: boolean;
  provenance: ResearchProvenance;
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
  official: boolean;
}

export interface PriceStatistics {
  high52w: number | null;
  low52w: number | null;
  coverageDays: number | null;
  fullYear: boolean;
  averageVolume: number | null;
  averageVolumeWindows: number | null;
}

/**
 * Provider-reported valuation and return ratios.
 *
 * Units follow the provider's own definition; `null` means "not reported",
 * never zero. Nothing here is estimated by MarketLab except `peTtm`, which the UI
 * may derive from price ÷ positive TTM EPS and labels as calculated.
 */
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

export interface ResearchResult {
  /** False when no research token is configured; every section is then null. */
  configured: boolean;
  /** Human-readable reason for an empty/unavailable result. */
  reason: string | null;
  instrumentId: string;
  symbol: string;
  profile: CompanyProfile | null;
  financials: FinancialStatements | null;
  shareholding: ShareholdingPeriod[];
  news: NewsFeed | null;
  events: CorporateEvent[];
  /** Derived from stored candles only; nulls when no series is cached. */
  priceStats: PriceStatistics;
  /** Provider-reported valuation ratios, when the research payload supplies them. */
  ratios: ResearchRatios | null;
  errors: Partial<Record<ResearchSection, string>>;
  newsProvider: ResearchSource | null;
  gnewsDelayed: boolean;
  fetchedAt: number;
}

export const researchApi = {
  getResearch: makeFunctionReference<
    "action",
    { instrumentId: string; sections?: ResearchSection[]; refresh?: boolean },
    ResearchResult
  >("research:getResearch"),
};
