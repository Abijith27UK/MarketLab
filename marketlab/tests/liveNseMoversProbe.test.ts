import { describe, expect, it } from "vitest";
import {
  NseMcpClient,
  NSE_MCP_CMMKT_URL,
  unwrapMcpToolPayload,
} from "../convex/market/providers/nsemcp";

const LIVE = process.env.LIVE_NSE_MCP === "1";

describe.skipIf(!LIVE)("live NSE MCP index groups", () => {
  it("lists every index name returned by the bulk live-indices tool", async () => {
    const client = new NseMcpClient(NSE_MCP_CMMKT_URL);
    try {
      await client.initialize();
      const tools = await client.listTools();
      const tool = tools.find((entry) => entry.name === "cm_get_live_indices");
      expect(tool).toBeTruthy();
      const raw = await client.callTool("cm_get_live_indices", { group: "all", nameFilter: "" });
      const payload = unwrapMcpToolPayload(raw) as {
        returned?: number;
        indices?: Record<string, Array<{ indexName?: string; last?: number }>>;
      };
      const groups = Object.keys(payload.indices ?? {});
      console.log("GROUPS", JSON.stringify(groups));
      for (const group of groups) {
        const rows = payload.indices?.[group] ?? [];
        console.log(
          "GROUP",
          group,
          rows.length,
          JSON.stringify(rows.map((row) => row.indexName))
        );
      }
      console.log("RETURNED", payload.returned);
    } finally {
      await client.close();
    }
  }, 120_000);
});
