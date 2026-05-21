import {
  EventId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3delta/contracts";
import { Effect, PubSub, Ref, Stream } from "effect";

import { HermesClient, parseSseEvents } from "../../hermesClient.ts";
import { HermesGatewayManager } from "../../hermesGatewayManager.ts";
import { ProviderAdapterRequestError, ProviderAdapterSessionNotFoundError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

type HermesSessionState = ProviderSession & {
  readonly client: HermesClient;
  readonly conversationId?: string;
  readonly responseId?: string;
  readonly activeTurn?:
    | {
        readonly turnId: TurnId;
        readonly itemId: RuntimeItemId;
        readonly abortController: AbortController;
      }
    | undefined;
};

const now = () => new Date().toISOString();
const eventId = () => EventId.make(`evt_${crypto.randomUUID()}`);
const turnId = () => TurnId.make(`turn_${crypto.randomUUID()}`);
const itemId = () => RuntimeItemId.make(`item_${crypto.randomUUID()}`);

function clientFromGateway(gateway: { readonly gatewayUrl: string; readonly apiKey?: string }) {
  return new HermesClient({
    gatewayUrl: gateway.gatewayUrl,
    ...(gateway.apiKey ? { apiKey: gateway.apiKey } : {}),
  });
}

function requestError(method: string, cause: unknown) {
  return new ProviderAdapterRequestError({
    provider: "hermes",
    method,
    detail: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function readPrompt(input: string | undefined): string {
  return input?.trim() || "Continue.";
}

function isAbortCause(cause: unknown): boolean {
  if (!cause) return false;
  if (cause instanceof DOMException && cause.name === "AbortError") return true;
  if (cause instanceof Error) {
    if (cause.name === "AbortError") return true;
    if (isAbortCause(cause.cause)) return true;
  }
  return false;
}

function extractTextDelta(event: { event: string | undefined; data: unknown }): string {
  if (!event.event?.includes("delta")) return "";
  const data = event.data;
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  for (const key of ["delta", "text", "output_text"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  const nested = record.content;
  if (
    nested &&
    typeof nested === "object" &&
    typeof (nested as { text?: unknown }).text === "string"
  ) {
    return (nested as { text: string }).text;
  }
  return "";
}

function readString(record: unknown, key: string): string | undefined {
  return record &&
    typeof record === "object" &&
    typeof (record as Record<string, unknown>)[key] === "string"
    ? ((record as Record<string, string>)[key] as string)
    : undefined;
}

export const makeHermesAdapter = Effect.gen(function* () {
  const sessions = yield* Ref.make(new Map<ThreadId, HermesSessionState>());
  const events = yield* Effect.acquireRelease(
    PubSub.unbounded<ProviderRuntimeEvent>(),
    PubSub.shutdown,
  );
  const gatewayManager = yield* HermesGatewayManager;

  const publish = (event: ProviderRuntimeEvent) =>
    PubSub.publish(events, event).pipe(Effect.asVoid);

  const updateSession = (
    threadId: ThreadId,
    update: (session: HermesSessionState) => HermesSessionState,
  ) =>
    Ref.update(sessions, (current) => {
      const existing = current.get(threadId);
      if (!existing) return current;
      const next = new Map(current);
      next.set(threadId, update(existing));
      return next;
    });

  const publishInterruptedTurn = (threadId: ThreadId, session: HermesSessionState) =>
    Effect.gen(function* () {
      const activeTurn = session.activeTurn;
      activeTurn?.abortController.abort();
      yield* updateSession(threadId, (current) => ({
        ...current,
        status: "ready",
        activeTurnId: undefined,
        activeTurn: undefined,
        updatedAt: now(),
      }));
      if (!activeTurn) return;
      yield* publish({
        eventId: eventId(),
        provider: "hermes",
        threadId,
        turnId: activeTurn.turnId,
        itemId: activeTurn.itemId,
        createdAt: now(),
        type: "item.completed",
        payload: {
          itemType: "assistant_message",
          status: "completed",
          title: "Hermes",
          detail: "Hermes turn interrupted by user.",
        },
      });
      yield* publish({
        eventId: eventId(),
        provider: "hermes",
        threadId,
        turnId: activeTurn.turnId,
        createdAt: now(),
        type: "turn.completed",
        payload: { state: "interrupted", stopReason: "Hermes turn interrupted by user." },
      });
    });

  const adapter: ProviderAdapterShape<
    ProviderAdapterRequestError | ProviderAdapterSessionNotFoundError
  > = {
    provider: "hermes",
    capabilities: { sessionModelSwitch: "in-session" },
    startSession: (input) =>
      Effect.gen(function* () {
        const createdAt = now();
        const resolvedCwd = input.cwd ?? process.cwd();
        const gateway = yield* gatewayManager
          .acquire({
            threadId: input.threadId,
            cwd: resolvedCwd,
          })
          .pipe(Effect.mapError((cause) => requestError("gateway.acquire", cause)));
        const client = clientFromGateway(gateway);
        const session: HermesSessionState = {
          provider: "hermes",
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: resolvedCwd,
          client,
          model: input.modelSelection?.model,
          threadId: input.threadId,
          createdAt,
          updatedAt: createdAt,
        };
        yield* Ref.update(sessions, (current) => new Map(current).set(input.threadId, session));
        yield* publish({
          eventId: eventId(),
          provider: "hermes",
          threadId: input.threadId,
          createdAt,
          type: "session.started",
          payload: { message: "Hermes session ready" },
        });
        return session;
      }),
    sendTurn: (input) =>
      Effect.gen(function* () {
        const session = yield* Ref.get(sessions).pipe(
          Effect.map((current) => current.get(input.threadId)),
        );
        if (!session) {
          return yield* new ProviderAdapterSessionNotFoundError({
            provider: "hermes",
            threadId: input.threadId,
          });
        }
        const gateway = yield* gatewayManager
          .acquire({
            threadId: input.threadId,
            cwd: session.cwd ?? process.cwd(),
          })
          .pipe(Effect.mapError((cause) => requestError("gateway.acquire", cause)));
        const client = clientFromGateway(gateway);
        const activeTurnId = turnId();
        const assistantItemId = itemId();
        const abortController = new AbortController();
        yield* updateSession(input.threadId, (current) => ({
          ...current,
          client,
          status: "running",
          activeTurnId,
          activeTurn: {
            turnId: activeTurnId,
            itemId: assistantItemId,
            abortController,
          },
          updatedAt: now(),
        }));
        yield* publish({
          eventId: eventId(),
          provider: "hermes",
          threadId: input.threadId,
          turnId: activeTurnId,
          createdAt: now(),
          type: "turn.started",
          payload: {
            ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
          },
        });
        yield* publish({
          eventId: eventId(),
          provider: "hermes",
          threadId: input.threadId,
          turnId: activeTurnId,
          itemId: assistantItemId,
          createdAt: now(),
          type: "item.started",
          payload: { itemType: "assistant_message", status: "inProgress", title: "Hermes" },
        });

        const markTurnEnded = (
          state: "failed" | "interrupted",
          detail: string,
          options?: { readonly publishRuntimeError?: boolean },
        ) =>
          Effect.gen(function* () {
            const shouldPublish = yield* Ref.get(sessions).pipe(
              Effect.map(
                (current) => current.get(input.threadId)?.activeTurn?.turnId === activeTurnId,
              ),
            );
            if (!shouldPublish) return;
            yield* updateSession(input.threadId, (current) => ({
              ...current,
              status: "ready",
              activeTurnId: undefined,
              activeTurn: undefined,
              ...(state === "failed" ? { lastError: detail } : {}),
              updatedAt: now(),
            }));
            if (options?.publishRuntimeError) {
              yield* publish({
                eventId: eventId(),
                provider: "hermes",
                threadId: input.threadId,
                turnId: activeTurnId,
                itemId: assistantItemId,
                createdAt: now(),
                type: "runtime.error",
                payload: { message: detail, class: "provider_error" },
              });
            }
            yield* publish({
              eventId: eventId(),
              provider: "hermes",
              threadId: input.threadId,
              turnId: activeTurnId,
              itemId: assistantItemId,
              createdAt: now(),
              type: "item.completed",
              payload: {
                itemType: "assistant_message",
                status: state === "failed" ? "failed" : "completed",
                title: "Hermes",
                detail,
              },
            });
            yield* publish({
              eventId: eventId(),
              provider: "hermes",
              threadId: input.threadId,
              turnId: activeTurnId,
              createdAt: now(),
              type: "turn.completed",
              payload:
                state === "failed"
                  ? { state, errorMessage: detail }
                  : { state, stopReason: detail },
            });
          });

        const markTurnFailed = (error: ProviderAdapterRequestError) =>
          markTurnEnded("failed", error.detail || error.message, { publishRuntimeError: true });

        const markTurnInterrupted = () =>
          markTurnEnded("interrupted", "Hermes turn interrupted by user.");

        const runTurn = Effect.tryPromise({
          try: async () => {
            const response = await client.proxy("/v1/responses", {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: abortController.signal,
              body: JSON.stringify({
                input: readPrompt(input.input),
                stream: true,
                ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
                ...(session.conversationId ? { conversation_id: session.conversationId } : {}),
                ...(session.responseId ? { previous_response_id: session.responseId } : {}),
              }),
            });
            if (!response.ok) throw new Error(await response.text());
            const body = await response.text();
            if (abortController.signal.aborted) {
              throw new DOMException("Hermes turn interrupted by user.", "AbortError");
            }
            return body;
          },
          catch: (cause) => requestError("responses.create", cause),
        }).pipe(
          Effect.flatMap((body) =>
            Effect.gen(function* () {
              const shouldContinue = yield* Ref.get(sessions).pipe(
                Effect.map(
                  (current) => current.get(input.threadId)?.activeTurn?.turnId === activeTurnId,
                ),
              );
              if (!shouldContinue) return;
              const parsed = parseSseEvents(body.endsWith("\n\n") ? body : `${body}\n\n`);
              let responseId: string | undefined;
              let conversationId: string | undefined;
              for (const event of parsed.events) {
                responseId = readString(event.data, "id") ?? responseId;
                conversationId =
                  readString(event.data, "conversation_id") ??
                  readString(event.data, "conversationId") ??
                  conversationId;
                const delta = extractTextDelta(event);
                if (!delta) continue;
                yield* publish({
                  eventId: eventId(),
                  provider: "hermes",
                  threadId: input.threadId,
                  turnId: activeTurnId,
                  itemId: assistantItemId,
                  createdAt: now(),
                  type: "content.delta",
                  payload: { streamKind: "assistant_text", delta },
                });
              }
              yield* updateSession(input.threadId, (current) => ({
                ...current,
                status: "ready",
                activeTurnId: undefined,
                activeTurn: undefined,
                ...(responseId ? { responseId } : {}),
                ...(conversationId ? { conversationId } : {}),
                updatedAt: now(),
              }));
              yield* publish({
                eventId: eventId(),
                provider: "hermes",
                threadId: input.threadId,
                turnId: activeTurnId,
                itemId: assistantItemId,
                createdAt: now(),
                type: "item.completed",
                payload: { itemType: "assistant_message", status: "completed", title: "Hermes" },
              });
              yield* publish({
                eventId: eventId(),
                provider: "hermes",
                threadId: input.threadId,
                turnId: activeTurnId,
                createdAt: now(),
                type: "turn.completed",
                payload: { state: "completed" },
              });
            }),
          ),
          Effect.catch((error) =>
            isAbortCause(error.cause)
              ? markTurnInterrupted()
              : markTurnFailed(error).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );

        yield* Effect.sync(() => {
          Effect.runFork(
            runTurn.pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("Hermes turn failed after start", {
                  threadId: input.threadId,
                  cause: String(cause),
                }),
              ),
            ),
          );
        });

        return { threadId: input.threadId, turnId: activeTurnId };
      }),
    interruptTurn: (threadId) =>
      Effect.gen(function* () {
        const session = yield* Ref.get(sessions).pipe(
          Effect.map((current) => current.get(threadId)),
        );
        if (!session) {
          yield* gatewayManager.release(threadId);
          return;
        }
        session.activeTurn?.abortController.abort();
        if (session.cwd) {
          const affectedThreadIds = yield* gatewayManager.hardKill(session.cwd);
          const latestSessions = yield* Ref.get(sessions);
          const targetThreadIds = affectedThreadIds.length > 0 ? affectedThreadIds : [threadId];
          yield* Effect.forEach(
            targetThreadIds,
            (affectedThreadId) => {
              const affectedSession = latestSessions.get(affectedThreadId);
              return affectedSession
                ? publishInterruptedTurn(affectedThreadId, affectedSession)
                : Effect.void;
            },
            { discard: true },
          );
          return;
        }
        yield* publishInterruptedTurn(threadId, session);
        yield* gatewayManager.release(threadId);
      }),
    respondToRequest: () => Effect.void,
    respondToUserInput: () => Effect.void,
    stopSession: (threadId) =>
      Effect.gen(function* () {
        const session = yield* Ref.get(sessions).pipe(
          Effect.map((current) => current.get(threadId)),
        );
        session?.activeTurn?.abortController.abort();
        yield* Ref.update(sessions, (current) => {
          const next = new Map(current);
          next.delete(threadId);
          return next;
        });
        yield* gatewayManager.release(threadId);
      }),
    listSessions: () =>
      Ref.get(sessions).pipe(Effect.map((current) => Array.from(current.values()))),
    hasSession: (threadId) =>
      Ref.get(sessions).pipe(Effect.map((current) => current.has(threadId))),
    readThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
    rollbackThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
    stopAll: () =>
      Effect.gen(function* () {
        const activeSessions = yield* Ref.get(sessions);
        for (const session of activeSessions.values()) {
          session.activeTurn?.abortController.abort();
        }
        yield* Ref.set(sessions, new Map());
        yield* gatewayManager.stopAll;
      }),
    streamEvents: Stream.fromPubSub(events),
  };

  return adapter;
});
