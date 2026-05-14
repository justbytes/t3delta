import { describe, expect, it } from "vitest";

import { HermesClient, HermesGatewayError, parseSseEvents } from "./hermesClient.ts";

describe("parseSseEvents", () => {
  it("parses named JSON SSE events and preserves incomplete remainder", () => {
    const parsed = parseSseEvents(
      'id: 1\nevent: response.created\ndata: {"id":"resp_1"}\n\n' +
        "event: response.completed\ndata:",
    );

    expect(parsed.events).toEqual([
      {
        id: "1",
        event: "response.created",
        data: { id: "resp_1" },
        retry: undefined,
      },
    ]);
    expect(parsed.remainder).toBe("event: response.completed\ndata:");
  });
});

describe("HermesClient", () => {
  it("adds Bearer authentication when proxying requests", async () => {
    const seen = new Headers();
    const client = new HermesClient({
      gatewayUrl: "http://hermes.local",
      apiKey: "secret-key",
      fetchImpl: async (_url, init) => {
        for (const [key, value] of new Headers(init?.headers)) seen.set(key, value);
        return new Response(JSON.stringify({ data: [] }));
      },
    });

    await client.proxy("/v1/models", { method: "GET" });

    expect(seen.get("authorization")).toBe("Bearer secret-key");
  });

  it("turns fetch failures into structured gateway errors", async () => {
    const client = new HermesClient({
      gatewayUrl: "http://hermes.local",
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
    });

    await expect(client.proxy("/v1/models", { method: "GET" })).rejects.toBeInstanceOf(
      HermesGatewayError,
    );
  });
});
