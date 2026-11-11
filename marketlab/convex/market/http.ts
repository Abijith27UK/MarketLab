/**
 * Shared HTTP behaviour for provider adapters.
 *
 * Every outbound provider call must be bounded: a hanging socket inside a
 * Convex action otherwise burns the action's whole execution budget and the
 * failure surfaces as an opaque timeout with no provider context. Each adapter
 * uses this wrapper so timeouts behave identically and produce a message the
 * UI can show without leaking credentials.
 */

export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;

export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider request timed out after ${timeoutMs} ms`);
    this.name = "ProviderTimeoutError";
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * `fetch` with an abort-based timeout.
 *
 * The abort error is converted into a stable message so callers (and the
 * provider-health store) record "timed out after N ms" rather than a runtime
 * specific DOMException string.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_PROVIDER_TIMEOUT_MS
): Promise<Response> {
  const Controller = (globalThis as { AbortController?: typeof AbortController }).AbortController;
  if (!Controller) return await fetch(url, init);

  const controller = new Controller();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (isAbortError(error)) throw new ProviderTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
