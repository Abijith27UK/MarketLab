/**
 * Tapetide research over MCP.
 *
 * Tapetide's REST API requires a plan the owner's token does not have
 * (`notice.code = api_access_not_in_plan` on every route, verified 2026-11-12).
 * The same personal token authorises the MCP server, which exposes the same
 * research through tools:
 *
 *   get_company_profile · get_financials · get_shareholding
 *   get_stock_news      · get_corporate_actions
 *
 * Requests stay server-side. The token is only ever placed in the Authorization
 * header of an outbound fetch; it is never returned to the browser or logged.
 */

import type { ProviderEnv } from "../types";
import { NseMcpClient, unwrapMcpToolPayload } from "../providers/nsemcp";
import { redactError } from "../normalize";

export const TAPETIDE_MCP_URL = "https://mcp.tapetide.com/mcp";

export function tapetideMcpConfigured(env: ProviderEnv): boolean {
  return Boolean((env.TAPETIDE_API_TOKEN ?? "").trim());
}

/**
 * One short-lived MCP session per call: initialize → tools/list → tools/call.
 * Tool names are checked against the advertised list before invoking anything,
 * so a server-side rename surfaces as a clear error instead of a bad request.
 */
export async function callTapetideMcp(
  env: ProviderEnv,
  toolName: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const token = (env.TAPETIDE_API_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("Tapetide is not configured. Set TAPETIDE_API_TOKEN on the Convex deployment.");
  }

  const client = new NseMcpClient(TAPETIDE_MCP_URL, undefined, {
    Authorization: `Bearer ${token}`,
  });
  try {
    await client.initialize();
    const tools = await client.listTools();
    const tool = tools.find((entry) => entry.name === toolName);
    if (!tool) {
      throw new Error(
        `Tapetide MCP does not expose ${toolName}. Discovered: ${tools
          .map((entry) => entry.name)
          .slice(0, 12)
          .join(", ")}`
      );
    }
    const raw = await client.callTool(toolName, args);
    const payload = unwrapMcpToolPayload(raw);
    if (!payload) throw new Error(`Tapetide MCP ${toolName} returned an empty payload`);
    return payload;
  } catch (error) {
    throw new Error(redactError(error));
  } finally {
    await client.close();
  }
}

export const tapetideMcp = {
  profile: (env: ProviderEnv, symbol: string) =>
    callTapetideMcp(env, "get_company_profile", { symbol }),

  /** Omit `section` so all five statement sections arrive in one call. */
  financials: (env: ProviderEnv, symbol: string) =>
    callTapetideMcp(env, "get_financials", { symbol, periods: 8 }),

  shareholding: (env: ProviderEnv, symbol: string) =>
    callTapetideMcp(env, "get_shareholding", { symbol }),

  news: (env: ProviderEnv, symbol: string, limit = 15) =>
    callTapetideMcp(env, "get_stock_news", { symbol, limit }),

  actions: (env: ProviderEnv, symbol: string, limit = 12) =>
    callTapetideMcp(env, "get_corporate_actions", { symbol, limit }),
};
