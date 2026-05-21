import { CommandId } from "@t3delta/contracts";
import { Duration, Effect, Layer, Schedule } from "effect";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProviderSessionDirectory } from "../Services/ProviderSessionDirectory.ts";
import {
  ProviderSessionReaper,
  type ProviderSessionReaperShape,
} from "../Services/ProviderSessionReaper.ts";
import { ProviderService } from "../Services/ProviderService.ts";

const DEFAULT_INACTIVITY_THRESHOLD_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface ProviderSessionReaperLiveOptions {
  readonly inactivityThresholdMs?: number;
  readonly sweepIntervalMs?: number;
}

const makeProviderSessionReaper = (options?: ProviderSessionReaperLiveOptions) =>
  Effect.gen(function* () {
    const providerService = yield* ProviderService;
    const directory = yield* ProviderSessionDirectory;
    const orchestrationEngine = yield* OrchestrationEngineService;

    const inactivityThresholdMs = Math.max(
      1,
      options?.inactivityThresholdMs ?? DEFAULT_INACTIVITY_THRESHOLD_MS,
    );
    const sweepIntervalMs = Math.max(1, options?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS);

    const reconcileStaleActiveTurns = () =>
      Effect.gen(function* () {
        const readModel = yield* orchestrationEngine.getReadModel();
        const threadsById = new Map(
          readModel.threads.map((thread) => [thread.id, thread] as const),
        );
        const bindings = yield* directory.listBindings();
        const liveSessions = yield* providerService.listSessions();

        for (const binding of bindings) {
          const thread = threadsById.get(binding.threadId);
          if (thread?.session?.activeTurnId == null) {
            continue;
          }
          const hasLiveSession = liveSessions.some(
            (session) => session.threadId === binding.threadId,
          );
          if (hasLiveSession || thread.session.providerName !== binding.provider) {
            continue;
          }
          const interruptedAt = new Date().toISOString();
          const nextStatus = binding.status === "stopped" ? "stopped" : "ready";
          yield* directory.upsert({
            threadId: binding.threadId,
            provider: binding.provider,
            runtimeMode: binding.runtimeMode ?? thread.session.runtimeMode,
            status: binding.status === "stopped" ? "stopped" : "running",
            runtimePayload: {
              activeTurnId: null,
              lastRuntimeEvent: "provider.stale-active-turn.reaped",
              lastRuntimeEventAt: interruptedAt,
            },
          });
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make(`server:provider-stale-active-turn:${crypto.randomUUID()}`),
            threadId: binding.threadId,
            session: {
              ...thread.session,
              status: nextStatus,
              activeTurnId: null,
              lastError:
                binding.status === "stopped"
                  ? "Previous provider turn was stopped because the server shut down."
                  : "Previous provider turn was interrupted because the server restarted.",
              updatedAt: interruptedAt,
            },
            createdAt: interruptedAt,
          });
          yield* Effect.logInfo("provider.session.reaper.interrupted-stale-active-turn", {
            threadId: binding.threadId,
            provider: binding.provider,
            activeTurnId: thread.session.activeTurnId,
            persistedStatus: binding.status,
          });
        }
      }).pipe(
        Effect.catch((error: unknown) =>
          Effect.logWarning("provider.session.reaper.stale-active-turn-reconcile-failed", {
            error,
          }),
        ),
        Effect.catchDefect((defect: unknown) =>
          Effect.logWarning("provider.session.reaper.stale-active-turn-reconcile-defect", {
            defect,
          }),
        ),
      );

    const sweep = Effect.gen(function* () {
      yield* reconcileStaleActiveTurns();
      const readModel = yield* orchestrationEngine.getReadModel();
      const threadsById = new Map(readModel.threads.map((thread) => [thread.id, thread] as const));
      const bindings = yield* directory.listBindings();
      const now = Date.now();
      let reapedCount = 0;

      for (const binding of bindings) {
        if (binding.status === "stopped") {
          continue;
        }

        const lastSeenMs = Date.parse(binding.lastSeenAt);
        if (Number.isNaN(lastSeenMs)) {
          yield* Effect.logWarning("provider.session.reaper.invalid-last-seen", {
            threadId: binding.threadId,
            provider: binding.provider,
            lastSeenAt: binding.lastSeenAt,
          });
          continue;
        }

        const idleDurationMs = now - lastSeenMs;
        const thread = threadsById.get(binding.threadId);
        if (thread?.session?.activeTurnId != null) {
          yield* Effect.logDebug("provider.session.reaper.skipped-active-turn", {
            threadId: binding.threadId,
            activeTurnId: thread.session.activeTurnId,
            idleDurationMs,
          });
          continue;
        }

        if (idleDurationMs < inactivityThresholdMs) {
          continue;
        }

        const reaped = yield* providerService.stopSession({ threadId: binding.threadId }).pipe(
          Effect.tap(() =>
            Effect.logInfo("provider.session.reaped", {
              threadId: binding.threadId,
              provider: binding.provider,
              idleDurationMs,
              reason: "inactivity_threshold",
            }),
          ),
          Effect.as(true),
          Effect.catchCause((cause) =>
            Effect.logWarning("provider.session.reaper.stop-failed", {
              threadId: binding.threadId,
              provider: binding.provider,
              idleDurationMs,
              cause,
            }).pipe(Effect.as(false)),
          ),
        );

        if (reaped) {
          reapedCount += 1;
        }
      }

      if (reapedCount > 0) {
        yield* Effect.logInfo("provider.session.reaper.sweep-complete", {
          reapedCount,
          totalBindings: bindings.length,
        });
      }
    });

    const start: ProviderSessionReaperShape["start"] = () =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(
          sweep.pipe(
            Effect.catch((error: unknown) =>
              Effect.logWarning("provider.session.reaper.sweep-failed", {
                error,
              }),
            ),
            Effect.catchDefect((defect: unknown) =>
              Effect.logWarning("provider.session.reaper.sweep-defect", {
                defect,
              }),
            ),
            Effect.repeat(Schedule.spaced(Duration.millis(sweepIntervalMs))),
          ),
        );

        yield* Effect.logInfo("provider.session.reaper.started", {
          inactivityThresholdMs,
          sweepIntervalMs,
        });
      });

    return {
      reconcileStaleActiveTurns,
      start,
    } satisfies ProviderSessionReaperShape;
  });

export const makeProviderSessionReaperLive = (options?: ProviderSessionReaperLiveOptions) =>
  Layer.effect(ProviderSessionReaper, makeProviderSessionReaper(options));

export const ProviderSessionReaperLive = makeProviderSessionReaperLive();
