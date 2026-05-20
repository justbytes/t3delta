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
};

const now = () => new Date().toISOString();
const eventId = () => EventId.make(`evt_${crypto.randomUUID()}`);
const turnId = () => TurnId.make(`turn_${crypto.randomUUID()}`);
const itemId = () => RuntimeItemId.make(`item_${crypto.randomUUID()}`);

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
        const client = new HermesClient({
          gatewayUrl: gateway.gatewayUrl,
          ...(gateway.apiKey ? { apiKey: gateway.apiKey } : {}),
        });
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
        const activeTurnId = turnId();
        const assistantItemId = itemId();
        yield* updateSession(input.threadId, (current) => ({
          ...current,
          status: "running",
          activeTurnId,
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

        const markTurnFailed = (error: ProviderAdapterRequestError) =>
          Effect.gen(function* () {
            const message = error.detail || error.message;
            yield* updateSession(input.threadId, (current) => ({
              ...current,
              status: "ready",
              activeTurnId: undefined,
              lastError: message,
              updatedAt: now(),
            }));
            yield* publish({
              eventId: eventId(),
              provider: "hermes",
              threadId: input.threadId,
              turnId: activeTurnId,
              itemId: assistantItemId,
              createdAt: now(),
              type: "runtime.error",
              payload: { message, class: "provider_error" },
            });
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
                status: "failed",
                title: "Hermes",
                detail: message,
              },
            });
            yield* publish({
              eventId: eventId(),
              provider: "hermes",
              threadId: input.threadId,
              turnId: activeTurnId,
              createdAt: now(),
              type: "turn.completed",
              payload: { state: "failed", errorMessage: message },
            });
          });

        yield* Effect.tryPromise({
          try: async () => {
            const response = await session.client.proxy("/v1/responses", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                input: readPrompt(input.input),
                stream: true,
                ...(input.modelSelection?.model ? { model: input.modelSelection.model } : {}),
                ...(session.conversationId ? { conversation_id: session.conversationId } : {}),
                ...(session.responseId ? { previous_response_id: session.responseId } : {}),
              }),
            });
            if (!response.ok) throw new Error(await response.text());
            return await response.text();
          },
          catch: (cause) => requestError("responses.create", cause),
        }).pipe(
          Effect.flatMap((body) =>
            Effect.gen(function* () {
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
          Effect.catch((error) => markTurnFailed(error).pipe(Effect.andThen(Effect.fail(error)))),
        );

        return { threadId: input.threadId, turnId: activeTurnId };
      }),
    interruptTurn: (threadId) =>
      updateSession(threadId, (session) => ({
        ...session,
        status: "ready",
        activeTurnId: undefined,
      })),
    respondToRequest: () => Effect.void,
    respondToUserInput: () => Effect.void,
    stopSession: (threadId) =>
      Ref.update(sessions, (current) => {
        const next = new Map(current);
        next.delete(threadId);
        return next;
      }).pipe(Effect.andThen(gatewayManager.release(threadId))),
    listSessions: () =>
      Ref.get(sessions).pipe(Effect.map((current) => Array.from(current.values()))),
    hasSession: (threadId) =>
      Ref.get(sessions).pipe(Effect.map((current) => current.has(threadId))),
    readThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
    rollbackThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
    stopAll: () => Ref.set(sessions, new Map()).pipe(Effect.andThen(gatewayManager.stopAll)),
    streamEvents: Stream.fromPubSub(events),
  };

  return adapter;
});
