/**
 * ProviderRegistryLive - Aggregates provider-specific snapshot services.
 *
 * @module ProviderRegistryLive
 */
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@t3delta/contracts";
import { Data, Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import { HermesClient } from "../../hermesClient.ts";
import { loadHermesRelayConfig } from "../../hermesEnv.ts";
import { listHermesProviderSkills } from "../../hermesSkillDiscovery.ts";
import { buildServerProvider, defaultProviderCapabilities } from "../providerSnapshot.ts";
import { CodexProvider } from "../Services/CodexProvider.ts";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry.ts";

class HermesProviderProbeError extends Data.TaggedError("HermesProviderProbeError")<{
  readonly cause: unknown;
}> {}

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

const HERMES_SLASH_COMMANDS: ReadonlyArray<ServerProviderSlashCommand> = [
  { name: "new", description: "Fresh session" },
  { name: "reset", description: "Alias for /new" },
  { name: "clear", description: "Clear screen and start a new CLI session" },
  { name: "retry", description: "Resend the last message" },
  { name: "undo", description: "Remove the last exchange" },
  { name: "title", description: "Name the session", input: { hint: "[name]" } },
  { name: "compress", description: "Manually compress context" },
  { name: "stop", description: "Kill background processes" },
  { name: "rollback", description: "Restore a filesystem checkpoint", input: { hint: "[N]" } },
  {
    name: "background",
    description: "Run a prompt in the background",
    input: { hint: "<prompt>" },
  },
  { name: "queue", description: "Queue a prompt for the next turn", input: { hint: "<prompt>" } },
  { name: "resume", description: "Resume a named session", input: { hint: "[name]" } },
  { name: "config", description: "Show Hermes config" },
  { name: "model", description: "Switch Hermes model", input: { hint: "[name]" } },
  { name: "personality", description: "Set the active personality", input: { hint: "[name]" } },
  {
    name: "reasoning",
    description: "Set reasoning level or visibility",
    input: { hint: "[level]" },
  },
  { name: "verbose", description: "Cycle verbose output modes" },
  { name: "voice", description: "Toggle voice mode", input: { hint: "[on|off|tts]" } },
  { name: "yolo", description: "Toggle approval bypass" },
  { name: "skin", description: "Change the CLI theme", input: { hint: "[name]" } },
  { name: "statusbar", description: "Toggle CLI status bar" },
  { name: "tools", description: "Manage tools" },
  { name: "toolsets", description: "List toolsets" },
  { name: "skills", description: "Search or install skills" },
  { name: "skill", description: "Load a skill into this session", input: { hint: "<name>" } },
  { name: "cron", description: "Manage cron jobs" },
  { name: "reload-mcp", description: "Reload MCP servers" },
  { name: "plugins", description: "List plugins" },
  { name: "approve", description: "Approve a pending gateway command" },
  { name: "deny", description: "Deny a pending gateway command" },
  { name: "restart", description: "Restart gateway" },
  { name: "sethome", description: "Set current chat as home channel" },
  { name: "update", description: "Update Hermes to latest" },
  { name: "platforms", description: "Show platform connection status" },
  { name: "gateway", description: "Alias for /platforms" },
  { name: "branch", description: "Branch the current session" },
  { name: "fork", description: "Alias for /branch" },
  { name: "fast", description: "Toggle priority processing" },
  { name: "browser", description: "Open CDP browser connection" },
  { name: "history", description: "Show conversation history" },
  { name: "save", description: "Save conversation to file" },
  { name: "paste", description: "Attach clipboard image" },
  { name: "image", description: "Attach a local image file" },
  { name: "help", description: "Show Hermes help" },
  { name: "commands", description: "Browse all commands", input: { hint: "[page]" } },
  { name: "usage", description: "Show token usage" },
  { name: "insights", description: "Show usage analytics", input: { hint: "[days]" } },
  { name: "status", description: "Show session info" },
  { name: "profile", description: "Show active profile info" },
  { name: "quit", description: "Exit CLI" },
  { name: "exit", description: "Alias for /quit" },
  { name: "q", description: "Alias for /quit" },
];

function fallbackHermesModel(): ServerProviderModel {
  return {
    slug: DEFAULT_MODEL_BY_PROVIDER.hermes,
    name: DEFAULT_MODEL_BY_PROVIDER.hermes,
    isCustom: false,
    capabilities: null,
  };
}

function parseHermesModels(body: unknown): ReadonlyArray<ServerProviderModel> {
  const records = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? (body as { data: unknown[] }).data
      : body && typeof body === "object" && Array.isArray((body as { models?: unknown }).models)
        ? (body as { models: unknown[] }).models
        : [];

  const models = records.flatMap((entry): ServerProviderModel[] => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const slug = typeof record.id === "string" ? record.id : undefined;
    if (!slug?.trim()) return [];
    const name =
      typeof record.name === "string" && record.name.trim().length > 0 ? record.name : slug;
    return [{ slug, name, isCustom: false, capabilities: null }];
  });

  return models.length > 0 ? models : [fallbackHermesModel()];
}

const makeHermesProviderSnapshot = Effect.fn("makeHermesProviderSnapshot")(function* () {
  const checkedAt = new Date().toISOString();
  const config = loadHermesRelayConfig();
  const client = new HermesClient({
    gatewayUrl: config.gatewayUrl,
    ...(config.apiKey ? { apiKey: config.apiKey } : {}),
  });

  const health = yield* Effect.tryPromise({
    try: () => client.health(),
    catch: (cause) => new HermesProviderProbeError({ cause }),
  }).pipe(Effect.orElseSucceed(() => "unreachable" as const));
  const skills = yield* Effect.tryPromise({
    try: () => listHermesProviderSkills(),
    catch: (cause) => new HermesProviderProbeError({ cause }),
  }).pipe(Effect.orElseSucceed(() => []));

  if (health === "unreachable") {
    return buildServerProvider({
      provider: "hermes",
      enabled: true,
      checkedAt,
      models: [fallbackHermesModel()],
      slashCommands: HERMES_SLASH_COMMANDS,
      skills,
      capabilities: defaultProviderCapabilities("hermes"),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown", type: "gateway", label: "Hermes Gateway" },
        message: "Hermes gateway is not reachable; using fallback model metadata.",
      },
    });
  }

  const modelResponse = yield* Effect.tryPromise({
    try: async () => {
      const response = await client.proxy("/v1/models", { method: "GET" });
      if (!response.ok) {
        return { ok: false as const, status: response.status, body: await response.text() };
      }
      return { ok: true as const, body: await response.json() };
    },
    catch: (cause) => new HermesProviderProbeError({ cause }),
  }).pipe(Effect.result);

  if (modelResponse._tag === "Failure" || !modelResponse.success.ok) {
    return buildServerProvider({
      provider: "hermes",
      enabled: true,
      checkedAt,
      models: [fallbackHermesModel()],
      slashCommands: HERMES_SLASH_COMMANDS,
      skills,
      capabilities: defaultProviderCapabilities("hermes"),
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "authenticated", type: "gateway", label: "Hermes Gateway" },
        message: "Hermes models could not be loaded; using fallback model metadata.",
      },
    });
  }

  return buildServerProvider({
    provider: "hermes",
    enabled: true,
    checkedAt,
    models: parseHermesModels(modelResponse.success.body),
    slashCommands: HERMES_SLASH_COMMANDS,
    skills,
    capabilities: defaultProviderCapabilities("hermes"),
    probe: {
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated", type: "gateway", label: "Hermes Gateway" },
    },
  });
});

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );
    const codexProvider = yield* CodexProvider;
    const initialHermes = yield* makeHermesProviderSnapshot();
    const initialCodex = yield* codexProvider.getSnapshot;
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>([
      initialHermes,
      initialCodex,
    ]);

    const upsertProviders = Effect.fn("upsertProviders")(function* (
      nextProviders: ReadonlyArray<ServerProvider>,
      options?: {
        readonly publish?: boolean;
      },
    ) {
      const [previousProviders, providers] = yield* Ref.modify(
        providersRef,
        (previousProviders) => {
          const mergedProviders = new Map(
            previousProviders.map((provider) => [provider.provider, provider] as const),
          );

          for (const provider of nextProviders) {
            mergedProviders.set(provider.provider, provider);
          }

          const providers = [...mergedProviders.values()];
          return [[previousProviders, providers] as const, providers];
        },
      );

      if (haveProvidersChanged(previousProviders, providers)) {
        if (options?.publish !== false) {
          yield* PubSub.publish(changesPubSub, providers);
        }
      }

      return providers;
    });

    const syncProvider = Effect.fn("syncProvider")(function* (
      provider: ServerProvider,
      options?: {
        readonly publish?: boolean;
      },
    ) {
      return yield* upsertProviders([provider], options);
    });

    const refresh = Effect.fn("refresh")(function* (provider?: ProviderKind) {
      switch (provider) {
        case "hermes":
          return yield* syncProvider(yield* makeHermesProviderSnapshot());
        case "codex":
          return yield* syncProvider(yield* codexProvider.refresh);
        case undefined:
          return yield* upsertProviders([
            yield* makeHermesProviderSnapshot(),
            yield* codexProvider.refresh,
          ]);
        default:
          return yield* Ref.get(providersRef);
      }
    });

    return {
      getProviders: Ref.get(providersRef),
      refresh: (provider?: ProviderKind) =>
        refresh(provider).pipe(
          Effect.tapError(Effect.logError),
          Effect.orElseSucceed(() => [] as ReadonlyArray<ServerProvider>),
        ),
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistryShape;
  }),
);
