import { describe, expect, it } from "vitest";
import {
  derivedMarketCap,
  isRelevantArticle,
  normalizeEvents,
  normalizeFinancials,
  normalizeNews,
  normalizeProfile,
  normalizeShareholding,
  priceStatistics,
  safePeRatio,
  type ResearchProvenance,
} from "../convex/market/research/normalize";

const provenance: ResearchProvenance = {
  source: "tapetide",
  asOf: "2026-11-11T10:00:00.000Z",
  fetchedAt: Date.parse("2026-11-12T04:00:00.000Z"),
  reportDate: "2026-11-10",
};

describe("company profile normalization", () => {
  it("maps provider fields and keeps provenance separate from retrieval time", () => {
    const profile = normalizeProfile(
      {
        name: "ITC Limited",
        sector: "Consumer Staples",
        industry: "Cigarettes & FMCG",
        description: "Diversified Indian conglomerate.",
        website: "https://www.itcportal.com",
        isin: "INE154A01025",
        employees: 26000,
        peers: ["HINDUNILVR", "NESTLEIND", { symbol: "dabur" }, "ITC"],
      },
      { symbol: "ITC" },
      provenance
    );

    expect(profile).not.toBeNull();
    expect(profile?.name).toBe("ITC Limited");
    expect(profile?.peers).toEqual(["HINDUNILVR", "NESTLEIND", "DABUR"]);
    expect(profile?.provenance.asOf).toBe("2026-11-11T10:00:00.000Z");
    expect(profile?.provenance.fetchedAt).toBe(provenance.fetchedAt);
  });

  it("returns null when the payload carries no profile facts", () => {
    expect(normalizeProfile({}, { symbol: "ITC" }, provenance)).toBeNull();
    expect(normalizeProfile(null, { symbol: "ITC" }, provenance)).toBeNull();
  });

  it("does not invent absent metrics", () => {
    const profile = normalizeProfile(
      { name: "Reliance Industries Limited", description: "Energy and retail." },
      { symbol: "RELIANCE" },
      provenance
    );
    expect(profile?.sector).toBeNull();
    expect(profile?.isin).toBeNull();
    expect(profile?.employees).toBeNull();
    expect(profile?.peers).toEqual([]);
  });
});

describe("financial statement normalization", () => {
  const payload = {
    consolidated: true,
    unit: "crore",
    annual: {
      periods: [
        {
          period: "FY2024",
          period_end: "2024-03-31",
          revenue: 1000,
          expenses: 800,
          operating_profit: 200,
          net_profit: 150,
          eps: 12.5,
          total_assets: 5000,
          total_liabilities: 2000,
          equity: 3000,
          debt: 900,
          cash: 400,
          operating_cash_flow: 220,
          capex: 70,
        },
        {
          period: "FY2025",
          period_end: "2025-03-31",
          revenue: 1200,
          operating_profit: 300,
          net_profit: 240,
          eps: 20,
        },
      ],
    },
  };

  it("merges periods, computes margin, growth and free cash flow from reported inputs only", () => {
    const statements = normalizeFinancials(payload, provenance);
    expect(statements?.annual).toHaveLength(2);
    expect(statements?.consolidated).toBe(true);
    expect(statements?.unit).toBe("crore");

    const [fy24, fy25] = statements!.annual;
    expect(fy24.operatingMarginPct).toBe(20);
    expect(fy24.freeCashFlow).toBe(150);
    expect(fy25.revenueGrowthPct).toBe(20);
    expect(fy25.profitGrowthPct).toBe(60);
    expect(fy25.expenses).toBeNull();
    expect(fy25.eps).toBe(20);
  });

  it("returns null when no usable periods are present", () => {
    expect(normalizeFinancials({}, provenance)).toBeNull();
    expect(normalizeFinancials({ annual: { periods: [] } }, provenance)).toBeNull();
  });

  it("keeps the consolidation basis unknown when the provider is silent", () => {
    const statements = normalizeFinancials(
      { annual: { periods: [{ period: "FY2025", revenue: 10, net_profit: 1 }] } },
      provenance
    );
    expect(statements?.consolidated).toBeNull();
    expect(statements?.annual[0].operatingMarginPct).toBeNull();
  });
});

describe("valuation safety", () => {
  it("never reports a P/E for negative or missing earnings", () => {
    expect(safePeRatio(100, 5)).toBe(20);
    expect(safePeRatio(100, -5)).toBeNull();
    expect(safePeRatio(100, 0)).toBeNull();
    expect(safePeRatio(100, null)).toBeNull();
    expect(safePeRatio(null, 5)).toBeNull();
  });

  it("requires both a price and a share count for market capitalisation", () => {
    expect(derivedMarketCap(100, 1000)).toBe(100000);
    expect(derivedMarketCap(100, null)).toBeNull();
    expect(derivedMarketCap(null, 1000)).toBeNull();
    expect(derivedMarketCap(100, 0)).toBeNull();
  });
});

describe("shareholding normalization", () => {
  it("keeps unreported categories null and flags partial breakdowns", () => {
    const periods = normalizeShareholding(
      {
        periods: [
          {
            quarter: "Q2 FY26",
            as_of: "2026-09-30",
            promoter: 30,
            fii: 20,
            dii: 15,
            public: 20,
          },
        ],
      },
      provenance
    );

    expect(periods).toHaveLength(1);
    expect(periods[0].governmentPct).toBeNull();
    expect(periods[0].partial).toBe(true);
    expect(periods[0].asOf).toBe("2026-09-30");
  });

  it("returns an empty list rather than zeros when nothing is reported", () => {
    expect(normalizeShareholding({}, provenance)).toEqual([]);
  });
});

describe("news relevance and ordering", () => {
  const match = { symbol: "ITC", name: "ITC Limited" };

  it("rejects unrelated articles that merely contain a short symbol", () => {
    expect(
      isRelevantArticle(
        { symbols: [], headline: "ITC infotech arm wins deal", summary: null },
        match
      )
    ).toBe(false);
    expect(
      isRelevantArticle(
        { symbols: [], headline: "ITC Limited declares dividend", summary: null },
        match
      )
    ).toBe(true);
    expect(
      isRelevantArticle({ symbols: ["itc"], headline: "FMCG update", summary: null }, match)
    ).toBe(true);
  });

  it("sorts newest first, drops duplicates and validates article URLs", () => {
    const feed = normalizeNews(
      {
        news: [
          {
            headline: "ITC Limited posts quarterly results",
            published_at: "2026-11-01T04:00:00.000Z",
            url: "https://example.com/a",
            publisher: "Wire",
          },
          {
            headline: "ITC Limited posts quarterly results",
            published_at: "2026-11-01T04:00:00.000Z",
            url: "https://example.com/a",
            publisher: "Wire",
          },
          {
            headline: "ITC Limited announces new plant",
            published_at: "2026-11-10T04:00:00.000Z",
            url: "javascript:alert(1)",
            publisher: "Wire",
          },
          {
            headline: "Unrelated market wrap",
            published_at: "2026-11-11T04:00:00.000Z",
            url: "https://example.com/c",
            publisher: "Wire",
          },
        ],
      },
      match,
      provenance
    );

    expect(feed.items).toHaveLength(2);
    expect(feed.items[0].headline).toContain("new plant");
    expect(feed.items[0].url).toBeNull();
    expect(feed.duplicatesRemoved).toBe(1);
    expect(feed.filteredIrrelevant).toBe(1);
  });

  it("keeps articles with missing dates but leaves publishedAt null", () => {
    const feed = normalizeNews(
      { articles: [{ title: "ITC Limited board meeting", description: "ITC Limited update" }] },
      match,
      provenance
    );
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].publishedAt).toBeNull();
    expect(feed.items[0].url).toBeNull();
  });

  it("returns no items for an empty payload instead of inventing coverage", () => {
    expect(normalizeNews({}, match, provenance).items).toEqual([]);
    expect(normalizeNews(null, match, provenance).items).toEqual([]);
  });
});

describe("corporate events", () => {
  it("keeps filings separate and defaults them to official", () => {
    const events = normalizeEvents(
      {
        filings: [
          {
            subject: "Board meeting outcome",
            type: "Board meeting",
            date: "2026-11-08",
            url: "https://www.nseindia.com/filing/1",
            period: "Q2 FY26",
          },
          { title: "Press mention", type: "News", date: "2026-11-09", official: false },
        ],
      },
      "Tapetide",
      provenance
    );

    expect(events).toHaveLength(2);
    expect(events[0].official).toBe(false);
    expect(events[1].official).toBe(true);
    expect(events[1].url).toBe("https://www.nseindia.com/filing/1");
  });
});

describe("price statistics honesty", () => {
  const now = Date.parse("2026-11-12T00:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;

  it("labels a short series as partial rather than a 52-week range", () => {
    const candles = Array.from({ length: 60 }, (_, index) => ({
      ts: now - (59 - index) * day,
      high: 100 + index,
      low: 90 + index,
      volume: 1000 + index,
    }));
    const stats = priceStatistics(candles, now);
    expect(stats.fullYear).toBe(false);
    expect(stats.coverageDays).toBe(59);
    expect(stats.averageVolume).toBeGreaterThan(0);
  });

  it("reports a full-year flag only when the series spans about a year", () => {
    const candles = Array.from({ length: 400 }, (_, index) => ({
      ts: now - (399 - index) * day,
      high: 100,
      low: 90,
      volume: 500,
    }));
    const stats = priceStatistics(candles, now);
    expect(stats.fullYear).toBe(true);
    expect(stats.high52w).toBe(100);
    expect(stats.low52w).toBe(90);
  });

  it("returns nulls with no candles", () => {
    const stats = priceStatistics([], now);
    expect(stats.high52w).toBeNull();
    expect(stats.averageVolume).toBeNull();
  });
});
