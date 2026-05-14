export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type HeadersInput = ConstructorParameters<typeof Headers>[0];

export interface HermesClientOptions {
  readonly gatewayUrl: string;
  readonly apiKey?: string;
  readonly fetchImpl?: FetchLike;
}

export interface HermesSseEvent {
  readonly event: string | undefined;
  readonly data: unknown;
  readonly id: string | undefined;
  readonly retry: number | undefined;
}

export class HermesGatewayError extends Error {
  readonly status = 502;
  readonly code = "gateway_unreachable";

  constructor(cause: unknown) {
    super("Hermes Gateway is not reachable", { cause });
    this.name = "HermesGatewayError";
  }
}

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function copyHeaders(headers: Headers): Headers {
  const output = new Headers();
  for (const [key, value] of headers) {
    if (!hopByHopHeaders.has(key.toLowerCase())) output.set(key, value);
  }
  return output;
}

function parseSseBlock(block: string): HermesSseEvent | undefined {
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const dataLines: Array<string> = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    const value = colonIndex === -1 ? "" : line.slice(colonIndex + 1).replace(/^ /, "");

    if (field === "event") event = value;
    if (field === "id") id = value;
    if (field === "retry") retry = Number(value);
    if (field === "data") dataLines.push(value);
  }

  if (dataLines.length === 0 && event === undefined && id === undefined) return undefined;

  const dataText = dataLines.join("\n");
  let data: unknown = dataText;
  if (dataText && dataText !== "[DONE]") {
    try {
      data = JSON.parse(dataText);
    } catch {
      data = dataText;
    }
  }

  return { event, data, id, retry };
}

export function parseSseEvents(text: string): {
  readonly events: ReadonlyArray<HermesSseEvent>;
  readonly remainder: string;
} {
  const normalized = text.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const remainder = parts.pop() ?? "";
  const events = parts.flatMap((part) => {
    const event = parseSseBlock(part);
    return event ? [event] : [];
  });
  return { events, remainder };
}

export class HermesClient {
  readonly #gatewayUrl: string;
  readonly #apiKey: string | undefined;
  readonly #fetch: FetchLike;

  constructor(options: HermesClientOptions) {
    this.#gatewayUrl = options.gatewayUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  headers(input?: HeadersInput): Headers {
    const headers = new Headers(input);
    if (this.#apiKey) headers.set("authorization", `Bearer ${this.#apiKey}`);
    return headers;
  }

  async health(): Promise<"reachable" | "unreachable"> {
    try {
      const response = await this.#fetch(`${this.#gatewayUrl}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok ? "reachable" : "unreachable";
    } catch {
      return "unreachable";
    }
  }

  async proxy(pathAndSearch: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(`${this.#gatewayUrl}${pathAndSearch}`, {
        ...init,
        headers: this.headers(init.headers),
      });
    } catch (cause) {
      throw new HermesGatewayError(cause);
    }
  }

  proxyResponseHeaders(headers: Headers): Headers {
    return copyHeaders(headers);
  }
}
