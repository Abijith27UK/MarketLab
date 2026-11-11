import { describe, expect, it } from "vitest";
import { normalizeCandles, validateCandle, findGaps, toFiniteNumber, classifyCandleMode } from "../convex/market/normalize";
import { sha256Hex } from "../convex/market/hash";
import type { NormalizedCandle } from "../convex/market/types";

const DAY = 86400000;
const T0 = 1700000000000;

const makeNormCandle = (
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number | null = 1000,
  source: any = "fyers"
): NormalizedCandle => ({
  instrumentId: "NSE:RELIANCE:EQUITY",
  interval: "1d",
  ts: T0 + i * DAY,
  open,
  high,
  low,
  close,
  volume,
  source,
  mode: source === "sample" ? "SAMPLE" : "HISTORICAL",
  adjusted: "unknown",
});

describe("Phase 4.2 - Historical data normalization", () => {
  it("validates OHLC relationships", () => {
    const ok = makeNormCandle(0, 100, 110, 90, 105);
    expect(validateCandle(ok)).toBeNull();
    
    const bad1 = makeNormCandle(0, 100, 95, 90, 105);
    expect(validateCandle(bad1)).toMatch(/high/);
    
    const bad2 = makeNormCandle(0, 100, 110, 115, 105);
    expect(validateCandle(bad2)).toMatch(/low/);
  });

  it("rejects non-positive or non-finite values", () => {
    const bad = makeNormCandle(0, 0, 10, 5, 5);
    expect(validateCandle(bad)).toMatch(/invalid/);
  });

  it("rejects negative volume", () => {
    const bad = makeNormCandle(0, 100, 110, 90, 105, -1);
    expect(validateCandle(bad)).toMatch(/volume/);
  });

  it("normalizes candles: deduplicates keeping last occurrence, sorts", () => {
    const c1 = makeNormCandle(2, 100, 110, 90, 105);
    const c2 = makeNormCandle(0, 50, 60, 40, 55);
    const c1dup = makeNormCandle(2, 200, 210, 190, 205);
    const c3 = makeNormCandle(1, 75, 85, 65, 80);
    
    const result = normalizeCandles([c1, c2, c1dup, c3]);
    expect(result.candles.length).toBe(3);
    expect(result.candles[0].ts).toBe(c2.ts);
    expect(result.candles[1].ts).toBe(c3.ts);
    expect(result.candles[2].ts).toBe(c1dup.ts);
    expect(result.candles[2].open).toBe(200);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("filters invalid candles and reports rejections", () => {
    const good = makeNormCandle(0, 100, 110, 90, 105);
    const bad = makeNormCandle(1, 100, 95, 90, 105);
    const result = normalizeCandles([good, bad]);
    expect(result.candles.length).toBe(1);
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toMatch(/high/);
  });
});

describe("Phase 4.2 - Time and gaps", () => {
  it("finds gaps in intraday series", () => {
    const HOURLY = 60 * 60 * 1000;
    // makeNormCandle advances by whole days, so shift the timestamps explicitly.
    const candleAtHour = (hour: number) => ({
      ...makeNormCandle(0, 100, 110, 90, 105),
      ts: T0 + hour * HOURLY,
    });
    const candles = [candleAtHour(0), candleAtHour(2), candleAtHour(3)];
    const gaps = findGaps(candles, "1h");
    expect(gaps.count).toBe(1);
    expect(gaps.firstFew[0]).toBe(T0 + HOURLY);
  });

  it("ignores weekends but still reports real holes in a daily series", () => {
    const weekend = [makeNormCandle(0, 100, 110, 90, 105), makeNormCandle(3, 105, 115, 95, 110)];
    expect(findGaps(weekend, "1d").count).toBe(0);

    const hole = [makeNormCandle(0, 100, 110, 90, 105), makeNormCandle(12, 105, 115, 95, 110)];
    expect(findGaps(hole, "1d").count).toBe(11);
  });

  it("no gaps reported for weekly/monthly", () => {
    const candles = [makeNormCandle(0, 100, 110, 90, 105), makeNormCandle(2, 105, 115, 95, 110)];
    expect(findGaps(candles, "1w").count).toBe(0);
    expect(findGaps(candles, "1M").count).toBe(0);
  });
});

describe("Phase 4.2 - Provenance and integrity", () => {
  it("classifies candle mode correctly", () => {
    expect(classifyCandleMode("sample")).toBe("SAMPLE");
    expect(classifyCandleMode("fyers")).toBe("HISTORICAL");
    expect(classifyCandleMode("breeze")).toBe("HISTORICAL");
  });

  it("toFiniteNumber coerces correctly", () => {
    expect(toFiniteNumber(123)).toBe(123);
    expect(toFiniteNumber("123.45")).toBe(123.45);
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(NaN)).toBeNull();
    expect(toFiniteNumber(Infinity)).toBeNull();
  });

  it("dataset hash is deterministic for same candles", () => {
    const candles = [
      { ts: T0, open: 100, high: 110, low: 90, close: 105, volume: 1000 },
      { ts: T0 + DAY, open: 105, high: 115, low: 95, close: 110, volume: 1100 },
    ];
    const h1 = sha256Hex(JSON.stringify(candles.map((c: any) => [c.ts, c.open, c.high, c.low, c.close, c.volume]))).slice(0, 16);
    const h2 = sha256Hex(JSON.stringify(candles.map((c: any) => [c.ts, c.open, c.high, c.low, c.close, c.volume]))).slice(0, 16);
    expect(h1).toBe(h2);
  });
});

describe("Phase 4.2 - Safety checks", () => {
  it("never fabricates candles on normalization errors alone", () => {
    const good = makeNormCandle(0, 100, 110, 90, 105);
    const result = normalizeCandles([good]);
    expect(result.candles.length).toBe(1);
    expect(result.candles[0].close).toBe(105);
  });
});
