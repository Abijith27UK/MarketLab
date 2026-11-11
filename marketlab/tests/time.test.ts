import { describe, expect, it } from "vitest";
import {
  chunkRange,
  istDateString,
  istDateToUtcMs,
  istDateTimeString,
  istTimeString,
  isFresh,
  marketSession,
  naiveIstEpochToUtcMs,
  utcMsToNaiveIstEpoch,
} from "../convex/market/time";

describe("IST conversions", () => {
  it("converts a documented FYERS sample candle to the correct IST date", () => {
    // FYERS v3 docs: candle epoch 1690934400 for the 2023-08-02 daily bar.
    const utcMs = naiveIstEpochToUtcMs(1690934400);
    expect(istDateString(utcMs)).toBe("2023-08-02");
    expect(istTimeString(utcMs)).toBe("00:00");
    expect(new Date(utcMs).toISOString()).toBe("2023-08-01T18:30:00.000Z");
  });

  it("round-trips between UTC ms and FYERS naive epochs", () => {
    const utcMs = istDateToUtcMs("2024-06-14") + 9 * 3_600_000 + 15 * 60_000;
    expect(naiveIstEpochToUtcMs(utcMsToNaiveIstEpoch(utcMs))).toBe(utcMs);
  });

  it("formats IST date and time independently of the host timezone", () => {
    const utc = Date.UTC(2024, 0, 29, 4, 30); // 10:00 IST Monday
    expect(istDateString(utc)).toBe("2024-01-29");
    expect(istTimeString(utc)).toBe("10:00");
    expect(istDateTimeString(utc)).toBe("2024-01-29 10:00");
  });

  it("rejects malformed dates", () => {
    expect(() => istDateToUtcMs("29-01-2024")).toThrow();
  });
});

describe("market session", () => {
  const monday = (hh: number, mm = 0) => Date.UTC(2024, 0, 29, hh, mm);

  it("is OPEN during 09:15–15:30 IST", () => {
    const session = marketSession(monday(4, 30)); // 10:00 IST
    expect(session.status).toBe("OPEN");
    expect(session.istTime).toBe("10:00");
  });

  it("marks the pre-open window", () => {
    expect(marketSession(monday(3, 35)).status).toBe("PRE_OPEN"); // 09:05 IST
  });

  it("is closed before the open and after the close", () => {
    expect(marketSession(monday(3, 0)).status).toBe("CLOSED"); // 08:30 IST
    expect(marketSession(monday(10, 30)).status).toBe("CLOSED"); // 16:00 IST
  });

  it("is closed at the weekend", () => {
    const saturday = Date.UTC(2024, 0, 27, 4, 30);
    expect(marketSession(saturday).status).toBe("WEEKEND");
  });

  it("honours a configured holiday list and reports unknown holidays", () => {
    const holiday = marketSession(monday(4, 30), ["2024-01-29"]);
    expect(holiday.status).toBe("HOLIDAY");
    expect(holiday.holidayKnown).toBe(true);

    const withoutCalendar = marketSession(monday(4, 30), []);
    expect(withoutCalendar.status).toBe("OPEN");
    // The UI must be able to say that holidays are not configured.
    expect(withoutCalendar.holidayKnown).toBe(false);
  });
});

describe("freshness and ranges", () => {
  it("treats missing or old timestamps as stale", () => {
    expect(isFresh(null, 1_000, 5_000)).toBe(false);
    expect(isFresh(1_000, 2_000, 5_000)).toBe(true);
    expect(isFresh(1_000, 9_000, 5_000)).toBe(false);
  });

  it("chunks a range into provider-sized windows", () => {
    const day = 24 * 60 * 60 * 1000;
    const chunks = chunkRange(0, 100 * day, 30);
    expect(chunks.length).toBe(4);
    expect(chunks[0].fromMs).toBe(0);
    expect(chunks[chunks.length - 1].toMs).toBe(100 * day);
    for (const chunk of chunks) {
      expect(chunk.toMs - chunk.fromMs).toBeLessThanOrEqual(30 * day);
    }
  });
});
