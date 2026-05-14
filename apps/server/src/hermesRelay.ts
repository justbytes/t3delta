import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import { Duplex, Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import {
  HermesClient,
  HermesGatewayError,
  parseSseEvents,
  type FetchLike,
  type HermesSseEvent,
} from "./hermesClient.ts";
import { loadHermesRelayConfig } from "./hermesEnv.ts";
import { handleHermesFileAccessRequest, type HermesFileAccessOptions } from "./hermesFileAccess.ts";

export interface HermesRelayOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly staticDir?: string;
  readonly gatewayUrl?: string;
  readonly apiKey?: string;
  readonly fetchImpl?: FetchLike;
  readonly fileAccess?: HermesFileAccessOptions;
}

export interface HermesRelayServer {
  readonly port: number;
  readonly stop: () => void;
}

interface WsClient {
  readonly id: string;
  readonly socket: Duplex;
}

type GatewayStatus = "reachable" | "unreachable";

interface GatewayStatusMonitor {
  readonly current: () => GatewayStatus;
  readonly refresh: () => Promise<GatewayStatus>;
  readonly mark: (status: GatewayStatus) => void;
  readonly stop: () => void;
}

const currentDir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : dirname(fileURLToPath(import.meta.url));
const defaultStaticDir = join(currentDir, "..", "..", "web", "dist");

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [key, value] of new Headers(
    init?.headers as ConstructorParameters<typeof Headers>[0],
  )) {
    headers.set(key, value);
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function writeGatewayError(response: ServerResponse, error: unknown): void {
  const message =
    error instanceof HermesGatewayError ? error.message : "Hermes Gateway request failed";
  const code = error instanceof HermesGatewayError ? error.code : "gateway_error";
  const status = error instanceof HermesGatewayError ? error.status : 502;
  writeJson(response, status, { error: { code, message } });
}

function isSafeStaticPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.includes(`..${sep}`));
}

async function writeStatic(
  response: ServerResponse,
  staticDir: string,
  pathname: string,
): Promise<boolean> {
  const decodedPath = decodeURIComponent(pathname);
  const cleanPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const candidate = join(staticDir, requested);

  if (!isSafeStaticPath(staticDir, candidate)) {
    writeJson(response, 400, {
      error: { code: "bad_static_path", message: "Invalid static path" },
    });
    return true;
  }

  const chosen =
    (await stat(candidate)
      .then((value) => (value.isFile() ? candidate : undefined))
      .catch(() => undefined)) ??
    (await stat(join(staticDir, "index.html"))
      .then((value) => (value.isFile() ? join(staticDir, "index.html") : undefined))
      .catch(() => undefined));

  if (!chosen) return false;

  response.writeHead(200, {
    "content-type": contentTypes[extname(chosen)] ?? "application/octet-stream",
  });
  createReadStream(chosen).pipe(response);
  return true;
}

async function staticResponse(staticDir: string, pathname: string): Promise<Response | undefined> {
  const decodedPath = decodeURIComponent(pathname);
  const cleanPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const candidate = join(staticDir, requested);

  if (!isSafeStaticPath(staticDir, candidate)) {
    return jsonResponse(
      { error: { code: "bad_static_path", message: "Invalid static path" } },
      { status: 400 },
    );
  }

  const chosen =
    (await stat(candidate)
      .then((value) => (value.isFile() ? candidate : undefined))
      .catch(() => undefined)) ??
    (await stat(join(staticDir, "index.html"))
      .then((value) => (value.isFile() ? join(staticDir, "index.html") : undefined))
      .catch(() => undefined));

  if (!chosen) return undefined;
  return new Response(Bun.file(chosen), {
    headers: { "content-type": contentTypes[extname(chosen)] ?? "application/octet-stream" },
  });
}

function shouldBridgeSse(response: Response, bodyText: string | undefined): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) return true;
  if (!bodyText) return false;
  try {
    const body = JSON.parse(bodyText) as { stream?: unknown };
    return body.stream === true;
  } catch {
    return false;
  }
}

function bridgeSseBody(
  body: ReadableStream<Uint8Array>,
  broadcast: (event: HermesSseEvent) => void,
  onInterrupted: (error: unknown) => void,
): ReadableStream<Uint8Array> {
  const textDecoder = new TextDecoder();
  let remainder = "";
  let sawTerminalEvent = false;
  let cancellationRequested = false;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (cancellationRequested) return;
        if (result.done) {
          const finalText = remainder + textDecoder.decode();
          const parsed = parseSseEvents(
            finalText.endsWith("\n\n") ? finalText : `${finalText}\n\n`,
          );
          for (const event of parsed.events) {
            if (isTerminalSseEvent(event)) sawTerminalEvent = true;
            broadcast(event);
          }
          if (!sawTerminalEvent && !cancellationRequested) {
            onInterrupted(new Error("SSE stream ended before a terminal response event"));
          }
          controller.close();
          return;
        }

        const chunk = result.value;
        controller.enqueue(chunk);
        const parsed = parseSseEvents(remainder + textDecoder.decode(chunk, { stream: true }));
        remainder = parsed.remainder;
        for (const event of parsed.events) {
          if (isTerminalSseEvent(event)) sawTerminalEvent = true;
          broadcast(event);
        }
      } catch (error) {
        if (!cancellationRequested) {
          onInterrupted(error);
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      cancellationRequested = true;
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function isTerminalSseEvent(event: HermesSseEvent): boolean {
  return (
    event.data === "[DONE]" ||
    event.event === "response.completed" ||
    event.event === "response.failed" ||
    event.event === "response.cancelled" ||
    event.event === "response.canceled"
  );
}

function sseInterruptedMessage(_error: unknown): string {
  return JSON.stringify({
    type: "hermes.sse.interrupted",
    error: {
      code: "sse_stream_interrupted",
      message: "Hermes SSE stream interrupted unexpectedly",
    },
  });
}

function createGatewayStatusMonitor(
  client: HermesClient,
  sendStatus: (status: GatewayStatus) => void,
): GatewayStatusMonitor {
  let status: GatewayStatus = "reachable";
  let stopped = false;
  let refreshInFlight: Promise<GatewayStatus> | undefined;

  const mark = (nextStatus: GatewayStatus) => {
    if (status === nextStatus) return;
    status = nextStatus;
    sendStatus(nextStatus);
  };

  const refresh = async () => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = client
      .health()
      .then((nextStatus) => {
        mark(nextStatus);
        return nextStatus;
      })
      .finally(() => {
        refreshInFlight = undefined;
      });
    return refreshInFlight;
  };

  const interval = setInterval(() => {
    if (!stopped) void refresh();
  }, 5_000);
  if (typeof (interval as NodeJS.Timeout).unref === "function") {
    (interval as NodeJS.Timeout).unref();
  }
  void refresh();

  return {
    current: () => status,
    refresh,
    mark,
    stop: () => {
      stopped = true;
      clearInterval(interval);
    },
  };
}

async function writeUpstreamBody(
  response: ServerResponse,
  upstream: Response,
  bodyText: string | undefined,
  broadcast: (event: HermesSseEvent) => void,
  onInterrupted: (error: unknown) => void,
): Promise<void> {
  response.writeHead(
    upstream.status,
    upstream.statusText,
    Object.fromEntries(
      new HermesClient({ gatewayUrl: "http://unused" }).proxyResponseHeaders(upstream.headers),
    ),
  );

  if (!upstream.body) {
    response.end();
    return;
  }

  const body = shouldBridgeSse(upstream, bodyText)
    ? bridgeSseBody(upstream.body, broadcast, onInterrupted)
    : upstream.body;
  Readable.fromWeb(body as never).pipe(response);
}

async function readNodeRequestBody(request: IncomingMessage): Promise<string | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Array<Buffer> = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function nodeRequestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (
      [
        "connection",
        "host",
        "keep-alive",
        "origin",
        "referer",
        "transfer-encoding",
        "upgrade",
      ].includes(lower)
    ) {
      continue;
    }
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function hermesGatewayRequestHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const name of [
    "connection",
    "host",
    "keep-alive",
    "origin",
    "referer",
    "transfer-encoding",
    "upgrade",
  ]) {
    headers.delete(name);
  }
  return headers;
}

function encodeWebSocketFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  if (payload.length < 65_536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function sendWs(client: WsClient, message: string): void {
  if (!client.socket.destroyed) client.socket.write(encodeWebSocketFrame(message));
}

function makeClient(options: HermesRelayOptions): HermesClient {
  const envConfig = loadHermesRelayConfig();
  const clientOptions = {
    gatewayUrl: options.gatewayUrl ?? envConfig.gatewayUrl,
    ...((options.apiKey ?? envConfig.apiKey)
      ? { apiKey: (options.apiKey ?? envConfig.apiKey) as string }
      : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  return new HermesClient(clientOptions);
}

function startBunHermesRelay(options: HermesRelayOptions): HermesRelayServer {
  const client = makeClient(options);
  const staticDir = options.staticDir ?? defaultStaticDir;
  const clients = new Set<Bun.ServerWebSocket<{ readonly id: string }>>();
  const broadcastMessage = (message: string) => {
    for (const ws of clients) ws.send(message);
  };
  const broadcast = (event: HermesSseEvent) => {
    const message = JSON.stringify({ type: "hermes.sse", ...event });
    broadcastMessage(message);
  };
  const monitor = createGatewayStatusMonitor(client, (status) =>
    broadcastMessage(JSON.stringify({ type: "gateway.status", status })),
  );
  const markGatewayUnreachable = () => monitor.mark("unreachable");
  const markGatewayReachable = () => monitor.mark("reachable");
  const reportSseInterrupted = (error: unknown) => {
    markGatewayUnreachable();
    broadcastMessage(sseInterruptedMessage(error));
  };

  const server = Bun.serve<{ readonly id: string }>({
    port: options.port ?? Number(process.env.T3CODE_PORT ?? process.env.PORT ?? 3773),
    ...((options.hostname ?? process.env.T3CODE_HOST)
      ? { hostname: (options.hostname ?? process.env.T3CODE_HOST) as string }
      : {}),
    async fetch(request, server) {
      const url = new URL(request.url);

      if (url.pathname === "/ws" || url.pathname === "/api/ws") {
        return server.upgrade(request, { data: { id: crypto.randomUUID() } })
          ? undefined
          : jsonResponse(
              { error: { code: "ws_upgrade_failed", message: "WebSocket upgrade failed" } },
              { status: 400 },
            );
      }

      if (url.pathname === "/health") {
        return jsonResponse({ status: "ok", gateway: await monitor.refresh() });
      }

      const fileAccessResponse = await handleHermesFileAccessRequest(request, options.fileAccess);
      if (fileAccessResponse) return fileAccessResponse;

      if (url.pathname.startsWith("/api/hermes/")) {
        const body =
          request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
        try {
          const upstream = await client.proxy(
            `${url.pathname.slice("/api/hermes".length)}${url.search}`,
            {
              method: request.method,
              headers: hermesGatewayRequestHeaders(request.headers),
              ...(body === undefined ? {} : { body }),
            },
          );
          markGatewayReachable();
          const responseBody =
            upstream.body && shouldBridgeSse(upstream, body)
              ? bridgeSseBody(upstream.body, broadcast, reportSseInterrupted)
              : upstream.body;
          return new Response(responseBody, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: client.proxyResponseHeaders(upstream.headers),
          });
        } catch (error) {
          if (error instanceof HermesGatewayError) markGatewayUnreachable();
          const message =
            error instanceof HermesGatewayError ? error.message : "Hermes Gateway request failed";
          const code = error instanceof HermesGatewayError ? error.code : "gateway_error";
          const status = error instanceof HermesGatewayError ? error.status : 502;
          return jsonResponse({ error: { code, message } }, { status });
        }
      }

      return (
        (await staticResponse(staticDir, url.pathname)) ??
        jsonResponse({ error: { code: "not_found", message: "Not found" } }, { status: 404 })
      );
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "relay.connected", id: ws.data.id }));
        ws.send(JSON.stringify({ type: "gateway.status", status: monitor.current() }));
      },
      close(ws) {
        clients.delete(ws);
      },
      message(ws, message) {
        if (message === "ping") ws.send("pong");
      },
    },
  });

  console.log(`Hermes relay listening on http://${server.hostname}:${server.port}`);
  return {
    port: server.port ?? options.port ?? 3773,
    stop: () => {
      monitor.stop();
      server.stop(true);
    },
  };
}

export function startHermesRelay(options: HermesRelayOptions = {}): HermesRelayServer {
  if (typeof Bun !== "undefined") return startBunHermesRelay(options);

  const client = makeClient(options);
  const staticDir = options.staticDir ?? defaultStaticDir;
  const clients = new Set<WsClient>();

  const broadcastMessage = (message: string) => {
    for (const ws of clients) sendWs(ws, message);
  };
  const broadcast = (event: HermesSseEvent) => {
    const message = JSON.stringify({ type: "hermes.sse", ...event });
    broadcastMessage(message);
  };
  const monitor = createGatewayStatusMonitor(client, (status) =>
    broadcastMessage(JSON.stringify({ type: "gateway.status", status })),
  );
  const markGatewayUnreachable = () => monitor.mark("unreachable");
  const markGatewayReachable = () => monitor.mark("reachable");
  const reportSseInterrupted = (error: unknown) => {
    markGatewayUnreachable();
    broadcastMessage(sseInterruptedMessage(error));
  };

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      const gateway = await monitor.refresh();
      writeJson(response, 200, { status: "ok", gateway });
      return;
    }

    if (
      url.pathname === "/api/skills" ||
      url.pathname.startsWith("/api/skills/") ||
      url.pathname === "/api/memory" ||
      url.pathname.startsWith("/api/memory/") ||
      url.pathname === "/api/sessions" ||
      url.pathname.startsWith("/api/sessions/") ||
      url.pathname === "/api/workspace/files"
    ) {
      const fileAccessRequest = new Request(
        `http://${request.headers.host ?? "localhost"}${request.url ?? "/"}`,
        {
          method: request.method ?? "GET",
          headers: nodeRequestHeaders(request),
          ...(request.method === "GET" || request.method === "HEAD"
            ? {}
            : { body: await readNodeRequestBody(request) }),
        },
      );
      const fileAccessResponse = await handleHermesFileAccessRequest(
        fileAccessRequest,
        options.fileAccess,
      );
      if (fileAccessResponse) {
        response.writeHead(
          fileAccessResponse.status,
          fileAccessResponse.statusText,
          Object.fromEntries(fileAccessResponse.headers),
        );
        if (fileAccessResponse.body)
          Readable.fromWeb(fileAccessResponse.body as never).pipe(response);
        else response.end();
        return;
      }
    }

    if (url.pathname.startsWith("/api/hermes/")) {
      const pathAndSearch = `${url.pathname.slice("/api/hermes".length)}${url.search}`;
      const body = await readNodeRequestBody(request);
      try {
        const upstream = await client.proxy(pathAndSearch, {
          method: request.method ?? "GET",
          headers: nodeRequestHeaders(request),
          ...(body === undefined ? {} : { body }),
        });
        markGatewayReachable();
        await writeUpstreamBody(response, upstream, body, broadcast, reportSseInterrupted);
      } catch (error) {
        if (error instanceof HermesGatewayError) markGatewayUnreachable();
        writeGatewayError(response, error);
      }
      return;
    }

    if (await writeStatic(response, staticDir, url.pathname)) return;
    writeJson(response, 404, { error: { code: "not_found", message: "Not found" } });
  });

  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/ws" && url.pathname !== "/api/ws") {
      socket.destroy();
      return;
    }

    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }

    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );

    const wsClient = { id: crypto.randomUUID(), socket };
    clients.add(wsClient);
    sendWs(wsClient, JSON.stringify({ type: "relay.connected", id: wsClient.id }));
    sendWs(wsClient, JSON.stringify({ type: "gateway.status", status: monitor.current() }));
    socket.on("close", () => clients.delete(wsClient));
    socket.on("error", () => clients.delete(wsClient));
  });

  const port = options.port ?? Number(process.env.T3CODE_PORT ?? process.env.PORT ?? 3773);
  const hostname = options.hostname ?? process.env.T3CODE_HOST;
  server.listen(port, hostname);
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`Hermes relay listening on http://${hostname ?? "0.0.0.0"}:${actualPort}`);
  return {
    port: actualPort,
    stop: () => {
      monitor.stop();
      server.close();
    },
  };
}
