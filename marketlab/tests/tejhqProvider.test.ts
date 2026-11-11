import { afterEach, describe, expect, it, vi } from "vitest";
import { provider as tejhq } from "../convex/market/providers/tejhq";
import { ProviderTimeoutError } from "../convex/market/http";
import {
  availableIntervals,
  providerFor,
  providerStatuses,
  supports,
} from "../convex/market/registry";
import type { NormalizedInstrument } from "../convex/market/types";
import { istDateToUtcMs, SESSION } from "../convex/market/time";
import { classifyCandleMode } from "../convex/market/normalize";
import { providerFallbackWarning, sampleCandleFallback } from "../convex/market/fallback";

/**
 * TejHQ adapter contract tests.
 *
 * Fixtures mirror the response shapes published in the live OpenAPI document
 * (`https://api.tejhq.dev/openapi.yaml`): `{ data: [...], meta: {...} }` with
 * `date` as `YYYY-MM-DD`. Every request is mocked, so the suite never depends on
 * api.tejhq.dev being reachable. The live endpoints themselves were verified
 * manually (see docs/RELEASE_READINESS.md).
 */

const realFetch = globalThis.fetch;

// The EOD quote tests re-import the adapter after `vi.resetModules()` so each
// test starts with an empty snapshot cache. Under the full parallel suite that
// transform can exceed Vitest's 5 s default even though the requests are mocked.
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const instrument = (over: Partial<NormalizedInstrument> = {}): NormalizedInstrument => ({
  instrumentId: "NSE:RELIANCE:EQUITY",
  symbol: "RELIANCE",
  tradingSymbol: "NSE:RELIANCE",
  name: "Reliance Industries",
  exchange: "NSE",
  instrumentType: "EQUITY",
  segment: "CM",
  providerIds: {},
  isin: null,
  tickSize: null,
  lotSize: null,
  isActive: true,
  source: "tejhq",
  isSampleData: false,
  ...over,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }) as unknown as Response;

const ohlcvRow = (date: string, close = 100) => ({
  date,
  open: 99,
  high: Math.max(101, close + 1),
  low: 98,
  close,
  last: close,
  prev_close: 98,
  volume: 1000,
  turnover: 100000,
  trades: 50,
});

const snapshotRow = (symbol: string, close = 250, prev = 240) => ({
  symbol,
  series: "EQ",
  isin: "INE002A01018",
  name: "RELIANCE INDUSTRIES LTD",
  open: 245,
  high: 255,
  low: 244,
  close,
  last: close,
  prev_close: prev,
  volume: 123456,
  turnover: 30864000,
  trades: 900,
});

const mockFetch = (handler: (url: string) => Response | Promise<Response>) => {
  const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
  globalThis.fetch = fetchMock as never;
  return fetchMock;
};

describe("TejHQ configuration", () => {
  it("is keyless: configured with no environment variables and no auth header", async () => {
    expect(tejhq.id).toBe("tejhq");
    expect(tejhq.authMode).toBe("none");
    expect(tejhq.requiredEnv).toEqual([]);
    expect(tejhq.isConfigured({})).toEqual({ configured: true, missing: [] });

    const fetchMock = mockFetch(() => jsonResponse({ data: [ohlcvRow("2024-01-02")] }));
    await tejhq.fetchCandles?.(
      {},
      {
        instrument: instrument(),
        interval: "1d",
        fromMs: istDateToUtcMs("2024-01-01"),
        toMs: istDateToUtcMs("2024-01-10"),
      }
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeDefined();
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization|bearer/i);
  });

  it("declares daily candles only and never a streaming or fundamentals capability", () => {
    expect(tejhq.capabilities.candles.supported).toBe(true);
    expect(tejhq.capabilities.candles.intervals).toEqual(["1d"]);
    expect(tejhq.capabilities.streaming.supported).toBe(false);
    expect(tejhq.capabilities.fundamentals.supported).toBe(false);
    expect(supports(tejhq, "candles", "1d")).toBe(true);
    expect(supports(tejhq, "candles", "15m")).toBe(false);
  });
});

describe("TejHQ candles", () => {
  it("maps EOD rows to HISTORICAL candles at the IST session date", async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({
        data: [ohlcvRow("2024-01-02", 2611.7), ohlcvRow("2024-01-03", 2583.3)],
        meta: { count: 2 },
      })
    );

    const candles = await tejhq.fetchCandles?.(
      {},
      {
        instrument: instrument(),
        interval: "1d",
        fromMs: istDateToUtcMs("2024-01-01"),
        toMs: istDateToUtcMs("2024-01-10"),
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/v1/ohlcv/NSE/RELIANCE");
    expect(url).toContain("from=2024-01-01");
    expect(url).toContain("to=2024-01-10");

    expect(candles).toHaveLength(2);
    expect(candles?.[0]).toMatchObject({
      instrumentId: "NSE:RELIANCE:EQUITY",
      interval: "1d",
      ts: istDateToUtcMs("2024-01-02"),
      close: 2611.7,
      source: "tejhq",
      mode: "HISTORICAL",
      adjusted: "unknown",
    });
  });

  it("never yields a LIVE or SAMPLE label for provider rows", async () => {
    mockFetch(() => jsonResponse({ data: [ohlcvRow("2024-01-02")] }));
    const candles = await tejhq.fetchCandles?.(
      {},
      {
        instrument: instrument(),
        interval: "1d",
        fromMs: istDateToUtcMs("2024-01-01"),
        toMs: istDateToUtcMs("2024-01-10"),
      }
    );
    expect(new Set(candles?.map((candle) => candle.mode))).toEqual(new Set(["HISTORICAL"]));
    expect(new Set(candles?.map((candle) => candle.source))).toEqual(new Set(["tejhq"]));
  });

  it("returns an empty series for an instrument TejHQ does not cover", async () => {
    mockFetch(() =>
      jsonResponse({ data: [], meta: { count: 0, symbol: "NOTAREALSYMBOL" } })
    );
    const candles = await tejhq.fetchCandles?.(
      {},
      {
        instrument: instrument({ instrumentId: "NSE:NIFTY 50:INDEX", symbol: "NIFTY 50" }),
        interval: "1d",
        fromMs: istDateToUtcMs("2024-01-01"),
        toMs: istDateToUtcMs("2024-01-10"),
      }
    );
    expect(candles).toEqual([]);
  });

  it("drops malformed rows instead of repairing or fabricating them", async () => {
    mockFetch(() =>
      jsonResponse({
        data: [
          ohlcvRow("2024-01-02", 100),
          // high below low
          { ...ohlcvRow("2024-01-03"), high: 90, low: 120 },
          // missing close
          { ...ohlcvRow("2024-01-04"), close: null },
          // unparseable date
          { ...ohlcvRow("2024-01-05"), date: "02/01/2024" },
          // negative price
          { ...ohlcvRow("2024-01-08"), close: -5 },
          ohlcvRow("2024-01-09", 101),
          // duplicate timestamp keeps the later row
          ohlcvRow("2024-01-09", 102),
        ],
      })
    );

    const candles = await tejhq.fetchCandles?.(
      {},
      {
        instrument: instrument(),
        interval: "1d",
        fromMs: istDateToUtcMs("2024-01-01"),
        toMs: istDateToUtcMs("2024-01-10"),
      }
    );

    expect(candles?.map((candle) => candle.ts)).toEqual([
      istDateToUtcMs("2024-01-02"),
      istDateToUtcMs("2024-01-09"),
    ]);
    expect(candles?.[1].close).toBe(102);
  });

  it("refuses an intraday interval instead of resampling daily bars", async () => {
    const fetchMock = mockFetch(() => jsonResponse({ data: [] }));
    await expect(
      tejhq.fetchCandles?.(
        {},
        {
          instrument: instrument(),
          interval: "15m",
          fromMs: istDateToUtcMs("2024-01-01"),
          toMs: istDateToUtcMs("2024-01-10"),
        }
      )
    ).rejects.toThrow(/daily bars only/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a sanitized provider error", async () => {
    mockFetch(() =>
      jsonResponse({ error: "bad_request", message: "invalid symbol" }, 400)
    );
    await expect(
      tejhq.fetchCandles?.(
        {},
        {
          instrument: instrument(),
          interval: "1d",
          fromMs: istDateToUtcMs("2024-01-01"),
          toMs: istDateToUtcMs("2024-01-10"),
        }
      )
    ).rejects.toThrow(/TejHQ bad_request: invalid symbol/);
  });

  it("converts an aborted request into a stable timeout error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    ) as never;
    await expect(
      tejhq.fetchCandles?.(
        {},
        {
          instrument: instrument(),
          interval: "1d",
          fromMs: istDateToUtcMs("2024-01-01"),
          toMs: istDateToUtcMs("2024-01-10"),
        }
      )
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });
});

describe("TejHQ EOD quotes", () => {
  it("labels snapshot closes DELAYED and stamps them with the session close", async () => {
    // Fake only the clock: fetchWithTimeout must still schedule its real abort timer.
    vi.useFakeTimers({ toFake: ["Date"] });
    // Friday 2026-10-30, 02:00 IST.
    vi.setSystemTime(new Date("2026-10-29T20:30:00Z"));
    vi.resetModules();
    const { provider } = await import("../convex/market/providers/tejhq");

    mockFetch((url) => {
      expect(url).toContain("/v1/snapshot/NSE?date=2026-10-30");
      return jsonResponse({ data: [snapshotRow("RELIANCE")] });
    });

    const quotes = await provider.fetchQuotes?.({}, [instrument()]);
    expect(quotes).toHaveLength(1);
    const quote = quotes![0];
    expect(quote.source).toBe("tejhq");
    expect(quote.mode).toBe("DELAYED");
    expect(quote.lastPrice).toBe(250);
    expect(quote.previousClose).toBe(240);
    expect(quote.change).toBe(10);
    expect(quote.changePercent).toBeCloseTo((10 / 240) * 100, 6);
    expect(quote.bid).toBeNull();
    expect(quote.ask).toBeNull();
    expect(quote.quoteTime).toBe(
      istDateToUtcMs("2026-10-30") + SESSION.close * 60_000
    );
  });

  it("walks back over empty sessions such as weekends", async () => {
    // Fake only the clock: fetchWithTimeout must still schedule its real abort timer.
    vi.useFakeTimers({ toFake: ["Date"] });
    // Saturday 2026-10-31, 10:00 IST.
    vi.setSystemTime(new Date("2026-10-31T04:30:00Z"));
    vi.resetModules();
    const { provider } = await import("../convex/market/providers/tejhq");

    const seen: string[] = [];
    mockFetch((url) => {
      seen.push(url);
      if (url.includes("date=2026-10-30")) {
        return jsonResponse({ data: [snapshotRow("RELIANCE", 251, 240)] });
      }
      return jsonResponse({ data: [] });
    });

    const quotes = await provider.fetchQuotes?.({}, [instrument()]);
    expect(quotes?.[0].lastPrice).toBe(251);
    // Saturday is skipped without a request; Friday supplies the close.
    expect(seen.every((url) => !url.includes("date=2026-10-31"))).toBe(true);
    expect(seen[0]).toContain("date=2026-10-30");
  });

  it("omits symbols the snapshot does not contain and never invents a price", async () => {
    // Fake only the clock: fetchWithTimeout must still schedule its real abort timer.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T20:30:00Z"));
    vi.resetModules();
    const { provider } = await import("../convex/market/providers/tejhq");

    mockFetch(() => jsonResponse({ data: [snapshotRow("RELIANCE")] }));
    const quotes = await provider.fetchQuotes?.({}, [
      instrument(),
      instrument({ instrumentId: "NSE:NIFTY 50:INDEX", symbol: "NIFTY 50", instrumentType: "INDEX" }),
    ]);
    expect(quotes).toHaveLength(1);
    expect(quotes?.[0].symbol).toBe("RELIANCE");
  });

  it("throws when no snapshot exists in the lookback window", async () => {
    // Fake only the clock: fetchWithTimeout must still schedule its real abort timer.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T20:30:00Z"));
    vi.resetModules();
    const { provider } = await import("../convex/market/providers/tejhq");

    mockFetch(() => jsonResponse({ data: [] }));
    await expect(provider.fetchQuotes?.({}, [instrument()])).rejects.toThrow(
      /no NSE snapshot in the last/i
    );
  });
});

describe("TejHQ instrument master", () => {
  it("maps snapshot rows to canonical instruments with ISINs", async () => {
    // Fake only the clock: fetchWithTimeout must still schedule its real abort timer.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T20:30:00Z"));
    vi.resetModules();
    const { provider } = await import("../convex/market/providers/tejhq");

    mockFetch(() =>
      jsonResponse({ data: [snapshotRow("RELIANCE"), { ...snapshotRow("TCS"), isin: "" }] })
    );

    const master = await provider.fetchInstrumentMaster?.({}, { exchanges: ["NSE"], limit: 10 });
    expect(master).toHaveLength(2);
    expect(master?.[0]).toMatchObject({
      instrumentId: "NSE:RELIANCE:EQUITY",
      symbol: "RELIANCE",
      exchange: "NSE",
      instrumentType: "EQUITY",
      isin: "INE002A01018",
      source: "tejhq",
      isSampleData: false,
    });
    expect(master?.[1].isin).toBeNull();
  });

  it("maps NSE and BSE symbols into separate instrument ids with a per-exchange limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T20:30:00Z"));
    vi.resetModules();
    const { provider } = await import("../convex/market/providers/tejhq");

    mockFetch((url) =>
      url.includes("/snapshot/BSE")
        ? jsonResponse({ data: [snapshotRow("RELIANCE"), snapshotRow("TCS")] })
        : jsonResponse({ data: [snapshotRow("RELIANCE"), snapshotRow("TCS")] })
    );

    // limit applies per exchange, so a full NSE list must not crowd BSE out.
    const master = await provider.fetchInstrumentMaster?.({}, { exchanges: ["NSE", "BSE"], limit: 1 });
    expect(master?.map((row) => row.instrumentId)).toEqual([
      "NSE:RELIANCE:EQUITY",
      "BSE:RELIANCE:EQUITY",
    ]);
    expect(master?.map((row) => row.exchange)).toEqual(["NSE", "BSE"]);
    expect(master?.[1].providerIds).toEqual({ tejhq: "RELIANCE" });
  });

  it("keeps one row per exchange symbol when the bhavcopy repeats a symbol", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T20:30:00Z"));
    vi.resetModules();
    const { provider } = await import("../convex/market/providers/tejhq");

    mockFetch(() =>
      jsonResponse({
        data: [snapshotRow("RELIANCE"), { ...snapshotRow("RELIANCE"), series: "BE" }],
      })
    );

    const master = await provider.fetchInstrumentMaster?.({}, { exchanges: ["NSE"], limit: 10 });
    expect(master).toHaveLength(1);
  });
});

describe("TejHQ registry behaviour", () => {
  it("is selected for daily candles with no credentials present", () => {
    const provider = providerFor({}, "candles", "1d");
    expect(provider?.id).toBe("tejhq");
  });

  it("is not selected for intervals it cannot serve", () => {
    expect(providerFor({}, "candles", "15m")).toBeNull();
  });

  it("reports itself as configured with no missing environment variables", () => {
    const status = providerStatuses({}).find((entry) => entry.providerId === "tejhq");
    expect(status?.configured).toBe(true);
    expect(status?.missingEnv).toEqual([]);
    expect(status?.requiredEnv).toEqual([]);
    expect(status?.authMode).toBe("none");
  });

  it("adds daily intervals to the deployment's available intervals", () => {
    expect(availableIntervals({})).toEqual(["1d"]);
  });

  it("loses to a configured broker feed for the same interval", () => {
    const provider = providerFor(
      {
        FYERS_APP_ID: "app",
        FYERS_SECRET_ID: "secret",
        FYERS_ACCESS_TOKEN: "token",
      },
      "candles",
      "1d"
    );
    expect(provider?.id).toBe("fyers");
  });
});

describe("TejHQ SAMPLE / REAL_ONLY contract", () => {
  it("labels provider candles HISTORICAL so REAL_ONLY can consume them", async () => {
    mockFetch(() => jsonResponse({ data: [ohlcvRow("2024-01-02")] }));
    const candles = await tejhq.fetchCandles?.(
      {},
      {
        instrument: instrument(),
        interval: "1d",
        fromMs: istDateToUtcMs("2024-01-01"),
        toMs: istDateToUtcMs("2024-01-10"),
      }
    );
    expect(classifyCandleMode("tejhq")).toBe("HISTORICAL");
    expect(candles?.every((candle) => candle.mode === "HISTORICAL")).toBe(true);
    expect(candles?.every((candle) => candle.mode !== "SAMPLE")).toBe(true);
  });

  it("labels the failure fallback SAMPLE and names the provider, never REAL", () => {
    const fallback = sampleCandleFallback({
      instrument: { instrumentId: "NSE:RELIANCE:EQUITY", symbol: "RELIANCE" },
      interval: "1d",
      fromMs: istDateToUtcMs("2024-01-01"),
      toMs: istDateToUtcMs("2024-01-10"),
      nowMs: Date.now(),
      maxCandles: 500,
    });

    expect(fallback.mode).toBe("SAMPLE");
    expect(fallback.source).toBe("sample");
    expect(fallback.candles.every((candle) => candle.mode === "SAMPLE")).toBe(true);
    expect(fallback.candles.every((candle) => candle.source === "sample")).toBe(true);

    const warning = providerFallbackWarning(tejhq.label, "Provider request timed out after 15000 ms");
    expect(warning).toContain("TejHQ");
    expect(warning).toMatch(/not market history/);
  });
});
