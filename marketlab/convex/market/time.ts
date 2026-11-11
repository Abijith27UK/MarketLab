/**
 * India Standard Time (Asia/Kolkata) helpers.
 *
 * IST is a fixed UTC+05:30 offset with no daylight saving, so every function
 * here is a pure arithmetic conversion and never depends on the host machine's
 * local timezone. All persisted timestamps are true UTC epoch milliseconds;
 * IST is only produced for display and exchange-session logic.
 */

export const IST_OFFSET_MINUTES = 330;
export const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** Session boundaries in IST minutes from midnight. */
export const SESSION = {
  preOpenStart: 9 * 60, // 09:00
  open: 9 * 60 + 15, // 09:15
  close: 15 * 60 + 30, // 15:30
};

export interface IstParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  /** Minutes since IST midnight. */
  minutesOfDay: number;
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** Splits a UTC instant into IST calendar parts. */
export function toIstParts(utcMs: number): IstParts {
  const ist = new Date(utcMs + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const month = ist.getUTCMonth() + 1;
  const day = ist.getUTCDate();
  const hour = ist.getUTCHours();
  const minute = ist.getUTCMinutes();
  const second = ist.getUTCSeconds();
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: ist.getUTCDay(),
    minutesOfDay: hour * 60 + minute,
  };
}

/** `YYYY-MM-DD` for the IST calendar date containing `utcMs`. */
export function istDateString(utcMs: number): string {
  const p = toIstParts(utcMs);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `HH:MM` in IST. */
export function istTimeString(utcMs: number): string {
  const p = toIstParts(utcMs);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** `YYYY-MM-DD HH:MM` in IST, used for chart axes and tables. */
export function istDateTimeString(utcMs: number): string {
  return `${istDateString(utcMs)} ${istTimeString(utcMs)}`;
}

/** Converts an IST calendar date (`YYYY-MM-DD`) at IST midnight to UTC ms. */
export function istDateToUtcMs(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) throw new Error(`Invalid IST date: ${date}`);
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) - IST_OFFSET_MS;
}

/**
 * FYERS history/quotes endpoints return epoch seconds that encode IST wall-clock
 * time as if it were UTC (e.g. 1690934400 is 2023-08-02 00:00 IST, not UTC).
 * This removes the 05:30 offset so the value becomes a true UTC instant.
 * Verified against the documented sample candle in the FYERS v3 API reference.
 */
export function naiveIstEpochToUtcMs(epochSeconds: number): number {
  return Math.round(epochSeconds * 1000) - IST_OFFSET_MS;
}

/** Inverse of {@link naiveIstEpochToUtcMs}, for building FYERS range params. */
export function utcMsToNaiveIstEpoch(utcMs: number): number {
  return Math.round((utcMs + IST_OFFSET_MS) / 1000);
}

export type SessionStatus = "OPEN" | "PRE_OPEN" | "CLOSED" | "WEEKEND" | "HOLIDAY";

export interface MarketSession {
  status: SessionStatus;
  /** Human readable, always prefixed with the BSE/NSE exchange. */
  label: string;
  istDate: string;
  istTime: string;
  /** True only for CLOSED/PRE_OPEN-weekday sessions where holidays are known. */
  holidayKnown: boolean;
}

/**
 * Exchange session state for NSE/BSE equity market.
 *
 * Derives IST wall-clock time from UTC (never from the browser's local clock)
 * and honours an explicit holiday list. When the holiday list is empty the
 * result explicitly reports `holidayKnown: false` so the UI can say that
 * holiday data is not configured rather than silently claiming a session.
 */
export function marketSession(
  nowMs: number,
  holidays: string[] = []
): MarketSession {
  const parts = toIstParts(nowMs);
  const date = istDateString(nowMs);
  const time = istTimeString(nowMs);
  const base = { istDate: date, istTime: time };

  if (parts.weekday === 0 || parts.weekday === 6) {
    return {
      ...base,
      status: "WEEKEND",
      label: "Closed — weekend",
      holidayKnown: holidays.length > 0,
    };
  }

  if (holidays.includes(date)) {
    return {
      ...base,
      status: "HOLIDAY",
      label: "Closed — exchange holiday",
      holidayKnown: true,
    };
  }

  if (parts.minutesOfDay < SESSION.preOpenStart) {
    return {
      ...base,
      status: "CLOSED",
      label: "Closed — opens 09:15 IST",
      holidayKnown: holidays.length > 0,
    };
  }
  if (parts.minutesOfDay < SESSION.open) {
    return {
      ...base,
      status: "PRE_OPEN",
      label: "Pre-open session (09:00–09:15 IST)",
      holidayKnown: holidays.length > 0,
    };
  }
  if (parts.minutesOfDay < SESSION.close) {
    return {
      ...base,
      status: "OPEN",
      label: "Open (09:15–15:30 IST)",
      holidayKnown: holidays.length > 0,
    };
  }
  return {
    ...base,
    status: "CLOSED",
    label: "Closed — last session ended 15:30 IST",
    holidayKnown: holidays.length > 0,
  };
}

/** True when `asOfMs` is newer than `nowMs - ttlMs`. */
export function isFresh(asOfMs: number | null | undefined, nowMs: number, ttlMs: number): boolean {
  if (typeof asOfMs !== "number" || !Number.isFinite(asOfMs)) return false;
  const age = nowMs - asOfMs;
  return age >= -60_000 && age <= ttlMs;
}

/** Floors a timestamp down to the start of the given bucket. */
export function floorToBucket(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

/**
 * Splits `[fromMs, toMs]` into windows no longer than `maxDays`, newest first.
 * Provider history endpoints cap how much one request may return.
 */
export function chunkRange(
  fromMs: number,
  toMs: number,
  maxDays: number
): { fromMs: number; toMs: number }[] {
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  const chunks: { fromMs: number; toMs: number }[] = [];
  let cursorEnd = toMs;
  let guard = 0;
  while (cursorEnd > fromMs && guard < 500) {
    const cursorStart = Math.max(fromMs, cursorEnd - maxMs);
    chunks.push({ fromMs: cursorStart, toMs: cursorEnd });
    cursorEnd = cursorStart;
    guard += 1;
  }
  return chunks.reverse();
}
