/**
 * Fixed-window rate limiting for outbound provider requests.
 *
 * The window is keyed to 60-second buckets and persisted in Convex, so limits
 * apply across all users and server instances rather than per browser tab.
 */

export const WINDOW_MS = 60_000;

export interface RateWindow {
  /** Bucket start, epoch ms (multiple of WINDOW_MS). */
  windowStart: number;
  count: number;
}

export interface RateDecision {
  allowed: boolean;
  window: RateWindow;
  remaining: number;
  retryAfterMs: number;
}

/** Bucket start for a timestamp. */
export function windowStartFor(nowMs: number): number {
  return Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
}

/**
 * Consumes one unit of the provider's per-minute quota.
 * Returns `allowed: false` without consuming when the window is exhausted.
 */
export function consumeRate(
  current: RateWindow | null,
  nowMs: number,
  limitPerMinute: number
): RateDecision {
  const windowStart = windowStartFor(nowMs);
  const base: RateWindow =
    current && current.windowStart === windowStart
      ? { windowStart, count: current.count }
      : { windowStart, count: 0 };

  if (limitPerMinute <= 0) {
    return {
      allowed: false,
      window: base,
      remaining: 0,
      retryAfterMs: windowStart + WINDOW_MS - nowMs,
    };
  }

  if (base.count >= limitPerMinute) {
    return {
      allowed: false,
      window: base,
      remaining: 0,
      retryAfterMs: windowStart + WINDOW_MS - nowMs,
    };
  }

  const next: RateWindow = { windowStart, count: base.count + 1 };
  return {
    allowed: true,
    window: next,
    remaining: Math.max(0, limitPerMinute - next.count),
    retryAfterMs: 0,
  };
}

/** Daily quota helper (providers such as Tapetide cap total calls per IST day). */
export interface DailyQuota {
  dayStart: number;
  count: number;
}

export function consumeDailyQuota(
  current: DailyQuota | null,
  nowMs: number,
  dayStartMs: number,
  limitPerDay: number
): { allowed: boolean; quota: DailyQuota; remaining: number } {
  const base: DailyQuota =
    current && current.dayStart === dayStartMs
      ? { dayStart: dayStartMs, count: current.count }
      : { dayStart: dayStartMs, count: 0 };
  if (limitPerDay <= 0 || base.count >= limitPerDay) {
    return { allowed: false, quota: base, remaining: 0 };
  }
  const quota = { dayStart: dayStartMs, count: base.count + 1 };
  return { allowed: true, quota, remaining: limitPerDay - quota.count };
}
