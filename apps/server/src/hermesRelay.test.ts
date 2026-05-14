import { afterEach, describe, expect, it } from "vitest";

import type { FetchLike } from "./hermesClient.ts";
import { startHermesRelay, type HermesRelayServer } from "./hermesRelay.ts";

const servers: Array<HermesRelayServer> = [];

function startTestRelay(fetchImpl: FetchLike): HermesRelayServer {
  const server = startHermesRelay({
    port: 0,
    gatewayUrl: "http://hermes.local",
    apiKey: "test-key",
    fetchImpl,
    staticDir: "/tmp/t3delta-empty-static",
  });
  servers.push(server);
  return server;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

describe("Hermes relay", () => {
  it("serves health with gateway reachability", async () => {
    const server = startTestRelay(async (url) => {
      expect(String(url)).toBe("http://hermes.local/health");
      return new Response("ok");
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", gateway: "reachable" });
  });

  it("proxies Hermes API requests with Bearer auth", async () => {
    const server = startTestRelay(async (url, init) => {
      expect(String(url)).toBe("http://hermes.local/v1/models?limit=1");
      expect(init?.headers).toBeDefined();
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
      return Response.json({ data: [{ id: "model-a" }] });
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/api/hermes/v1/models?limit=1`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: [{ id: "model-a" }] });
  });

  it("returns a structured gateway error when Hermes is unreachable", async () => {
    const server = startTestRelay(async () => {
      throw new Error("ECONNREFUSED");
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/api/hermes/v1/models`);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "gateway_unreachable",
        message: "Hermes Gateway is not reachable",
      },
    });
  });

  it("bridges streamed Hermes SSE events to WebSocket clients", async () => {
    const server = startTestRelay(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: response.created\ndata: {"id":"resp_1"}\n\n' +
                  'event: response.completed\ndata: {"id":"resp_1"}\n\n',
              ),
            );
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const messages: Array<unknown> = [];
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));

    const response = await fetch(`http://127.0.0.1:${server.port}/api/hermes/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hello", stream: true }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("response.completed");
    await new Promise((resolve) => setTimeout(resolve, 20));
    ws.close();

    expect(messages).toContainEqual({
      type: "hermes.sse",
      event: "response.created",
      id: undefined,
      retry: undefined,
      data: { id: "resp_1" },
    });
    expect(messages).toContainEqual({
      type: "hermes.sse",
      event: "response.completed",
      id: undefined,
      retry: undefined,
      data: { id: "resp_1" },
    });
  });
});
