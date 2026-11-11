import { describe, expect, it } from "vitest";
import { parseCsvLine, parseOhlcvCsv, parseTimestampCell } from "../convex/market/csv";
import { istDateString, istTimeString } from "../convex/market/time";

const options = { instrumentId: "NSE:SBIN:EQUITY", interval: "1d" as const };

describe("CSV line parsing", () => {
  it("handles quoted fields and escaped quotes", () => {
    expect(parseCsvLine('2024-01-29,1,2,0.5,1.5,"1,234"')).toEqual([
      "2024-01-29",
      "1",
      "2",
      "0.5",
      "1.5",
      "1,234",
    ]);
    expect(parseCsvLine('"a ""quoted"" name",1')).toEqual(['a "quoted" name', "1"]);
  });
});

describe("timestamp cells", () => {
  it("accepts epoch seconds and milliseconds", () => {
    expect(parseTimestampCell("1706515200")).toEqual({ ts: 1706515200000 });
    expect(parseTimestampCell("1706515200000")).toEqual({ ts: 1706515200000 });
  });

  it("accepts ISO timestamps with an explicit offset", () => {
    const parsed = parseTimestampCell("2024-01-29T04:30:00Z");
    expect("ts" in parsed && new Date(parsed.ts).toISOString()).toBe("2024-01-29T04:30:00.000Z");
  });

  it("reads naive timestamps as IST", () => {
    const parsed = parseTimestampCell("2024-01-29 09:15");
    if (!("ts" in parsed)) throw new Error("expected parsed timestamp");
    expect(istDateString(parsed.ts)).toBe("2024-01-29");
    expect(istTimeString(parsed.ts)).toBe("09:15");
  });

  it("rejects nonsense", () => {
    const parsed = parseTimestampCell("yesterday");
    expect("error" in parsed).toBe(true);
  });
});

describe("OHLCV parsing", () => {
  it("parses a headed file and reports summary counts", () => {
    const csv = [
      "timestamp,open,high,low,close,volume",
      "2024-01-29,100,110,95,105,1000",
      "2024-01-30,105,115,100,112,1200",
    ].join("\n");
    const result = parseOhlcvCsv(csv, options);
    expect(result.summary.acceptedRows).toBe(2);
    expect(result.summary.rejectedRows).toBe(0);
    expect(result.candles[0].close).toBe(105);
    expect(result.candles[1].ts).toBeGreaterThan(result.candles[0].ts);
  });

  it("parses headerless positional rows", () => {
    const result = parseOhlcvCsv("2024-01-29,100,110,95,105,1000", options);
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].high).toBe(110);
  });

  it("rejects rows with inconsistent OHLC instead of silently accepting them", () => {
    const csv = [
      "timestamp,open,high,low,close,volume",
      "2024-01-29,100,90,95,105,1000",
      "2024-01-30,abc,115,100,112,1200",
      "2024-01-31,105,115,100,112,-5",
      "2024-02-01,105,115,100,112,900",
    ].join("\n");
    const result = parseOhlcvCsv(csv, options);
    expect(result.summary.acceptedRows).toBe(1);
    expect(result.summary.rejectedRows).toBe(3);
    expect(result.rejected.map((row) => row.line)).toEqual([2, 3, 4]);
    expect(result.rejected[0].reason).toMatch(/high below low/);
  });

  it("collapses duplicate timestamps and keeps the later value", () => {
    const csv = [
      "timestamp,open,high,low,close,volume",
      "2024-01-29,100,110,95,105,1000",
      "2024-01-29,100,112,95,108,1500",
    ].join("\n");
    const result = parseOhlcvCsv(csv, options);
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].close).toBe(108);
    expect(result.summary.duplicatesRemoved).toBe(1);
  });

  it("normalises volume values with thousands separators", () => {
    const csv = 'timestamp,open,high,low,close,volume\n2024-01-29,100,110,95,105,"1,23,456"';
    const result = parseOhlcvCsv(csv, options);
    expect(result.candles[0].volume).toBe(123456);
  });

  it("refuses files above the row limit", () => {
    const rows = ["timestamp,open,high,low,close,volume"];
    for (let i = 0; i < 5; i += 1) rows.push(`2024-01-2${i},100,110,95,105,1000`);
    const result = parseOhlcvCsv(rows.join("\n"), { ...options, maxRows: 3 });
    expect(result.candles).toHaveLength(0);
    expect(result.rejected[0].reason).toMatch(/limit/);
  });
});
