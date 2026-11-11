import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { backendSetupSteps, describeTarget, isLoopbackDeployment, probeBackend } from "@/lib/backend";
import {
  DEMO_INSTRUMENTS,
  DEMO_TOP_STOCKS,
  demoInstrumentById,
  isWellFormedInstrumentId,
  parseInstrumentId,
} from "@/lib/demoCatalogue";
import { modelFromDemo, modelFromQuote } from "@/lib/stockModels";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("probeBackend", () => {
  it("reports a missing deployment URL instead of attempting a request", async () => {
    const result = await probeBackend("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("VITE_CONVEX_URL is not configured");
  });

  it("treats a refused connection as offline without leaking internals", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as never;
    const result = await probeBackend("http://127.0.0.1:3210");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Connection refused or host unreachable");
      expect(result.error).not.toMatch(/127\.0\.0\.1/);
    }
  });

  it("succeeds only when the deployment answers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response) as never;
    const result = await probeBackend("https://example.convex.cloud");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("probes /version opaquely first so a healthy deployment logs no console errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 0, type: "opaque" } as Response);
    globalThis.fetch = fetchMock as never;
    const result = await probeBackend("http://127.0.0.1:3210/");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3210/version",
      expect.objectContaining({ mode: "no-cors" })
    );
  });

  it("falls back to the CORS-enabled HTTP API when the version probe is blocked", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: false, status: 400 } as Response);
    globalThis.fetch = fetchMock as never;
    const result = await probeBackend("http://127.0.0.1:3210");
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:3210/api/query",
      expect.objectContaining({ method: "POST" })
    );
    // The fallback must never write: it sends an empty path, which the API rejects.
    const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(body.path).toBe("");
  });

  it("reports a 5xx from the fallback API as unhealthy", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce({ ok: false, status: 504 } as Response);
    globalThis.fetch = fetchMock as never;
    const result = await probeBackend("https://example.convex.cloud");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("504");
  });

  it("stays offline when both the API and the version endpoint fail", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    globalThis.fetch = fetchMock as never;
    const result = await probeBackend("http://127.0.0.1:3210");
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("backend target helpers", () => {
  it("describes a target without credentials", () => {
    expect(describeTarget("http://127.0.0.1:3210")).toBe("127.0.0.1:3210");
    expect(describeTarget("not a url")).toBe("unparseable URL");
  });

  it("recognises a local development deployment", () => {
    expect(isLoopbackDeployment("http://127.0.0.1:3210")).toBe(true);
    expect(isLoopbackDeployment("http://localhost:3210")).toBe(true);
    expect(isLoopbackDeployment("https://happy-otter-123.convex.cloud")).toBe(false);
  });

  it("gives actionable steps for a local deployment", () => {
    const steps = backendSetupSteps("http://127.0.0.1:3210").join(" ");
    expect(steps).toContain("npx convex dev");
    expect(steps).toContain("npm run dev");
    expect(steps).toContain("npx convex login");
    expect(steps).toMatch(/SAMPLE/);
  });

  it("gives hosted-deployment guidance when the URL is remote", () => {
    const steps = backendSetupSteps("https://happy-otter-123.convex.cloud").join(" ");
    expect(steps).toContain("hosted deployment");
    expect(steps).not.toContain("npx convex login");
  });
});

describe("instrument id validation", () => {
  it("accepts canonical ids", () => {
    expect(parseInstrumentId("NSE:RELIANCE:EQUITY")).toEqual({
      exchange: "NSE",
      symbol: "RELIANCE",
      instrumentType: "EQUITY",
    });
    expect(parseInstrumentId("NSE:NIFTY 50:INDEX")?.symbol).toBe("NIFTY 50");
    expect(isWellFormedInstrumentId("BSE:SENSEX:INDEX")).toBe(true);
  });

  it("rejects malformed, injected or oversized ids", () => {
    const rejected = [
      "",
      "RELIANCE",
      "NSE:RELIANCE",
      "NSE:RELIANCE:WARRANT",
      "MCX:GOLD:EQUITY",
      "NSE:../../etc:EQUITY",
      "NSE:reliance:eQuity",
      "javascript:alert(1)",
      `NSE:${"A".repeat(120)}:EQUITY`,
      "NSE:REL IANCE! :EQUITY",
    ];
    for (const id of rejected) {
      expect(isWellFormedInstrumentId(id), id).toBe(false);
      expect(parseInstrumentId(id), id).toBeNull();
    }
  });

  it("resolves only catalogue members for the demo view", () => {
    expect(demoInstrumentById("NSE:RELIANCE:EQUITY")?.symbol).toBe("RELIANCE");
    expect(demoInstrumentById("NSE:NOTLISTED:EQUITY")).toBeNull();
    expect(DEMO_INSTRUMENTS).toHaveLength(16);
    expect(DEMO_TOP_STOCKS).toHaveLength(10);
  });
});

describe("stock card models", () => {
  beforeEach(() => {
    globalThis.fetch = realFetch;
  });

  it("labels demo models SAMPLE and attaches a deterministic sparkline", () => {
    const now = Date.now();
    const model = modelFromDemo(DEMO_TOP_STOCKS[0], now);
    expect(model.mode).toBe("SAMPLE");
    expect(model.source).toBe("sample");
    expect(model.sparkline.length).toBeGreaterThan(10);
    expect(model.lastPrice).toBeGreaterThan(0);
    expect(model.changePercent).not.toBeNull();

    const repeat = modelFromDemo(DEMO_TOP_STOCKS[0], now);
    expect(repeat.lastPrice).toBe(model.lastPrice);
    expect(repeat.sparkline).toEqual(model.sparkline);
  });

  it("keeps a missing quote empty rather than substituting fake prices", () => {
    const model = modelFromQuote(
      {
        instrumentId: "NSE:SBIN:EQUITY",
        symbol: "SBIN",
        name: "State Bank of India",
        exchange: "NSE",
        instrumentType: "EQUITY",
        isSampleData: false,
      },
      null,
      [123, 456]
    );
    expect(model.lastPrice).toBeNull();
    expect(model.changePercent).toBeNull();
    expect(model.sparkline).toEqual([]);
    expect(model.quoteTime).toBeNull();
  });

  it("passes through the server's freshness label for a real quote", () => {
    const model = modelFromQuote(
      {
        instrumentId: "NSE:SBIN:EQUITY",
        symbol: "SBIN",
        name: "State Bank of India",
        exchange: "NSE",
        instrumentType: "EQUITY",
        isSampleData: false,
      },
      {
        instrumentId: "NSE:SBIN:EQUITY",
        symbol: "SBIN",
        exchange: "NSE",
        lastPrice: 812.4,
        change: 4.1,
        changePercent: 0.51,
        open: 808,
        high: 815,
        low: 807,
        previousClose: 808.3,
        volume: 1_200_000,
        bid: 812.3,
        ask: 812.5,
        quoteTime: 1_700_000_000_000,
        source: "fyers",
        mode: "DELAYED",
      },
      [800, 805, 812]
    );
    expect(model.mode).toBe("DELAYED");
    expect(model.source).toBe("fyers");
    expect(model.sparkline).toHaveLength(3);
  });
});
