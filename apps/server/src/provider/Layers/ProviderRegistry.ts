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
  type ServerProviderSlashCommand,
} from "@t3delta/contracts";
import { Data, Effect, Equal, Layer, PubSub, Ref, Stream } from "effect";

import { HermesClient } from "../../hermesClient.ts";
import { loadHermesRelayConfig } from "../../hermesEnv.ts";
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
  { name: "model", description: "Switch Hermes model" },
  { name: "new", description: "Start a new Hermes session" },
  { name: "clear", description: "Clear the current composer draft" },
  { name: "help", description: "Show Hermes help" },
  { name: "tools", description: "List available Hermes tools" },
  { name: "skills", description: "List installed Hermes skills" },
  { name: "skill", description: "Run a Hermes skill", input: { hint: "<name>" } },
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

  if (health === "unreachable") {
    return buildServerProvider({
      provider: "hermes",
      enabled: true,
      checkedAt,
      models: [fallbackHermesModel()],
      slashCommands: HERMES_SLASH_COMMANDS,
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
