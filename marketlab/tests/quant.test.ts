import { describe, expect, it } from "vitest";
import {
  bollinger,
  ema,
  latestDefined,
  macd,
  rsi,
  sma,
  vwap,
} from "../convex/market/indicators";
import { sha256Hex } from "../convex/market/hash";
import { consumeDailyQuota, consumeRate, windowStartFor } from "../convex/market/rateLimit";
import { istDateToUtcMs } from "../convex/market/time";

describe("indicators", () => {
  it("computes SMA with a correct warm-up", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("seeds EMA with the SMA of the first period", () => {
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("returns no EMA values when there is not enough data", () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
  });

  it("computes RSI as 100 for an unbroken uptrend", () => {
    const values = Array.from({ length: 16 }, (_, index) => index + 1);
    const series = rsi(values, 14);
    expect(series[13]).toBeNull();
    expect(series[14]).toBe(100);
  });

  it("keeps RSI inside 0..100 for a mixed series", () => {
    const values = [10, 11, 10.5, 11.5, 11, 12, 11.4, 12.6, 12, 13, 12.2, 13.4, 12.8, 13.9, 13.1, 14];
    const series = rsi(values, 14);
    for (const value of series) {
      if (value === null) continue;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it("never fills MACD before its slow EMA is defined", () => {
    const values = Array.from({ length: 40 }, (_, index) => 100 + index);
    const result = macd(values, 12, 26, 9);
    for (let i = 0; i < 25; i += 1) expect(result.macd[i]).toBeNull();
    expect(result.macd[25]).not.toBeNull();
    // Histogram needs both the MACD line and its signal line.
    const firstHistogram = result.histogram.findIndex((value) => value !== null);
    expect(firstHistogram).toBeGreaterThanOrEqual(25 + 8);
  });

  it("computes Bollinger bands around the moving average", () => {
    const bands = bollinger([1, 2, 3, 4, 5], 3, 2);
    expect(bands.middle[2]).toBe(2);
    expect(bands.upper[2]).toBeCloseTo(3.633, 3);
    expect(bands.lower[2]).toBeCloseTo(0.367, 3);
    expect(bands.upper[1]).toBeNull();
  });

  it("resets VWAP per IST session", () => {
    const dayOne = istDateToUtcMs("2024-01-29");
    const dayTwo = istDateToUtcMs("2024-01-30");
    const series = vwap([
      { ts: dayOne + 3_600_000, high: 100, low: 90, close: 95, volume: 10 },
      { ts: dayOne + 7_200_000, high: 110, low: 100, close: 105, volume: 30 },
      { ts: dayTwo + 3_600_000, high: 200, low: 190, close: 195, volume: 10 },
    ]);
    expect(series[0]).toBeCloseTo(95, 5);
    expect(series[1]).toBeCloseTo((95 * 10 + 105 * 30) / 40, 5);
    // New session starts fresh, so the value ignores the previous day.
    expect(series[2]).toBeCloseTo(195, 5);
  });

  it("skips candles without volume in VWAP", () => {
    const series = vwap([
      { ts: istDateToUtcMs("2024-01-29"), high: 1, low: 1, close: 1, volume: null },
    ]);
    expect(series[0]).toBeNull();
  });

  it("reports the last defined value", () => {
    expect(latestDefined([null, 1, null, 3, null])).toBe(3);
    expect(latestDefined([null, null])).toBeNull();
  });
});

describe("sha256", () => {
  it("matches known test vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes long inputs across block boundaries", () => {
    expect(sha256Hex("a".repeat(1000))).toHaveLength(64);
  });
});

describe("rate limiting", () => {
  it("allows up to the per-minute limit and then blocks", () => {
    const now = 1_000;
    const first = consumeRate(null, now, 2);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(1);
    const second = consumeRate(first.window, now + 1_000, 2);
    expect(second.allowed).toBe(true);
    const third = consumeRate(second.window, now + 2_000, 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBe(57_000);
  });

  it("resets on a new window", () => {
    const first = consumeRate(null, 1_000, 1);
    const next = consumeRate(first.window, 61_000, 1);
    expect(next.allowed).toBe(true);
    expect(windowStartFor(61_000)).toBe(60_000);
  });

  it("enforces a daily quota", () => {
    const dayStart = 0;
    const first = consumeDailyQuota(null, 1_000, dayStart, 2);
    expect(first.allowed).toBe(true);
    const second = consumeDailyQuota(first.quota, 2_000, dayStart, 2);
    expect(second.allowed).toBe(true);
    const third = consumeDailyQuota(second.quota, 3_000, dayStart, 2);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });
});
