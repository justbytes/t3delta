import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FetchLike } from "./hermesClient.ts";
import { startHermesRelay, type HermesRelayServer } from "./hermesRelay.ts";

const servers: Array<HermesRelayServer> = [];
const tempDirs: Array<string> = [];

function startTestRelay(
  fetchImpl: FetchLike,
  options: Parameters<typeof startHermesRelay>[0] = {},
): HermesRelayServer {
  const server = startHermesRelay({
    port: 0,
    gatewayUrl: "http://hermes.local",
    apiKey: "test-key",
    fetchImpl,
    staticDir: "/tmp/t3delta-empty-static",
    ...options,
  });
  servers.push(server);
  return server;
}

async function makeHermesFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "t3delta-hermes-"));
  tempDirs.push(root);
  await mkdir(join(root, "skills", "creative", "pixel-art"), { recursive: true });
  await mkdir(join(root, "memories"), { recursive: true });
  await mkdir(join(root, "sessions"), { recursive: true });
  await writeFile(
    join(root, "skills", "creative", "pixel-art", "SKILL.md"),
    "---\nname: pixel-art\ndescription: Make pixel art\n---\n# Pixel Art\n",
  );
  await writeFile(join(root, "memories", "MEMORY.md"), "remember this");
  await writeFile(join(root, "memories", "USER.md"), "user facts");
  await writeFile(
    join(root, "sessions", "session_abc.json"),
    JSON.stringify({
      session_id: "abc",
      last_updated: "2026-05-14T10:00:00Z",
      messages: [{ role: "user", content: "First prompt" }],
    }),
  );
  return root;
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  return Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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

  it("notifies WebSocket clients when the Gateway becomes unreachable and reachable again", async () => {
    let healthy = true;
    const hermesDir = await makeHermesFixture();
    const server = startTestRelay(
      async (url) => {
        if (String(url) === "http://hermes.local/health") {
          return healthy ? new Response("ok") : new Response("down", { status: 503 });
        }
        if (!healthy) throw new Error("ECONNREFUSED");
        return Response.json({ data: [] });
      },
      {
        fileAccess: { hermesDir },
      },
    );
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const messages: Array<unknown> = [];
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    ws.addEventListener("message", (event) => messages.push(JSON.parse(String(event.data))));

    healthy = false;
    const downResponse = await fetch(`http://127.0.0.1:${server.port}/api/hermes/v1/models`);
    expect(downResponse.status).toBe(502);
    const sessionsWhileDown = await fetch(`http://127.0.0.1:${server.port}/api/sessions`);
    expect(sessionsWhileDown.status).toBe(200);
    expect(await sessionsWhileDown.json()).toEqual([
      { id: "abc", title: "First prompt", lastActivity: "2026-05-14T10:00:00Z" },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messages).toContainEqual({ type: "gateway.status", status: "unreachable" });

    healthy = true;
    const healthResponse = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(await healthResponse.json()).toEqual({ status: "ok", gateway: "reachable" });

    await new Promise((resolve) => setTimeout(resolve, 20));
    ws.close();
    expect(messages).toContainEqual({ type: "gateway.status", status: "reachable" });
  });

  it("reports SSE stream interruptions to WebSocket clients", async () => {
    const server = startTestRelay(async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: response.created\ndata: {"id":"resp_1"}\n\n' +
                  'event: response.content_part.delta\ndata: {"delta":"partial"}\n\n',
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

    await fetch(`http://127.0.0.1:${server.port}/api/hermes/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hello", stream: true }),
    })
      .then((response) => response.text())
      .catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 20));
    ws.close();

    expect(messages).toContainEqual({
      type: "hermes.sse.interrupted",
      error: {
        code: "sse_stream_interrupted",
        message: "Hermes SSE stream interrupted unexpectedly",
      },
    });
  });

  it("uses independent UTF-8 decoders for concurrent SSE streams", async () => {
    const encoder = new TextEncoder();
    let responseRequests = 0;
    let firstController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const server = startTestRelay(async (url) => {
      if (String(url).endsWith("/health")) return new Response("ok");
      responseRequests += 1;
      if (responseRequests === 1) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              firstController = controller;
              controller.enqueue(
                Uint8Array.from([
                  ...encoder.encode("event: response.content_part.delta\ndata: "),
                  0xe2,
                ]),
              );
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode('event: response.completed\ndata: {"id":"resp_2"}\n\n'),
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

    const firstResponse = await fetch(`http://127.0.0.1:${server.port}/api/hermes/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "first", stream: true }),
    });
    const firstReader = firstResponse.body!.getReader();
    await firstReader.read();

    const secondResponse = await fetch(`http://127.0.0.1:${server.port}/api/hermes/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "second", stream: true }),
    });
    expect(await secondResponse.text()).toContain("response.completed");

    firstController?.enqueue(
      Uint8Array.from([
        0x82,
        0xac,
        ...encoder.encode('\n\nevent: response.completed\ndata: {"id":"resp_1"}\n\n'),
      ]),
    );
    firstController?.close();
    await firstReader.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));
    ws.close();

    expect(messages).toContainEqual({
      type: "hermes.sse",
      event: "response.completed",
      id: undefined,
      retry: undefined,
      data: { id: "resp_2" },
    });
  });

  it("does not report SSE interruption when the downstream client cancels the stream", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const server = startTestRelay(async (_url, init) => {
      upstreamSignal = init?.signal ?? undefined;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('event: response.created\ndata: {"id":"resp_cancel"}\n\n'),
            );
          },
          pull() {
            return new Promise(() => undefined);
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

    const abortController = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server.port}/api/hermes/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "cancel me", stream: true }),
      signal: abortController.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    abortController.abort();
    await reader.read().catch(() => undefined);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(upstreamSignal?.aborted).toBe(true);
    ws.close();
    expect(messages).not.toContainEqual({
      type: "hermes.sse.interrupted",
      error: {
        code: "sse_stream_interrupted",
        message: "Hermes SSE stream interrupted unexpectedly",
      },
    });
  });

  it("lists skills and reads skill content from the Hermes skills directory", async () => {
    const hermesDir = await makeHermesFixture();
    const server = startTestRelay(async () => Response.json({}), {
      fileAccess: { hermesDir },
    });

    const listResponse = await fetch(`http://127.0.0.1:${server.port}/api/skills`);
    const readResponse = await fetch(`http://127.0.0.1:${server.port}/api/skills/pixel-art`);

    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      { name: "pixel-art", description: "Make pixel art", category: "creative" },
    ]);
    expect(readResponse.status).toBe(200);
    expect(await readResponse.text()).toContain("# Pixel Art");
  });

  it("skips symlinked skill directories to avoid escaping the Hermes skills root", async () => {
    const hermesDir = await makeHermesFixture();
    const outsideDir = await mkdtemp(join(tmpdir(), "t3delta-outside-skill-"));
    tempDirs.push(outsideDir);
    await writeFile(
      join(outsideDir, "SKILL.md"),
      "---\nname: escaped-skill\ndescription: Should not be visible\n---\n# Escaped\n",
    );
    await symlink(outsideDir, join(hermesDir, "skills", "escaped-link"), "dir");
    const server = startTestRelay(async () => Response.json({}), {
      fileAccess: { hermesDir },
    });

    const listResponse = await fetch(`http://127.0.0.1:${server.port}/api/skills`);
    const escapedReadResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/skills/escaped-skill`,
    );

    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      { name: "pixel-art", description: "Make pixel art", category: "creative" },
    ]);
    expect(escapedReadResponse.status).toBe(404);
  });

  it("reads and writes Hermes memory files", async () => {
    const hermesDir = await makeHermesFixture();
    const server = startTestRelay(async () => Response.json({}), {
      fileAccess: { hermesDir },
    });

    const readBefore = await fetch(`http://127.0.0.1:${server.port}/api/memory`);
    const writeResponse = await fetch(`http://127.0.0.1:${server.port}/api/memory/memory`, {
      method: "PUT",
      body: "updated memory",
    });
    const readAfter = await fetch(`http://127.0.0.1:${server.port}/api/memory`);

    expect(readBefore.status).toBe(200);
    expect(await readBefore.json()).toEqual({ memory: "remember this", user: "user facts" });
    expect(writeResponse.status).toBe(200);
    expect(await writeResponse.json()).toMatchObject({ success: true, file: "memory" });
    expect(await readAfter.json()).toEqual({ memory: "updated memory", user: "user facts" });
  });

  it("lists session metadata and reads a session transcript", async () => {
    const hermesDir = await makeHermesFixture();
    const server = startTestRelay(async () => Response.json({}), {
      fileAccess: { hermesDir },
    });

    const listResponse = await fetch(`http://127.0.0.1:${server.port}/api/sessions`);
    const transcriptResponse = await fetch(`http://127.0.0.1:${server.port}/api/sessions/abc`);

    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual([
      { id: "abc", title: "First prompt", lastActivity: "2026-05-14T10:00:00Z" },
    ]);
    expect(transcriptResponse.status).toBe(200);
    expect(await transcriptResponse.json()).toMatchObject({
      session_id: "abc",
      messages: [{ role: "user", content: "First prompt" }],
    });
  });

  it("filters session metadata by transcript keyword for search", async () => {
    const hermesDir = await makeHermesFixture();
    await writeFile(
      join(hermesDir, "sessions", "session_def.json"),
      JSON.stringify({
        session_id: "def",
        last_updated: "2026-05-14T11:00:00Z",
        messages: [{ role: "user", content: "Need help with pixel art" }],
      }),
    );
    const server = startTestRelay(async () => Response.json({}), {
      fileAccess: { hermesDir },
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/api/sessions?q=pixel`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { id: "def", title: "Need help with pixel art", lastActivity: "2026-05-14T11:00:00Z" },
    ]);
    server.stop();
  });

  it("runs Hermes skills install and uninstall commands through file-access endpoints", async () => {
    const hermesDir = await makeHermesFixture();
    const commands: Array<ReadonlyArray<string>> = [];
    const server = startTestRelay(async () => Response.json({}), {
      fileAccess: {
        hermesDir,
        commandRunner: async (command, args) => {
          commands.push([command, ...args]);
          return { stdout: "ok", stderr: "" };
        },
      },
    });

    const installResponse = await fetch(`http://127.0.0.1:${server.port}/api/skills/install`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identifier: "openai/skills/example" }),
    });
    const uninstallResponse = await fetch(`http://127.0.0.1:${server.port}/api/skills/pixel-art`, {
      method: "DELETE",
    });

    expect(installResponse.status).toBe(200);
    expect(uninstallResponse.status).toBe(200);
    expect(commands).toEqual([
      ["hermes", "skills", "install", "openai/skills/example", "--yes"],
      ["hermes", "skills", "uninstall", "pixel-art"],
    ]);
  });

  it("returns informative 404s for missing Hermes files", async () => {
    const hermesDir = await mkdtemp(join(tmpdir(), "t3delta-hermes-missing-"));
    tempDirs.push(hermesDir);
    const server = startTestRelay(async () => Response.json({}), {
      fileAccess: { hermesDir },
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/api/skills`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "skills_not_found",
        message: "Hermes skills directory was not found",
      },
    });
  });
});
