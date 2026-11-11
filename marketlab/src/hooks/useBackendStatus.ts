import { useCallback, useEffect, useRef, useState } from "react";
import { convexUrl, hasConvexUrl, probeBackend } from "@/lib/backend";

export type BackendStatus = "checking" | "online" | "offline" | "unconfigured";

export interface BackendState {
  status: BackendStatus;
  /** Deployment URL in use (empty when unconfigured). Never a secret. */
  url: string;
  error: string | null;
  /** Consecutive failed probes since the last success. */
  attempt: number;
  lastCheckedAt: number | null;
  lastOnlineAt: number | null;
  latencyMs: number | null;
  /** Milliseconds until the next automatic probe (null when none scheduled). */
  nextRetryInMs: number | null;
  retryNow: () => void;
}

/** Bounded backoff schedule — no tighter than 2s, never slower than 60s. */
const BACKOFF_MS = [2_000, 4_000, 8_000, 15_000, 30_000, 60_000];
/** Re-check cadence while the deployment is reachable. */
const HEALTHY_RECHECK_MS = 30_000;

const backoffFor = (attempt: number) =>
  BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];

/**
 * Probes the Convex deployment with bounded backoff.
 *
 * The point is to stop the endless WebSocket reconnect loop: while this hook
 * reports anything other than `online`, the app never constructs a
 * `ConvexReactClient`, so the browser makes no socket attempts at all.
 */
export function useBackendStatus(): BackendState {
  const [status, setStatus] = useState<BackendStatus>(
    hasConvexUrl ? "checking" : "unconfigured"
  );
  const [error, setError] = useState<string | null>(
    hasConvexUrl ? null : "VITE_CONVEX_URL is not configured"
  );
  const [attempt, setAttempt] = useState(0);
  const [lastCheckedAt, setLastCheckedAt] = useState<number | null>(null);
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [nextRetryInMs, setNextRetryInMs] = useState<number | null>(null);

  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const manualWake = useRef<(() => void) | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const schedule = useCallback((delayMs: number, wake: () => void) => {
    if (!mounted.current) return;
    if (timer.current) clearTimeout(timer.current);
    setNextRetryInMs(delayMs);
    timer.current = setTimeout(() => {
      if (!mounted.current) return;
      setNextRetryInMs(null);
      wake();
    }, delayMs);
  }, []);

  useEffect(() => {
    if (!hasConvexUrl) return;
    let cancelled = false;

    const run = async () => {
      const result = await probeBackend(convexUrl);
      if (cancelled || !mounted.current) return;
      const now = Date.now();
      setLastCheckedAt(now);

      if (result.ok) {
        attemptRef.current = 0;
        setAttempt(0);
        setStatus("online");
        setError(null);
        setLatencyMs(result.latencyMs);
        setLastOnlineAt(now);
        schedule(HEALTHY_RECHECK_MS, run);
      } else {
        attemptRef.current += 1;
        setAttempt(attemptRef.current);
        setStatus("offline");
        setError(result.error);
        setLatencyMs(null);
        schedule(backoffFor(attemptRef.current - 1), run);
      }
    };

    // Exposed for the manual "Retry" button: clears the pending wait.
    manualWake.current = () => {
      attemptRef.current = 0;
      setAttempt(0);
      setNextRetryInMs(null);
      void run();
    };

    void run();

    return () => {
      cancelled = true;
      manualWake.current = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [schedule]);

  // A manual retry does NOT flip back to "checking": the app stays rendered
  // (and keeps its current page) while the probe runs in the background.
  const retryNow = useCallback(() => {
    manualWake.current?.();
  }, []);

  return {
    status,
    url: convexUrl,
    error,
    attempt,
    lastCheckedAt,
    lastOnlineAt,
    latencyMs,
    nextRetryInMs,
    retryNow,
  };
}
