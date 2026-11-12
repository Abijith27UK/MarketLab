import { describe, expect, it } from "vitest";
import {
  normalizeTapetideActions,
  normalizeTapetideFinancials,
  normalizeTapetideNews,
  normalizeTapetideProfile,
  normalizeTapetideShareholding,
  tapetidePeriodEnd,
} from "../convex/market/research/tapetideNormalize";
import type { ResearchProvenance } from "../convex/market/research/normalize";

const provenance: ResearchProvenance = {
  source: "tapetide",
  asOf: null,
  fetchedAt: Date.parse("2026-11-12T09:10:00.000Z"),
  reportDate: null,
};

/** Shape observed from `get_company_profile` for ITC on 2026-11-12. */
const profilePayload = {
  data: {
    company: {
      about: "Established in 1910, ITC is the largest cigarette manufacturer in the country.",
      basic_industry: "Diversified FMCG",
      display_name: "ITC",
      employees: 22041,
      exchange: "NSE",
      exchange_symbol: "ITC",
      industry: "Diversified FMCG",
      isin: "INE154A01025",
      macro_sector: "Fast Moving Consumer Goods",
      name: "ITC Ltd",
      nse_symbol: "ITC",
      website: null,
    },
    fundamentals: {
      book_value: 57,
      debt_to_equity: 0.01,
      dividend_yield: 5.09,
      eps: 15.08,
      high_52w: 412,
      low_52w: 252.8,
      market_cap: 360502.98,
      net_income: 21018.2,
      price_to_book: 4.99,
      roce: 38.9,
      roe: 29.3,
      sector: "Diversified FMCG",
      stock_pe: 18.88,
      updated_at: "2026-11-12T04:30:45.622Z",
    },
    price_metrics: {
      as_of: "2026-11-12T14:57:24+05:30",
      eps_ttm: 15.08,
      market_cap: null,
      pb: 4.99,
      pe_ttm: 18.88,
      price: 284.7,
      statement_basis: "consolidated",
    },
  },
};

/** Shape observed from `get_financials` (annual sections + quarterly P&L). */
const financialsPayload = {
  data: [
    {
      section: "quarterly",
      period_type: "quarterly",
      periods: ["Jun 2026", "Sep 2026"],
      data: {
        Sales: { "Jun 2026": 19114, "Sep 2026": 20269 },
        "Operating Profit": { "Jun 2026": 5181, "Sep 2026": 5645 },
        "Net Profit": { "Jun 2026": 4930, "Sep 2026": 5110 },
        "EPS in Rs": { "Jun 2026": 3.94, "Sep 2026": 4.08 },
      },
    },
    {
      section: "profit_loss",
      period_type: "annual",
      periods: ["Mar 2025", "Mar 2026", "TTM"],
      data: {
        Sales: { "Mar 2025": 75323, "Mar 2026": 78868, TTM: 77255 },
        Expenses: { "Mar 2025": 49492, "Mar 2026": 51562, TTM: 52623 },
        "Operating Profit": { "Mar 2025": 25832, "Mar 2026": 27306, TTM: 24632 },
        "Net Profit": { "Mar 2025": 20412, "Mar 2026": 21018, TTM: 20000 },
        "EPS in Rs": { "Mar 2025": 16.3, "Mar 2026": 16.79, TTM: 15.08 },
      },
      availability: [
        { period: "Mar 2025", available_from: "2025-05-16" },
        { period: "Mar 2026", available_from: "2026-05-15" },
      ],
    },
    {
      section: "balance_sheet",
      period_type: "annual",
      periods: ["Mar 2025", "Mar 2026"],
      data: {
        "Equity Capital": { "Mar 2025": 1251, "Mar 2026": 1253 },
        Reserves: { "Mar 2025": 68779, "Mar 2026": 71254 },
        Borrowings: { "Mar 2025": 285, "Mar 2026": 2399 },
        "Total Liabilities": { "Mar 2025": 70315, "Mar 2026": 74906 },
        "Total Assets": { "Mar 2025": 70315, "Mar 2026": 74906 },
      },
    },
    {
      section: "cash_flow",
      period_type: "annual",
      periods: ["Mar 2025", "Mar 2026"],
      data: {
        "Cash from Operating Activity": { "Mar 2025": 17627, "Mar 2026": 18464 },
        "Cash from Investing Activity": { "Mar 2025": -564, "Mar 2026": -2321 },
        "Cash from Financing Activity": { "Mar 2025": -17037, "Mar 2026": -16147 },
        "Free Cash Flow": { "Mar 2025": 15000, "Mar 2026": 16000 },
      },
    },
    { section: "ratios", period_type: "annual", periods: [], data: { "ROCE %": {} } },
  ],
};

describe("Tapetide profile normalization", () => {
  it("maps real company fields and provider-reported ratios", () => {
    const normalized = normalizeTapetideProfile(profilePayload, provenance);
    expect(normalized).not.toBeNull();
    const { profile, ratios } = normalized!;

    expect(profile.name).toBe("ITC Ltd");
    expect(profile.symbol).toBe("ITC");
    expect(profile.sector).toBe("Diversified FMCG");
    expect(profile.industry).toBe("Diversified FMCG");
    expect(profile.isin).toBe("INE154A01025");
    expect(profile.employees).toBe(22041);
    expect(profile.description).toContain("largest cigarette manufacturer");
    expect(profile.provenance.asOf).toBe("2026-11-12T14:57:24+05:30");

    expect(ratios.marketCap).toBeCloseTo(360502.98);
    expect(ratios.peTtm).toBeCloseTo(18.88);
    expect(ratios.pb).toBeCloseTo(4.99);
    expect(ratios.eps).toBeCloseTo(15.08);
    expect(ratios.roePct).toBeCloseTo(29.3);
    expect(ratios.rocePct).toBeCloseTo(38.9);
    expect(ratios.debtToEquity).toBeCloseTo(0.01);
    expect(ratios.dividendYieldPct).toBeCloseTo(5.09);
  });

  it("leaves unreported ratios null instead of zero", () => {
    const normalized = normalizeTapetideProfile(
      { data: { company: { name: "Example Ltd", nse_symbol: "EX" } } },
      provenance
    );
    expect(normalized?.ratios.peTtm).toBeNull();
    expect(normalized?.ratios.roePct).toBeNull();
    expect(normalized?.profile.sector).toBeNull();
  });

  it("returns null when there is no company block", () => {
    expect(normalizeTapetideProfile({ data: null }, provenance)).toBeNull();
    expect(normalizeTapetideProfile({}, provenance)).toBeNull();
  });
});

describe("Tapetide financial statements", () => {
  it("builds annual and quarterly periods from row-major sections", () => {
    const statements = normalizeTapetideFinancials(financialsPayload, provenance);
    expect(statements).not.toBeNull();

    expect(statements!.unit).toBe("crore");
    expect(statements!.annual).toHaveLength(2);
    expect(statements!.quarterly).toHaveLength(2);

    const fy26 = statements!.annual[1];
    expect(fy26.label).toBe("Mar 2026");
    expect(fy26.periodEnd).toBe("2026-03-31");
    expect(fy26.reportDate).toBe("2026-05-15");
    expect(fy26.revenue).toBe(78868);
    expect(fy26.netProfit).toBe(21018);
    expect(fy26.eps).toBeCloseTo(16.79);
    expect(fy26.operatingMarginPct).toBeCloseTo(34.62, 1);
    expect(fy26.equity).toBe(1253 + 71254);
    expect(fy26.totalAssets).toBe(74906);
    expect(fy26.debt).toBe(2399);
    expect(fy26.operatingCashFlow).toBe(18464);
    expect(fy26.freeCashFlow).toBe(16000);
    expect(fy26.revenueGrowthPct).toBeCloseTo(4.71, 1);
    expect(fy26.profitGrowthPct).toBeCloseTo(2.97, 1);
  });

  it("drops the TTM pseudo-period rather than inventing a fiscal year", () => {
    const statements = normalizeTapetideFinancials(financialsPayload, provenance);
    expect(statements!.annual.some((period) => period.label === "TTM")).toBe(false);
  });

  it("parses fiscal labels honestly", () => {
    expect(tapetidePeriodEnd("Mar 2026")).toBe("2026-03-31");
    expect(tapetidePeriodEnd("Sep 2026")).toBe("2026-09-30");
    expect(tapetidePeriodEnd("TTM")).toBeNull();
    expect(tapetidePeriodEnd("FY26")).toBeNull();
  });

  it("returns null when no statement sections are present", () => {
    expect(normalizeTapetideFinancials({ data: [] }, provenance)).toBeNull();
  });
});

describe("Tapetide shareholding", () => {
  const payload = {
    data: [
      {
        period_type: "quarterly",
        periods: ["Jun 2026", "Sep 2026"],
        data: {
          Promoters: { "Jun 2026": 0, "Sep 2026": 0 },
          FIIs: { "Jun 2026": 34.23, "Sep 2026": 33.1 },
          DIIs: { "Jun 2026": 49.13, "Sep 2026": 49.82 },
          Public: { "Jun 2026": 16.64, "Sep 2026": 17.08 },
        },
        withheld: { Others: "not_separated" },
      },
    ],
    meta: { latest_period: "Sep 2026" },
  };

  it("sorts newest first and keeps withheld buckets null", () => {
    const periods = normalizeTapetideShareholding(payload, provenance);
    expect(periods).toHaveLength(2);
    expect(periods[0].label).toBe("Sep 2026");
    expect(periods[0].asOf).toBe("2026-09-30");
    expect(periods[0].governmentPct).toBeNull();
    expect(periods[0].fiiPct).toBeCloseTo(33.1);
    expect(periods[0].partial).toBe(false);
  });

  it("returns an empty list when nothing is reported", () => {
    expect(normalizeTapetideShareholding({ data: [] }, provenance)).toEqual([]);
  });
});

describe("Tapetide news", () => {
  const payload = {
    data: [
      {
        title: "ITC shares worth ₹17.51 crore flagged in large-trade signal on NSE",
        body: "A large-trade signal flagged approximately 6,29,685 ITC shares on the NSE.",
        sentiment: null,
        category: "equity-markets",
        sub_category: "trading-activity-volume",
        publish_date: "2026-11-09T09:33:10Z",
        source_url: "",
        related_isins: ["INE154A01025"],
      },
      {
        title: "ITC declares interim dividend",
        body: "x".repeat(600),
        sentiment: { label: "positive" },
        category: "corporate-actions",
        sub_category: "dividends",
        publish_date: "2026-11-10T04:00:00Z",
        source_url: "https://example.com/itc-dividend",
        related_isins: ["INE154A01025"],
      },
      {
        title: "ITC declares interim dividend",
        body: "duplicate",
        publish_date: "2026-11-10T04:00:00Z",
        source_url: "https://example.com/itc-dividend",
      },
    ],
  };

  it("maps publication metadata, truncates bodies and keeps real links", () => {
    const feed = normalizeTapetideNews(payload, provenance);
    expect(feed.items).toHaveLength(2);
    expect(feed.duplicatesRemoved).toBe(1);
    expect(feed.items[0].headline).toContain("interim dividend");
    expect(feed.items[0].url).toBe("https://example.com/itc-dividend");
    expect(feed.items[0].publisher).toBe("example.com");
    expect(feed.items[0].summary?.length).toBeLessThanOrEqual(401);
    expect(feed.items[0].sentiment).toBe("positive");
    expect(feed.items[1].url).toBeNull();
    expect(feed.items[1].publisher).toBe("Tapetide");
    expect(feed.items[1].category).toBe("trading-activity-volume");
  });

  it("handles an empty feed", () => {
    const feed = normalizeTapetideNews({ data: [] }, provenance);
    expect(feed.items).toEqual([]);
    expect(feed.duplicatesRemoved).toBe(0);
  });
});

describe("Tapetide corporate actions", () => {
  const payload = {
    data: [
      {
        action_type: "result",
        announcement_date: "2026-10-16",
        ex_date: "2026-11-02",
        description: "Check the Results to see the company's performance.",
      },
      {
        action_type: "annual general meeting",
        announcement_date: "2026-05-21",
        description: "Check the details of the AGM for important updates.",
      },
    ],
  };

  it("maps exchange corporate actions as official events, newest first", () => {
    const events = normalizeTapetideActions(payload, provenance);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("Financial results");
    expect(events[0].official).toBe(true);
    expect(events[0].source).toBe("Tapetide corporate actions");
    expect(events[0].url).toBeNull();
    expect(events[0].date).toBe(Date.parse("2026-10-16"));
    expect(events[1].type).toBe("Annual general meeting");
  });
});
