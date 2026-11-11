import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROVIDER_TIMEOUT_MS, ProviderTimeoutError, fetchWithTimeout } from "../convex/market/http";
import { provider as fyers } from "../convex/market/providers/fyers";
import { provider as breeze } from "../convex/market/providers/breeze";
import { provider as tapetide } from "../convex/market/providers/tapetide";
import { providerFor, supports } from "../convex/market/registry";
import type { NormalizedInstrument, ProviderEnv } from "../convex/market/types";

/**
 * Adapter contract tests.
 *
 * Every outbound call is mocked: these verify parsing, labels, timeout handling
 * and the "not configured" path without needing provider credentials or network
 * access. A real-credential request is reported as UNVERIFIED in the Phase 6
 * report, not simulated here.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const instrument = (over: Partial<NormalizedInstrument> = {}): NormalizedInstrument => ({
  instrumentId: "NSE:RELIANCE:EQUITY",
  symbol: "RELIANCE",
  tradingSymbol: "NSE:RELIANCE-EQ",
  name: "Reliance Industries",
  exchange: "NSE",
  instrumentType: "EQUITY",
  segment: "CM",
  providerIds: {},
  isin: null,
  tickSize: null,
  lotSize: null,
  isActive: true,
  source: "fyers",
  isSampleData: false,
  ...over,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const fyersEnv: ProviderEnv = {
  FYERS_APP_ID: "app-id",
  FYERS_SECRET_ID: "secret-id",
  FYERS_ACCESS_TOKEN: "access-token",
};

describe("fetchWithTimeout", () => {
  it("passes an abort signal and returns the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    globalThis.fetch = fetchMock as never;
    const response = await fetchWithTimeout("https://example.test/x");
    expect(response.status).toBe(200);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeDefined();
    expect(DEFAULT_PROVIDER_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("converts an aborted request into a stable timeout error", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    globalThis.fetch = vi.fn().mockRejectedValue(abort) as never;
    await expect(fetchWithTimeout("https://example.test/x", {}, 500)).rejects.toBeInstanceOf(
      ProviderTimeoutError
    );
    await expect(fetchWithTimeout("https://example.test/x", {}, 500)).rejects.toThrow(
      /timed out after 500 ms/
    );
  });

  it("rethrows non-abort network errors unchanged", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as never;
    await expect(fetchWithTimeout("https://example.test/x")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("FYERS adapter contract", () => {
  it("reports missing credentials by name and never calls the network", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;
    const { configured, missing } = fyers.isConfigured({});
    expect(configured).toBe(false);
    expect(missing).toEqual(["FYERS_APP_ID", "FYERS_SECRET_ID", "FYERS_ACCESS_TOKEN"]);
    await expect(fyers.fetchQuotes!({}, [instrument()])).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes a quote response and labels it DELAYED", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          s: "ok",
          d: [
            {
              n: "NSE:RELIANCE-EQ",
              s: "ok",
              v: {
                lp: 2500.5,
                ch: 12.5,
                chp: 0.5,
                open_price: 2490,
                high_price: 2510,
                low_price: 2480,
                prev_close_price: 2488,
                volume: 1200,
                bid: 2499,
                ask: 2501,
                tt: 1700000000,
              },
            },
          ],
        })
      ) as never;

    const quotes = await fyers.fetchQuotes!(fyersEnv, [instrument()]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({
      instrumentId: "NSE:RELIANCE:EQUITY",
      lastPrice: 2500.5,
      change: 12.5,
      changePercent: 0.5,
      source: "fyers",
      mode: "DELAYED",
    });
    expect(quotes[0].quoteTime).toBeGreaterThan(0);
  });

  it("surfaces an expired session as a sanitized, actionable message", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ s: "error", code: -8 })) as never;
    await expect(fyers.fetchQuotes!(fyersEnv, [instrument()])).rejects.toThrow(
      /has expired or is invalid/i
    );
  });

  it("never leaks the access token in an error message", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ s: "error", code: -99, message: "token access-token rejected" })
      ) as never;
    try {
      await fyers.fetchQuotes!(fyersEnv, [instrument()]);
      throw new Error("expected a rejection");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("access-token");
    }
  });

  it("maps candle rows and sorts them, rejecting malformed rows", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          s: "ok",
          candles: [
            [1700100000, 110, 115, 105, 112, 900],
            [1700000000, 100, 105, 95, 102, 800],
            [1700200000, "bad", 1, 1, 1, 1],
          ],
        })
      ) as never;

    const candles = await fyers.fetchCandles!(fyersEnv, {
      instrument: instrument(),
      interval: "1d",
      fromMs: 1699000000000,
      toMs: 1700300000000,
    });
    // The malformed row is dropped rather than coerced into a fake candle.
    expect(candles).toHaveLength(2);
    expect(candles[0].ts).toBeLessThan(candles[1].ts);
    expect(candles[0].mode).toBe("HISTORICAL");
    expect(candles[0].source).toBe("fyers");
  });
});

describe("Breeze adapter contract", () => {
  it("reports every required secret by name", () => {
    const { configured, missing } = breeze.isConfigured({});
    expect(configured).toBe(false);
    expect(missing).toEqual([
      "BREEZE_APP_KEY",
      "BREEZE_SECRET_KEY",
      "BREEZE_SESSION_TOKEN",
    ]);
  });

  it("normalizes historical rows and converts IST dates to UTC", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          Success: [
            { datetime: "2024-01-02", open: 100, high: 105, low: 99, close: 104, volume: 500 },
            { datetime: "2024-01-03", open: 104, high: 108, low: 103, close: 107, volume: 600 },
          ],
        })
      ) as never;

    const candles = await breeze.fetchCandles!(
      { BREEZE_APP_KEY: "k", BREEZE_SECRET_KEY: "s", BREEZE_SESSION_TOKEN: "t" },
      { instrument: instrument({ providerIds: { breeze: "RELIND" } }), interval: "1d", fromMs: 1704000000000, toMs: 1704400000000 }
    );
    expect(candles.length).toBeGreaterThanOrEqual(2);
    expect(candles[0].source).toBe("breeze");
    expect(candles[0].mode).toBe("HISTORICAL");
    // 2024-01-02 00:00 IST == 2024-01-01T18:30Z
    expect(new Date(candles[0].ts).toISOString()).toBe("2024-01-01T18:30:00.000Z");
  });

  it("refuses an interval Breeze does not serve instead of resampling", async () => {
    await expect(
      breeze.fetchCandles!(
        { BREEZE_APP_KEY: "k", BREEZE_SECRET_KEY: "s", BREEZE_SESSION_TOKEN: "t" },
        { instrument: instrument(), interval: "15m", fromMs: 0, toMs: 1 }
      )
    ).rejects.toThrow(/does not serve 15m/i);
  });
});

describe("Tapetide adapter contract", () => {
  it("reports the missing token and refuses to fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as never;
    expect(tapetide.isConfigured({}).missing).toEqual(["TAPETIDE_API_TOKEN"]);
    await expect(tapetide.fetchQuotes!({}, [instrument()])).rejects.toThrow(/not configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Provider registry selection", () => {
  it("never selects a credentialed provider that is unconfigured", () => {
    // The keyless EOD provider is always eligible; no broker feed is.
    expect(providerFor({}, "quotes")?.id).toBe("tejhq");
    expect(providerFor({}, "candles", "1d")?.id).toBe("tejhq");
    expect(providerFor({}, "candles", "15m")).toBeNull();
    expect(providerFor({}, "fundamentals")).toBeNull();
  });

  it("selects the highest-priority configured provider that supports the interval", () => {
    expect(providerFor(fyersEnv, "quotes")?.id).toBe("fyers");
    // Breeze does not serve 15m, so nothing is selected for that interval.
    expect(
      providerFor(
        {
          BREEZE_APP_KEY: "k",
          BREEZE_SECRET_KEY: "s",
          BREEZE_SESSION_TOKEN: "t",
        },
        "candles",
        "15m"
      )
    ).toBeNull();
    expect(
      providerFor(
        {
          BREEZE_APP_KEY: "k",
          BREEZE_SECRET_KEY: "s",
          BREEZE_SESSION_TOKEN: "t",
        },
        "candles",
        "1d"
      )?.id
    ).toBe("breeze");
  });

  it("reports unsupported capabilities explicitly", () => {
    expect(supports(fyers, "streaming")).toBe(false);
    expect(supports(fyers, "candles", "1w")).toBe(true);
    expect(supports(breeze, "candles", "1h")).toBe(false);
  });
});
