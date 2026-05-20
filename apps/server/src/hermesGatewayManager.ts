import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { execFile, type ChildProcess, spawn } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { mkdir, readlink, rm, symlink } from "node:fs/promises";

import { Context, Data, Effect, Exit, Layer, Ref } from "effect";

import { loadHermesRelayConfig } from "./hermesEnv.ts";
import { HermesClient } from "./hermesClient.ts";
import { ServerSettingsService } from "./serverSettings.ts";
import type { ThreadId } from "@t3delta/contracts";

const execFileAsync = promisify(execFile);

export class HermesGatewayManagerError extends Data.TaggedError("HermesGatewayManagerError")<{
  readonly code:
    | "binary_not_found"
    | "failed_to_spawn"
    | "health_timeout"
    | "port_unavailable"
    | "filesystem_error";
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export interface HermesGatewayHandle {
  readonly gatewayUrl: string;
  readonly apiKey?: string;
}

export interface HermesGatewayManagerShape {
  readonly acquire: (input: {
    readonly threadId: ThreadId;
    readonly cwd: string;
  }) => Effect.Effect<HermesGatewayHandle, HermesGatewayManagerError>;
  readonly release: (threadId: ThreadId) => Effect.Effect<void>;
  readonly stopAll: Effect.Effect<void>;
}

interface ManagedGateway extends HermesGatewayHandle {
  readonly cwd: string;
  readonly port: number;
  readonly hermesHome: string;
  readonly child: ChildProcess;
  readonly threadIds: Set<ThreadId>;
}

interface ManagerState {
  readonly byCwd: Map<string, ManagedGateway>;
  readonly cwdByThreadId: Map<ThreadId, string>;
}

const sharedEntries = [
  "skills",
  "memories",
  "cache",
  "images",
  "audio_cache",
  "image_cache",
  "pastes",
  "bin",
  "auth.json",
  "auth.lock",
  "config.yaml",
  "SOUL.md",
  ".env",
] as const;

function projectKey(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}

function defaultHermesHomeRoot(): string {
  return join(homedir(), ".t3delta", "hermes-homes");
}

async function readAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) resolve(address.port);
        else reject(new Error("Failed to allocate an ephemeral port"));
      });
    });
  });
}

async function ensureSharedHermesHome(hermesHome: string): Promise<void> {
  const sourceHome = join(homedir(), ".hermes");
  await mkdir(hermesHome, { recursive: true });
  await mkdir(join(hermesHome, "logs"), { recursive: true });
  await mkdir(join(hermesHome, "sessions"), { recursive: true });

  for (const entry of sharedEntries) {
    const source = join(sourceHome, entry);
    const target = join(hermesHome, entry);
    await mkdir(dirname(target), { recursive: true });
    const existing = await readlink(target).catch(() => undefined);
    if (existing === source) continue;
    if (existing !== undefined) {
      await rm(target, { force: true });
    }
    await symlink(source, target).catch((cause) => {
      const code = cause && typeof cause === "object" ? (cause as { code?: unknown }).code : null;
      if (code !== "EEXIST" && code !== "ENOENT") throw cause;
    });
  }
}

async function resolveHermesBinary(explicitPath: string | undefined): Promise<string> {
  const candidate = [explicitPath, process.env.HERMES_BIN].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (candidate) return candidate;

  const command = process.platform === "win32" ? "where" : "which";
  const { stdout } = await execFileAsync(command, ["hermes"]);
  const resolved = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!resolved) throw new Error("hermes binary not found on PATH");
  return resolved;
}

async function waitForHealth(handle: HermesGatewayHandle): Promise<void> {
  const client = new HermesClient({
    gatewayUrl: handle.gatewayUrl,
    ...(handle.apiKey ? { apiKey: handle.apiKey } : {}),
  });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if ((await client.health()) === "reachable") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Hermes gateway did not become healthy at ${handle.gatewayUrl}`);
}

function stopChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
  }, 2_000).unref();
}

export class HermesGatewayManager extends Context.Service<
  HermesGatewayManager,
  HermesGatewayManagerShape
>()("t3/provider/HermesGatewayManager") {}

export const HermesGatewayManagerLive = Layer.effect(
  HermesGatewayManager,
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    const stateRef = yield* Ref.make<ManagerState>({
      byCwd: new Map(),
      cwdByThreadId: new Map(),
    });

    const stopGateway = (gateway: ManagedGateway) =>
      Effect.sync(() => {
        stopChild(gateway.child);
      });

    const acquire: HermesGatewayManagerShape["acquire"] = (input) =>
      Effect.gen(function* () {
        const currentSettings = yield* settings.getSettings.pipe(
          Effect.mapError(
            (cause) =>
              new HermesGatewayManagerError({
                code: "failed_to_spawn",
                detail: cause.message,
                cause,
              }),
          ),
        );

        if (currentSettings.providers.hermes.gatewayMode === "external") {
          const config = loadHermesRelayConfig();
          return {
            gatewayUrl: config.gatewayUrl,
            ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          };
        }

        const existing = yield* Ref.modify(stateRef, (state) => {
          const gateway = state.byCwd.get(input.cwd);
          if (!gateway) return [undefined, state] as const;
          gateway.threadIds.add(input.threadId);
          state.cwdByThreadId.set(input.threadId, input.cwd);
          return [gateway, state] as const;
        });
        if (existing) {
          return {
            gatewayUrl: existing.gatewayUrl,
            ...(existing.apiKey ? { apiKey: existing.apiKey } : {}),
          };
        }

        const binaryPath = yield* Effect.tryPromise({
          try: () => resolveHermesBinary(currentSettings.providers.hermes.binaryPath),
          catch: (cause) =>
            new HermesGatewayManagerError({
              code: "binary_not_found",
              detail: "Hermes binary was not found. Set providers.hermes.binaryPath or HERMES_BIN.",
              cause,
            }),
        });

        const hermesHomeRoot =
          currentSettings.providers.hermes.hermesHomeRoot.trim() || defaultHermesHomeRoot();
        const hermesHome = join(hermesHomeRoot, projectKey(input.cwd));
        yield* Effect.tryPromise({
          try: () => ensureSharedHermesHome(hermesHome),
          catch: (cause) =>
            new HermesGatewayManagerError({
              code: "filesystem_error",
              detail: `Failed to prepare managed Hermes home at ${hermesHome}`,
              cause,
            }),
        });

        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          const port = yield* Effect.tryPromise({
            try: readAvailablePort,
            catch: (cause) =>
              new HermesGatewayManagerError({
                code: "port_unavailable",
                detail: "Failed to allocate a port for the managed Hermes gateway.",
                cause,
              }),
          });
          const gatewayUrl = `http://127.0.0.1:${port}`;
          const relayConfig = loadHermesRelayConfig();
          const apiKey = relayConfig.apiKey;
          const child = spawn(binaryPath, ["gateway", "run", "--replace"], {
            cwd: input.cwd,
            env: {
              ...process.env,
              HERMES_HOME: hermesHome,
              TERMINAL_CWD: input.cwd,
              API_SERVER_ENABLED: "true",
              API_SERVER_HOST: "127.0.0.1",
              API_SERVER_PORT: String(port),
              API_SERVER_KEY: apiKey ?? "",
              TELEGRAM_BOT_TOKEN: "",
              DISCORD_BOT_TOKEN: "",
              WHATSAPP_ENABLED: "false",
              SLACK_BOT_TOKENS: "",
              WEBHOOK_ENABLED: "false",
              MSGRAPH_WEBHOOK_ENABLED: "false",
            },
            stdio: ["ignore", "pipe", "pipe"],
          });
          child.stdout.on("data", () => undefined);
          child.stderr.on("data", () => undefined);

          const handle = {
            gatewayUrl,
            ...(apiKey ? { apiKey } : {}),
          };
          const ready = yield* Effect.exit(
            Effect.tryPromise({
              try: () => waitForHealth(handle),
              catch: (cause) =>
                new HermesGatewayManagerError({
                  code: "health_timeout",
                  detail: `Managed Hermes gateway for ${basename(input.cwd)} did not become healthy.`,
                  cause,
                }),
            }),
          );

          if (Exit.isSuccess(ready)) {
            const gateway: ManagedGateway = {
              ...handle,
              cwd: input.cwd,
              port,
              hermesHome,
              child,
              threadIds: new Set([input.threadId]),
            };
            child.once("exit", () => {
              void Effect.runPromise(
                Ref.update(stateRef, (state) => {
                  const current = state.byCwd.get(input.cwd);
                  if (current !== gateway) return state;
                  const nextByCwd = new Map(state.byCwd);
                  const nextCwdByThreadId = new Map(state.cwdByThreadId);
                  nextByCwd.delete(input.cwd);
                  for (const threadId of gateway.threadIds) nextCwdByThreadId.delete(threadId);
                  return { byCwd: nextByCwd, cwdByThreadId: nextCwdByThreadId };
                }),
              );
            });
            yield* Ref.update(stateRef, (state) => {
              const byCwd = new Map(state.byCwd).set(input.cwd, gateway);
              const cwdByThreadId = new Map(state.cwdByThreadId).set(input.threadId, input.cwd);
              return { byCwd, cwdByThreadId };
            });
            return handle;
          }

          lastError = ready.cause;
          stopChild(child);
        }

        return yield* new HermesGatewayManagerError({
          code: "health_timeout",
          detail: `Managed Hermes gateway for ${basename(input.cwd)} failed to start.`,
          cause: lastError,
        });
      });

    const release: HermesGatewayManagerShape["release"] = (threadId) =>
      Effect.gen(function* () {
        const gateway = yield* Ref.modify(stateRef, (state) => {
          const cwd = state.cwdByThreadId.get(threadId);
          if (!cwd) return [undefined, state] as const;
          const current = state.byCwd.get(cwd);
          if (!current) return [undefined, state] as const;

          current.threadIds.delete(threadId);
          const cwdByThreadId = new Map(state.cwdByThreadId);
          cwdByThreadId.delete(threadId);
          if (current.threadIds.size > 0) return [undefined, { ...state, cwdByThreadId }] as const;

          const byCwd = new Map(state.byCwd);
          byCwd.delete(cwd);
          return [current, { byCwd, cwdByThreadId }] as const;
        });
        if (gateway) yield* stopGateway(gateway);
      });

    const stopAll = Effect.gen(function* () {
      const gateways = yield* Ref.modify(stateRef, (state) => [
        Array.from(state.byCwd.values()),
        { byCwd: new Map(), cwdByThreadId: new Map() },
      ]);
      yield* Effect.forEach(gateways, stopGateway, { discard: true });
    });

    yield* Effect.addFinalizer(() => stopAll);

    return { acquire, release, stopAll } satisfies HermesGatewayManagerShape;
  }),
);
