/**
 * Optional GNews adapter — only used when the owner configures `GNEWS_API_KEY`.
 *
 * GNews' free tier can delay articles by roughly 12 hours; the caller surfaces
 * that limitation next to every GNews-sourced list. Requests stay on the server:
 * the key is never sent to the browser.
 */

import type { ProviderEnv } from "../types";
import { fetchWithTimeout } from "../http";
import { redactError } from "../normalize";

export const GNEWS_TOKEN_ENV = "GNEWS_API_KEY";
const GNEWS_ENDPOINT = "https://gnews.io/api/v4/search";

/** Free-tier behaviour documented by GNews; used for an explicit UI notice. */
export const GNEWS_FREE_TIER_DELAY_NOTICE =
  "GNews free-tier results can be delayed by about 12 hours.";

export function gnewsConfigured(env: ProviderEnv): boolean {
  return Boolean((env[GNEWS_TOKEN_ENV] ?? "").trim());
}

export interface GNewsResult {
  /** Raw articles, shaped for the shared news normalizer. */
  articles: unknown[];
  delayed: boolean;
}

/**
 * Searches for exact company coverage.
 *
 * The query is the quoted company name (falling back to a distinctive symbol),
 * not the bare ticker: searching "ITC" returns unrelated articles, and the
 * relevance filter downstream cannot repair a bad query.
 */
export async function fetchGNewsArticles(
  env: ProviderEnv,
  match: { name: string | null; symbol: string },
  limit = 10
): Promise<GNewsResult> {
  const key = (env[GNEWS_TOKEN_ENV] ?? "").trim();
  if (!key) throw new Error("GNews is not configured. Set GNEWS_API_KEY on the deployment.");

  const query = match.name && match.name.trim().length >= 4 ? `"${match.name.trim()}"` : match.symbol;
  const url =
    `${GNEWS_ENDPOINT}?q=${encodeURIComponent(query)}` +
    `&lang=en&country=in&max=${Math.min(Math.max(limit, 1), 10)}&sortby=publishedAt&token=${encodeURIComponent(key)}`;

  const response = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 12_000);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`GNews returned a non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "errors" in body
        ? JSON.stringify((body as { errors: unknown }).errors)
        : `HTTP ${response.status}`;
    throw new Error(redactError(`GNews: ${message}`));
  }

  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const articles = Array.isArray(record.articles) ? record.articles : [];

  return {
    delayed: true,
    articles: articles.map((article) => {
      const row = (typeof article === "object" && article !== null
        ? article
        : {}) as Record<string, unknown>;
      const source = row.source as { name?: unknown } | undefined;
      return {
        title: row.title,
        description: row.description,
        url: row.url,
        publishedAt: row.publishedAt,
        source: typeof source?.name === "string" ? source.name : "GNews",
        symbols: [],
      };
    }),
  };
}
