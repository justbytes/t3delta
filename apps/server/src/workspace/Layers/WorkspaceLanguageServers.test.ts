import { EventEmitter } from "node:events";

import { describe, expect, it } from "@effect/vitest";

import { StdioJsonRpcClient } from "./WorkspaceLanguageServers.ts";

class FakeChildProcess {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdinWrites: Buffer[] = [];
  readonly stdin = {
    write: (chunk: string | Uint8Array) => {
      this.stdinWrites.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
  };
}

function encodeJsonRpcMessage(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  return Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"), payload]);
}

function decodeJsonRpcMessages(chunks: readonly Buffer[]): unknown[] {
  let buffer = Buffer.concat(chunks);
  const messages: unknown[] = [];

  while (buffer.length > 0) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      break;
    }

    const headerText = buffer.subarray(0, headerEnd).toString("utf8");
    const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
    if (!lengthMatch) {
      throw new Error("Missing Content-Length header.");
    }

    const contentLength = Number.parseInt(lengthMatch[1] ?? "0", 10);
    const payloadStart = headerEnd + 4;
    const payloadEnd = payloadStart + contentLength;
    if (buffer.length < payloadEnd) {
      break;
    }

    messages.push(JSON.parse(buffer.subarray(payloadStart, payloadEnd).toString("utf8")));
    buffer = buffer.subarray(payloadEnd);
  }

  return messages;
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("StdioJsonRpcClient", () => {
  it("responds to server initiated requests", async () => {
    const child = new FakeChildProcess();
    const client = new StdioJsonRpcClient(
      child as never,
      () => undefined,
      (method, params) => {
        expect(method).toBe("workspace/configuration");
        expect(params).toEqual({
          items: [{ section: "html" }, { section: "css" }],
        });
        return [{ format: {} }, { validate: true }];
      },
    );

    child.stdout.emit(
      "data",
      encodeJsonRpcMessage({
        jsonrpc: "2.0",
        id: 7,
        method: "workspace/configuration",
        params: {
          items: [{ section: "html" }, { section: "css" }],
        },
      }),
    );

    await flushMicrotasks();

    expect(decodeJsonRpcMessages(child.stdinWrites)).toEqual([
      {
        jsonrpc: "2.0",
        id: 7,
        result: [{ format: {} }, { validate: true }],
      },
    ]);

    client.dispose();
  });

  it("continues forwarding notifications without responses", async () => {
    const child = new FakeChildProcess();
    const notifications: Array<{ method: string; params: unknown }> = [];
    const client = new StdioJsonRpcClient(child as never, (method, params) => {
      notifications.push({ method, params });
    });

    child.stdout.emit(
      "data",
      encodeJsonRpcMessage({
        jsonrpc: "2.0",
        method: "textDocument/publishDiagnostics",
        params: {
          uri: "file:///tmp/example.html",
          diagnostics: [],
        },
      }),
    );

    await flushMicrotasks();

    expect(notifications).toEqual([
      {
        method: "textDocument/publishDiagnostics",
        params: {
          uri: "file:///tmp/example.html",
          diagnostics: [],
        },
      },
    ]);
    expect(child.stdinWrites).toHaveLength(0);

    client.dispose();
  });
});
