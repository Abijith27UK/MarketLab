import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NseMcpClient,
  normalizeNseMcpQuote,
  parseQuoteTime,
  provider,
  nseMcpEnabled,
} from "../convex/market/providers/nsemcp";
import type { NormalizedInstrument } from "../convex/market/types";

/**
 * The NSE MCP adapter is verified here against a mock Streamable-HTTP
 * transport. Nothing in this file proves live connectivity to mcp.nseindia.in;
 * that remains an explicit, documented limitation.
 */

const instrument: NormalizedInstrument = {
  instrumentId: "NSE:RELIANCE:EQUITY",
  symbol: "RELIANCE",
  tradingSymbol: "NSE:RELIANCE",
  name: "Reliance Industries",
  exchange: "NSE",
  instrumentType: "EQUITY",
  segment: "EQ",
  providerIds: { tejhq: "RELIANCE" },
  isin: "INE002A01018",
  tickSize: null,
  lotSize: null,
  isActive: true,
  source: "tejhq",
  isSampleData: false,
};

const TOOLS = {
  tools: [
    {
      name: "get_equity_quote",
      description: "Delayed market quote for one symbol",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          exchange: { type: "string", enum: ["NSE", "BSE"] },
        },
        required: ["symbol"],
      },
    },
  ],
};

const QUOTE_CALL = {
  content: [
    {
      type: "text",
      text: JSON.stringify({
        data: {
          symbol: "RELIANCE",
          lastPrice: "2925.40",
          previousClose: 2900.1,
          lastUpdateTime: "2026-11-12T14:32:00+05:30",
          volume: 120000,
        },
      }),
    },
  ],
};

interface RecordedCall {
  method: string;
  sessionId: string | null;
  body: Record<string, unknown> | null;
}

const json = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json", "mcp-session-id": "sess-1" },
  });

/** Minimal Streamable-HTTP MCP server: initialize, tools/list, tools/call. */
const mockServer = (options: { tools?: unknown; call?: unknown } = {}) => {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method, sessionId: headers["Mcp-Session-Id"] ?? null, body });

    if (method === "DELETE") return new Response(null, { status: 204 });
    if (body?.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body?.method === "initialize") {
      return json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "nse-mcp", version: "1.0.0" },
          capabilities: { tools: {} },
        },
      });
    }
    if (body?.method === "tools/list") {
      return json({ jsonrpc: "2.0", id: body.id, result: options.tools ?? TOOLS });
    }
    if (body?.method === "tools/call") {
      return json({ jsonrpc: "2.0", id: body.id, result: options.call ?? QUOTE_CALL });
    }
    return new Response("unsupported", { status: 400 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NSE MCP feature flag", () => {
  it("is disabled unless NSE_MCP_POC_ENABLED is exactly true", () => {
    expect(nseMcpEnabled({})).toBe(false);
    expect(nseMcpEnabled({ NSE_MCP_POC_ENABLED: "false" })).toBe(false);
    expect(nseMcpEnabled({ NSE_MCP_POC_ENABLED: "TRUE" })).toBe(true);
  });

  it("reports itself as unconfigured and makes no network call while disabled", async () => {
    const { fetchMock } = mockServer();
    expect(provider.isConfigured({})).toEqual({
      configured: false,
      missing: ["NSE_MCP_POC_ENABLED"],
    });
    await expect(provider.fetchQuotes?.({}, [instrument])).rejects.toThrow(/disabled/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("explains the flag in the test-connection result instead of faking success", async () => {
    const result = await provider.testConnection({});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/NSE_MCP_POC_ENABLED/);
  });
});

describe("NSE MCP session and tool discovery", () => {
  it("performs initialize, notifications/initialized, tools/list and reuses the session id", async () => {
    const { calls } = mockServer();
    const client = new NseMcpClient();
    const init = await client.initialize();
    const tools = await client.listTools();
    await client.close();

    expect(init.protocolVersion).toBe("2025-06-18");
    expect(init.serverInfo?.name).toBe("nse-mcp");
    expect(tools.map((tool) => tool.name)).toEqual(["get_equity_quote"]);

    const methods = calls.map((call) => call.body?.method ?? call.method);
    expect(methods[0]).toBe("initialize");
    expect(methods[1]).toBe("notifications/initialized");
    expect(methods[2]).toBe("tools/list");
    expect(methods.at(-1)).toBe("DELETE");
    // The session id from the handshake response is echoed afterwards.
    expect(calls[0].sessionId).toBeNull();
    expect(calls[2].sessionId).toBe("sess-1");
  });
});

describe("NSE MCP quote retrieval", () => {
  it("calls a discovered tool with schema-valid arguments and labels the result DELAYED", async () => {
    const { calls } = mockServer();
    const quotes = await provider.fetchQuotes?.({ NSE_MCP_POC_ENABLED: "true" }, [instrument]);

    expect(quotes).toHaveLength(1);
    const quote = quotes![0];
    expect(quote.source).toBe("nsemcp");
    expect(quote.mode).toBe("DELAYED");
    expect(quote.mode).not.toBe("LIVE");
    expect(quote.lastPrice).toBeCloseTo(2925.4, 2);
    expect(quote.previousClose).toBeCloseTo(2900.1, 2);
    expect(quote.change).toBeCloseTo(25.3, 2);
    expect(quote.quoteTime).toBe(Date.parse("2026-11-12T14:32:00+05:30"));
    expect(quote.volume).toBe(120000);

    const toolCall = calls.find((call) => call.body?.method === "tools/call");
    const params = toolCall?.body?.params as { name: string; arguments: Record<string, unknown> };
    expect(params.name).toBe("get_equity_quote");
    // Argument names come from the discovered schema, not from hard-coded guesses.
    expect(params.arguments.symbol).toBe("RELIANCE");
    expect(params.arguments.exchange).toBe("NSE");
  });

  it("refuses to guess a tool when the server exposes none with a symbol argument", async () => {
    const { calls } = mockServer({
      tools: {
        tools: [
          {
            name: "server_status",
            description: "Health information",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    });
    await expect(
      provider.fetchQuotes?.({ NSE_MCP_POC_ENABLED: "true" }, [instrument])
    ).rejects.toThrow(/no quote tool/i);
    expect(calls.some((call) => call.body?.method === "tools/call")).toBe(false);
  });

  it("returns nothing rather than inventing a price when the tool reports an error", async () => {
    mockServer({ call: { isError: true, content: [{ type: "text", text: "symbol not found" }] } });
    const quotes = await provider.fetchQuotes?.({ NSE_MCP_POC_ENABLED: "true" }, [instrument]);
    expect(quotes).toEqual([]);
  });

  it("drops a payload with no usable price", () => {
    expect(normalizeNseMcpQuote({ content: [{ type: "text", text: '{"data":{}}' }] }, instrument)).toBeNull();
    expect(
      normalizeNseMcpQuote({ data: { symbol: "RELIANCE", lastPrice: 0 } }, instrument)
    ).toBeNull();
  });
});

describe("NSE MCP timestamp handling", () => {
  it("treats epoch seconds as seconds and ISO strings as instants", () => {
    expect(parseQuoteTime(1_760_000_000)).toBe(1_760_000_000_000);
    expect(parseQuoteTime(1_760_000_000_000)).toBe(1_760_000_000_000);
    expect(parseQuoteTime("2026-11-12T14:32:00+05:30")).toBe(
      Date.parse("2026-11-12T14:32:00+05:30")
    );
    expect(parseQuoteTime(undefined)).toBeNull();
  });

  it("leaves quoteTime null when the provider sends no timestamp", async () => {
    mockServer({
      call: {
        content: [{ type: "text", text: '{"symbol":"RELIANCE","lastPrice":2925.4}' }],
      },
    });
    const quotes = await provider.fetchQuotes?.({ NSE_MCP_POC_ENABLED: "true" }, [instrument]);
    expect(quotes?.[0].quoteTime).toBeNull();
    // No timestamp means the UI must say so; the label is still DELAYED, not LIVE.
    expect(quotes?.[0].mode).toBe("DELAYED");
  });
});
