/**
 * Turns a thrown error into a short sentence suitable for display.
 *
 * Convex wraps a handler failure with transport metadata — the function path, a
 * request id and a stack trace. Showing that verbatim leaks internals into the
 * UI and buries the actual message, so only the `Uncaught Error:` tail (or the
 * first meaningful line) is kept.
 */
export function friendlyError(error: unknown, fallback = "Something went wrong."): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : "";

  if (!raw.trim()) return fallback;

  const uncaught = raw.match(/Uncaught Error:\s*([^\n]+)/);
  if (uncaught) return uncaught[1].trim().slice(0, 300);

  const firstLine = raw.split("\n")[0].trim();
  if (/Server Error|Request ID/i.test(firstLine)) return fallback;
  return firstLine.slice(0, 300) || fallback;
}
