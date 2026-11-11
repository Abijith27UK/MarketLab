/**
 * Backend (Convex deployment) discovery and health probing.
 *
 * The frontend must NOT create a `ConvexReactClient` while the deployment is
 * unreachable: the client opens a WebSocket and retries indefinitely, which
 * floods the console and leaves every page blank. We probe the deployment over
 * plain HTTP first and only then hand a URL to the client.
 */

/** Deployment URL from the Vite env. Empty string when not configured. */
export const convexUrl: string = (import.meta.env.VITE_CONVEX_URL ?? "").trim();

/** True when a deployment URL exists in the environment. */
export const hasConvexUrl = convexUrl.length > 0;

export type ProbeResult =
  | { ok: true; latencyMs: number }
  | { ok: false; error: string };

/** Probes derived from the deployment URL. Never contains credentials. */
export function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "unparseable URL";
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0.0.0.0"]);

/** True when the configured deployment is a local (`npx convex dev`) backend. */
export function isLoopbackDeployment(url: string = convexUrl): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

type FetchOutcome =
  | { kind: "response"; status: number; ok: boolean }
  | { kind: "timeout" }
  | { kind: "network" };

/** `fetch` with its own timeout, classified into the three cases we care about. */
async function timedFetch(
  target: string,
  init: RequestInit,
  timeoutMs: number
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { ...init, signal: controller.signal });
    return { kind: "response", status: response.status, ok: response.ok };
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return aborted ? { kind: "timeout" } : { kind: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One probe against the deployment.
 * Returns a redacted, human-readable error — never the raw URL with query data.
 *
 * Two steps, because the two endpoints answer browsers differently:
 *
 * 1. `/version` serves no CORS headers, so a normal fetch fails from a
 *    different origin even though the port is open. It is fetched opaquely
 *    instead: a resolved opaque response still proves something is listening,
 *    and it is the cheapest, quietest check — a reachable deployment logs
 *    nothing to the browser console.
 * 2. If that is blocked (an extension or a proxy can reject opaque requests),
 *    `POST /api/query` is the CORS-enabled HTTP API the client itself uses. An
 *    empty path is rejected with a 4xx, which is exactly the proof we want: a
 *    Convex deployment answered. Nothing is written.
 *
 * This runs every 30 s while healthy, so step 1 is the normal path: the earlier
 * order logged a 400 on every poll and made a working backend look broken.
 * Only a 5xx counts as "reachable but unhealthy"; a 4xx is a healthy API.
 */
export async function probeBackend(
  url: string = convexUrl,
  timeoutMs = 2500
): Promise<ProbeResult> {
  if (!url) return { ok: false, error: "VITE_CONVEX_URL is not configured" };

  const base = url.replace(/\/+$/, "");
  const started = Date.now();

  const version = await timedFetch(
    `${base}/version`,
    { method: "GET", cache: "no-store", mode: "no-cors" },
    timeoutMs
  );
  if (version.kind === "response") {
    return { ok: true, latencyMs: Date.now() - started };
  }
  if (version.kind === "timeout") {
    return { ok: false, error: `No response within ${timeoutMs} ms` };
  }

  const api = await timedFetch(
    `${base}/api/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ path: "", args: {}, format: "json" }),
      cache: "no-store",
    },
    timeoutMs
  );

  if (api.kind === "response") {
    if (api.status >= 500) {
      return { ok: false, error: `Deployment responded HTTP ${api.status}` };
    }
    return { ok: true, latencyMs: Date.now() - started };
  }
  if (api.kind === "timeout") {
    return { ok: false, error: `No response within ${timeoutMs} ms` };
  }
  // Browsers only expose a generic message for network failures; say so plainly.
  return { ok: false, error: "Connection refused or host unreachable" };
}

/** Steps shown in the UI when the backend is unreachable. Read-only text. */
export function backendSetupSteps(url: string = convexUrl): string[] {
  const steps = [
    "Run `npx convex dev` in the marketlab directory. It starts the local backend and regenerates convex/_generated.",
    "Restart `npm run dev` afterwards so Vite picks up the current VITE_CONVEX_URL from .env.local.",
  ];
  if (isLoopbackDeployment(url)) {
    steps.push(
      "This deployment is your machine's local backend: the browser only reaches it while `npx convex dev` is running there.",
      "For a backend that stays online, sign in with `npx convex login` and link a hosted project, then point VITE_CONVEX_URL at it (no secrets belong in that variable)."
    );
  } else {
    steps.push(
      "The configured URL is a hosted deployment. Check that it is deployed and reachable from this network."
    );
  }
  steps.push(
    "MarketLab is fully usable without a backend: prices, charts and navigation run on the labelled SAMPLE dataset."
  );
  return steps;
}
