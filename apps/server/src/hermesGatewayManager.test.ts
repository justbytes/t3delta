import { describe, expect, it, vi } from "vitest";
import { Effect, Layer } from "effect";

import { HermesGatewayManager, HermesGatewayManagerLive } from "./hermesGatewayManager.ts";
import { ServerSettingsService } from "./serverSettings.ts";

describe("HermesGatewayManager", () => {
  it("uses the configured external gateway without spawning a managed process", async () => {
    vi.stubEnv("HERMES_GATEWAY_URL", "http://hermes.test:9999");
    vi.stubEnv("HERMES_API_KEY", "test-key");

    const layer = HermesGatewayManagerLive.pipe(
      Layer.provide(
        ServerSettingsService.layerTest({ providers: { hermes: { gatewayMode: "external" } } }),
      ),
    );

    const handle = await Effect.runPromise(
      Effect.gen(function* () {
        const manager = yield* HermesGatewayManager;
        return yield* manager.acquire({
          threadId: "thread_1" as never,
          cwd: "/repo",
        });
      }).pipe(Effect.provide(layer)),
    );

    expect(handle).toEqual({
      gatewayUrl: "http://hermes.test:9999",
      apiKey: "test-key",
    });
  });
});
