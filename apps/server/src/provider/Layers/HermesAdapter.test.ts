import { ThreadId } from "@t3delta/contracts";
import { assert, it, vi } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Stream } from "effect";

import { HermesGatewayManager } from "../../hermesGatewayManager.ts";
import { makeHermesAdapter } from "./HermesAdapter.ts";

const threadId = ThreadId.make("thread-hermes-interrupt");

let stopAllCalls = 0;

const fakeGatewayManager = {
  acquire: vi.fn(() => Effect.succeed({ gatewayUrl: "http://hermes.test" })),
  hardKill: vi.fn(() => Effect.succeed([threadId])),
  release: vi.fn(() => Effect.void),
  stopAll: Effect.sync(() => {
    stopAllCalls += 1;
  }),
};

const testLayer = it.layer(Layer.succeed(HermesGatewayManager, fakeGatewayManager));

testLayer("HermesAdapter", (it) => {
  it.effect(
    "returns after starting the Hermes request instead of blocking the command reactor",
    () =>
      Effect.gen(function* () {
        const originalFetch = globalThis.fetch;
        let resolveFetchStarted: (() => void) | undefined;
        const fetchStarted = new Promise<void>((resolve) => {
          resolveFetchStarted = resolve;
        });

        globalThis.fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
          resolveFetchStarted?.();
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          });
        }) as unknown as typeof fetch;

        try {
          const adapter = yield* makeHermesAdapter;
          yield* adapter.startSession({
            threadId,
            runtimeMode: "full-access",
            cwd: "/tmp",
          });

          const result = yield* adapter
            .sendTurn({
              threadId,
              input: "hello",
              interactionMode: "default",
              attachments: [],
            })
            .pipe(Effect.timeoutOption("50 millis"));

          assert.equal(Option.isSome(result), true);
          yield* Effect.promise(() => fetchStarted);
          yield* adapter.interruptTurn(threadId);
        } finally {
          globalThis.fetch = originalFetch;
        }
      }),
  );

  it.effect("aborts the active Hermes request and emits an interrupted turn", () =>
    Effect.gen(function* () {
      const originalFetch = globalThis.fetch;
      let capturedSignal: AbortSignal | undefined;
      let resolveFetchStarted: (() => void) | undefined;
      const fetchStarted = new Promise<void>((resolve) => {
        resolveFetchStarted = resolve;
      });

      globalThis.fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        resolveFetchStarted?.();
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }) as unknown as typeof fetch;

      try {
        fakeGatewayManager.hardKill.mockClear();
        const adapter = yield* makeHermesAdapter;
        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
          cwd: "/tmp",
        });

        const eventsFiber = yield* Stream.take(adapter.streamEvents, 4).pipe(
          Stream.runCollect,
          Effect.forkChild,
        );
        const turnFiber = yield* adapter
          .sendTurn({
            threadId,
            input: "hello",
            interactionMode: "default",
            attachments: [],
          })
          .pipe(Effect.forkChild);

        yield* Effect.promise(() => fetchStarted);
        yield* adapter.interruptTurn(threadId);
        yield* Fiber.join(turnFiber);

        assert.equal(capturedSignal?.aborted, true);
        assert.deepStrictEqual(fakeGatewayManager.hardKill.mock.calls[0], ["/tmp"]);
        const session = (yield* adapter.listSessions())[0];
        assert.equal(session?.status, "ready");
        assert.equal(session?.activeTurnId, undefined);

        const events = Array.from(yield* Fiber.join(eventsFiber));
        assert.equal(events.at(-1)?.type, "turn.completed");
        const completed = events.at(-1);
        if (completed?.type !== "turn.completed") {
          assert.fail("Expected interrupted turn.completed event");
        }
        assert.equal(completed.payload.state, "interrupted");
      } finally {
        globalThis.fetch = originalFetch;
      }
    }),
  );

  it.effect("aborts the active Hermes request when stopping a session", () =>
    Effect.gen(function* () {
      const originalFetch = globalThis.fetch;
      let capturedSignal: AbortSignal | undefined;
      let resolveFetchStarted: (() => void) | undefined;
      const fetchStarted = new Promise<void>((resolve) => {
        resolveFetchStarted = resolve;
      });

      globalThis.fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        resolveFetchStarted?.();
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }) as unknown as typeof fetch;

      try {
        fakeGatewayManager.release.mockClear();
        const adapter = yield* makeHermesAdapter;
        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
          cwd: "/tmp",
        });
        const turnFiber = yield* adapter
          .sendTurn({
            threadId,
            input: "hello",
            interactionMode: "default",
            attachments: [],
          })
          .pipe(Effect.forkChild);

        yield* Effect.promise(() => fetchStarted);
        yield* adapter.stopSession(threadId);
        yield* Fiber.join(turnFiber);

        assert.equal(capturedSignal?.aborted, true);
        assert.deepStrictEqual(fakeGatewayManager.release.mock.calls[0], [threadId]);
        assert.deepStrictEqual(yield* adapter.listSessions(), []);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }),
  );

  it.effect("aborts active Hermes requests when stopping all sessions", () =>
    Effect.gen(function* () {
      const originalFetch = globalThis.fetch;
      let capturedSignal: AbortSignal | undefined;
      let resolveFetchStarted: (() => void) | undefined;
      const fetchStarted = new Promise<void>((resolve) => {
        resolveFetchStarted = resolve;
      });

      globalThis.fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        resolveFetchStarted?.();
        return new Promise<Response>((_resolve, reject) => {
          capturedSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      }) as unknown as typeof fetch;

      try {
        stopAllCalls = 0;
        const adapter = yield* makeHermesAdapter;
        yield* adapter.startSession({
          threadId,
          runtimeMode: "full-access",
          cwd: "/tmp",
        });
        const turnFiber = yield* adapter
          .sendTurn({
            threadId,
            input: "hello",
            interactionMode: "default",
            attachments: [],
          })
          .pipe(Effect.forkChild);

        yield* Effect.promise(() => fetchStarted);
        yield* adapter.stopAll();
        yield* Fiber.join(turnFiber);

        assert.equal(capturedSignal?.aborted, true);
        assert.equal(stopAllCalls, 1);
        assert.deepStrictEqual(yield* adapter.listSessions(), []);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }),
  );
});
