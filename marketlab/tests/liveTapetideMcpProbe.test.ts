/**
 * Opt-in live probe for the Tapetide research MCP server.
 *
 * Tapetide's REST API is not part of its Free plan, but the personal token still
 * authorises the MCP surface. Run deliberately (the token never leaves the
 * process environment and is never printed):
 *
 *   LIVE_TAPETIDE_MCP=1 TAPETIDE_API_TOKEN=... npx vitest run tests/liveTapetideMcpProbe.test.ts
 */

import { describe, expect, it } from "vitest";
import { NseMcpClient } from "../convex/market/providers/nsemcp";

const TOKEN = process.env.TAPETIDE_API_TOKEN ?? "";
const LIVE = process.env.LIVE_TAPETIDE_MCP === "1" && TOKEN.length > 0;
const URL = "https://mcp.tapetide.com/mcp";

function client(): NseMcpClient {
  return new NseMcpClient(URL, undefined, { Authorization: `Bearer ${TOKEN}` });
}

function unwrap(raw: unknown): unknown {
  const record = raw as { content?: Array<{ text?: string }> };
  const text = record?.content?.[0]?.text;
  if (typeof text !== "string") return raw;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe.skipIf(!LIVE)("Tapetide MCP live probe", () => {
  it("retrieves real research payloads for ITC", async () => {
    const c = client();
    try {
      await c.initialize();
      const tools = await c.listTools();
      const call = async (name: string, args: Record<string, unknown>) => {
        const tool = tools.find((entry) => entry.name === name);
        if (!tool) return { missing: name };
        return unwrap(await c.callTool(name, args));
      };

      const profile = (await call("get_company_profile", { symbol: "ITC" })) as {
        data: Record<string, unknown>;
      };
      console.log(
        "[probe] price_metrics",
        JSON.stringify(profile.data.price_metrics).slice(0, 1200)
      );
      console.log(
        "[probe] fundamentals",
        JSON.stringify(profile.data.fundamentals).slice(0, 800)
      );

      const financials = (await call("get_financials", { symbol: "ITC", periods: 6 })) as {
        data: Array<{ section: string; period_type: string; data: Record<string, unknown> }>;
      };
      console.log(
        "[probe] financial sections",
        JSON.stringify(
          (financials.data ?? []).map((section) => ({
            section: section.section,
            periodType: section.period_type,
            rows: Object.keys(section.data ?? {}),
            sample: JSON.stringify(section.data ?? {}).slice(0, 700),
          }))
        ).slice(0, 2600)
      );

      const shareholding = (await call("get_shareholding", { symbol: "ITC" })) as {
        data: Array<{ data: Record<string, Record<string, number>>; periods: string[] }>;
      };
      console.log(
        "[probe] shareholding",
        JSON.stringify(shareholding.data?.[0]?.data).slice(0, 800)
      );

      const news = (await call("get_stock_news", { symbol: "ITC", limit: 2 })) as {
        data: unknown[];
      };
      console.log("[probe] news", JSON.stringify(news.data?.[0]).slice(0, 700));

      const actions = await call("get_corporate_actions", { symbol: "ITC", limit: 3 });
      console.log("[probe] corporate actions", JSON.stringify(actions).slice(0, 900));

      expect(profile.data).toBeTruthy();
    } finally {
      await c.close();
    }
  }, 180_000);
});
