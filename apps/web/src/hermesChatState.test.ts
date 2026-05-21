import { describe, expect, it } from "vitest";
import {
  clearHermesSessionRuntimeState,
  createEmptyHermesSession,
  createInitialHermesChatState,
  deleteHermesSession,
  hydrateHermesSessionFromRelayTranscript,
  renameHermesSessionTitle,
  reduceHermesWsMessage,
  restoreDraftAfterError,
  setDraft,
  setHermesSessionModel,
  stopHermesSessionResponse,
  stopActiveResponse,
  submitUserMessage,
  resolveApprovalPrompt,
  submitStructuredInput,
} from "./hermesChatState";
import type { HermesChatState, HermesSession } from "./hermesChatTypes";

describe("Hermes chat state", () => {
  it("clears stale runtime state from persisted Hermes sessions after app restart", () => {
    const runningSession: HermesSession = {
      ...createEmptyHermesSession("session-stale", "2026-05-14T10:00:00.000Z"),
      isRunning: true,
      activeStartedAt: "2026-05-14T10:00:00.000Z",
      activeAssistantMessageId: "assistant-stale",
      messages: [
        {
          id: "assistant-stale",
          role: "assistant" as const,
          text: "partial",
          createdAt: "2026-05-14T10:00:01.000Z",
          streaming: true,
        },
      ],
      toolCalls: [
        {
          id: "tool-stale",
          name: "terminal",
          status: "running",
          createdAt: "2026-05-14T10:00:02.000Z",
          description: "Running terminal command",
          filePaths: [],
        },
      ],
    };

    const cleared = clearHermesSessionRuntimeState(runningSession, { interrupted: true });

    expect(cleared.isRunning).toBe(false);
    expect(cleared.activeStartedAt).toBeUndefined();
    expect(cleared.activeAssistantMessageId).toBeUndefined();
    expect(cleared.messages[0]).toMatchObject({
      streaming: false,
      interrupted: true,
    });
    expect(cleared.toolCalls[0]).toMatchObject({ status: "completed" });
  });

  it("submits a user message optimistically and auto-titles the session", () => {
    let state = createInitialHermesChatState();
    state = setDraft(state, state.activeSessionId, "List the files in this project");
    state = submitUserMessage(state, "List the files in this project");

    const session = state.sessionsById[state.activeSessionId]!;
    expect(session.draft).toBe("");
    expect(session.title).toBe("List the files in this project");
    expect(session.messages).toMatchObject([
      { role: "user", text: "List the files in this project" },
    ]);
    expect(session.isRunning).toBe(true);
  });

  it("streams assistant text from Hermes content_part.delta events", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "Hello");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.created",
      data: { id: "resp_1", conversation_id: "conv_1" },
    });
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.content_part.delta",
      data: { delta: "Hel" },
    });
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.content_part.delta",
      data: { delta: "lo!" },
    });

    const session = state.sessionsById[state.activeSessionId]!;
    expect(session.responseId).toBe("resp_1");
    expect(session.conversationId).toBe("conv_1");
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "Hello!",
      streaming: true,
    });
  });

  it("streams assistant text from Hermes output_text.delta events", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "Hello");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.created",
      data: { response: { id: "resp_nested" } },
    });
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.output_item.added",
      data: { item: { id: "msg_1", type: "message", role: "assistant" } },
    });
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.output_text.delta",
      data: { delta: "nested output" },
    });
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.completed",
      data: {
        response: {
          id: "resp_nested",
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "nested output" }],
            },
          ],
        },
      },
    });

    const session = state.sessionsById[state.activeSessionId]!;
    expect(session.toolCalls).toHaveLength(0);
    expect(session.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "nested output",
      streaming: false,
    });
  });

  it("renders Hermes tool calls as running and completed indicators", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "List files");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.output_item.added",
      data: {
        item: {
          id: "tool_1",
          type: "tool_call",
          name: "bash",
          command: "ls -la",
        },
      },
    });
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.output_item.done",
      data: { item: { id: "tool_1", name: "bash" } },
    });

    expect(state.sessionsById[state.activeSessionId]!.toolCalls).toMatchObject([
      {
        id: "tool_1",
        name: "bash",
        description: "Running command: ls -la",
        status: "completed",
      },
    ]);
  });

  it("preserves partial assistant content when stopped", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "Write slowly");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.content_part.delta",
      data: { delta: "partial" },
    });
    state = stopActiveResponse(state);

    const assistant = state.sessionsById[state.activeSessionId]!.messages.at(-1)!;
    expect(assistant.text).toBe("partial");
    expect(assistant.streaming).toBe(false);
    expect(assistant.interrupted).toBe(true);
  });

  it("stops a targeted running session without switching the active session", () => {
    const sessionA: HermesSession = {
      ...createEmptyHermesSession("session-a", "2026-05-14T10:00:00.000Z"),
      isRunning: true,
      activeAssistantMessageId: "assistant-a",
      messages: [
        { id: "user-a", role: "user" as const, text: "A", createdAt: "2026-05-14T10:00:00.000Z" },
        {
          id: "assistant-a",
          role: "assistant" as const,
          text: "partial A",
          createdAt: "2026-05-14T10:00:01.000Z",
          streaming: true,
        },
      ],
    };
    const sessionB: HermesSession = {
      ...createEmptyHermesSession("session-b", "2026-05-14T10:01:00.000Z"),
      isRunning: true,
      activeAssistantMessageId: "assistant-b",
      messages: [
        { id: "user-b", role: "user" as const, text: "B", createdAt: "2026-05-14T10:01:00.000Z" },
        {
          id: "assistant-b",
          role: "assistant" as const,
          text: "partial B",
          createdAt: "2026-05-14T10:01:01.000Z",
          streaming: true,
        },
      ],
    };
    const state: HermesChatState = {
      ...createInitialHermesChatState(),
      sessionIds: [sessionA.id, sessionB.id],
      sessionsById: { [sessionA.id]: sessionA, [sessionB.id]: sessionB },
      activeSessionId: sessionB.id,
      requestInFlight: true,
    };

    const next = stopHermesSessionResponse(state, sessionA.id);

    expect(next.activeSessionId).toBe(sessionB.id);
    expect(next.requestInFlight).toBe(true);
    expect(next.sessionsById[sessionA.id]!.isRunning).toBe(false);
    expect(next.sessionsById[sessionA.id]!.messages.at(-1)).toMatchObject({
      text: "partial A",
      streaming: false,
      interrupted: true,
    });
    expect(next.sessionsById[sessionB.id]!.isRunning).toBe(true);
    expect(next.sessionsById[sessionB.id]!.messages.at(-1)).toMatchObject({
      text: "partial B",
      streaming: true,
    });
  });

  it("does not corrupt the fallback active session when an aborted deleted session settles late", () => {
    const runningSession: HermesSession = {
      ...createEmptyHermesSession("running-session"),
      isRunning: true,
      activeAssistantMessageId: "assistant-running",
      messages: [
        {
          id: "assistant-running",
          role: "assistant" as const,
          text: "partial",
          createdAt: "2026-05-14T10:00:00.000Z",
          streaming: true,
        },
      ],
    };
    const fallbackSession: HermesSession = {
      ...createEmptyHermesSession("fallback-session"),
      isRunning: true,
      activeAssistantMessageId: "assistant-fallback",
      messages: [
        {
          id: "assistant-fallback",
          role: "assistant" as const,
          text: "keep streaming",
          createdAt: "2026-05-14T10:01:00.000Z",
          streaming: true,
        },
      ],
    };
    let state: HermesChatState = {
      ...createInitialHermesChatState(),
      sessionIds: [runningSession.id, fallbackSession.id],
      sessionsById: {
        [runningSession.id]: runningSession,
        [fallbackSession.id]: fallbackSession,
      },
      activeSessionId: runningSession.id,
      requestInFlight: true,
    };

    state = deleteHermesSession(
      stopHermesSessionResponse(state, runningSession.id),
      runningSession.id,
    );
    state = stopHermesSessionResponse(state, runningSession.id);

    expect(state.activeSessionId).toBe(fallbackSession.id);
    expect(state.sessionsById[runningSession.id]).toBeUndefined();
    expect(state.sessionsById[fallbackSession.id]!.isRunning).toBe(true);
    expect(state.sessionsById[fallbackSession.id]!.messages.at(-1)).toMatchObject({
      text: "keep streaming",
      streaming: true,
    });
  });

  it("restores failed message text to the composer draft", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "retry me");
    state = restoreDraftAfterError(state, "retry me", "Error: upstream exploded at stack()");

    const session = state.sessionsById[state.activeSessionId]!;
    expect(session.draft).toBe("retry me");
    expect(session.isRunning).toBe(false);
    expect(session.error).toBe(
      "Hermes request failed. Check that the Gateway is reachable and try again.",
    );
  });

  it("marks gateway status from raw WebSocket bridge messages", () => {
    let state = createInitialHermesChatState();
    state = reduceHermesWsMessage(state, {
      type: "gateway.status",
      status: "unreachable",
    });
    expect(state.gatewayStatus).toBe("unreachable");
  });

  it("tracks approval prompts and user decisions", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "Run a command");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "approval.requested",
      data: {
        request_id: "approval-1",
        action: "Run command: rm temp.txt",
        reason: "The agent needs permission before changing files.",
      },
    });

    let session = state.sessionsById[state.activeSessionId]!;
    expect(session.approvals).toMatchObject([
      {
        id: "approval-1",
        action: "Run command: rm temp.txt",
        status: "pending",
      },
    ]);

    state = resolveApprovalPrompt(state, "approval-1", "denied");
    session = state.sessionsById[state.activeSessionId]!;
    expect(session.approvals[0]!.status).toBe("denied");
  });

  it("extracts approval prompts from Hermes output item approval payloads", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "Run a command");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.output_item.added",
      data: {
        item: {
          id: "approval-output-item",
          type: "permission_request",
          input: { command: "ls -la" },
          reason: "Shell commands require approval.",
        },
      },
    });

    const session = state.sessionsById[state.activeSessionId]!;
    expect(session.approvals).toMatchObject([
      {
        id: "approval-output-item",
        action: "ls -la",
        detail: "Shell commands require approval.",
        status: "pending",
      },
    ]);
    expect(session.toolCalls).toHaveLength(0);
  });

  it("preserves session-specific composer drafts without changing active session", () => {
    const initial = createInitialHermesChatState();
    const firstSessionId = initial.activeSessionId;
    const secondSession = createEmptyHermesSession("session-b");
    let state = {
      ...initial,
      sessionIds: [firstSessionId, secondSession.id],
      sessionsById: {
        ...initial.sessionsById,
        [secondSession.id]: secondSession,
      },
    };

    state = setDraft(state, firstSessionId, "draft A");
    state = { ...state, activeSessionId: secondSession.id };
    state = setDraft(state, secondSession.id, "draft B");
    state = setDraft(state, firstSessionId, "updated draft A");

    expect(state.activeSessionId).toBe(secondSession.id);
    expect(state.sessionsById[firstSessionId]!.draft).toBe("updated draft A");
    expect(state.sessionsById[secondSession.id]!.draft).toBe("draft B");
  });

  it("persists selected model on the current Hermes session", () => {
    let state = createInitialHermesChatState();
    const sessionId = state.activeSessionId;

    state = setHermesSessionModel(state, sessionId, "openai-codex/gpt-5.5");

    expect(state.sessionsById[sessionId]!.selectedModel).toBe("openai-codex/gpt-5.5");
  });

  it("hydrates full conversation history from a relay session transcript", () => {
    let state = createInitialHermesChatState();
    state = hydrateHermesSessionFromRelayTranscript(state, {
      session_id: "abc",
      session_start: "2026-05-14T10:00:00Z",
      last_updated: "2026-05-14T10:05:00Z",
      messages: [
        { role: "user", content: "List files" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "tool-1",
              type: "function",
              function: { name: "terminal", arguments: '{"command":"ls"}' },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "tool-1",
          content: '{"output":"README.md", "exit_code":0}',
        },
        { role: "assistant", content: "README.md exists" },
      ],
    });

    const session = state.sessionsById.abc!;
    expect(state.activeSessionId).toBe("abc");
    expect(session.conversationId).toBe("abc");
    expect(session.messages).toMatchObject([
      { role: "user", text: "List files" },
      { role: "assistant", text: "README.md exists", streaming: false },
    ]);
    expect(session.toolCalls).toMatchObject([
      {
        id: "tool-1",
        name: "terminal",
        command: "ls",
        output: "README.md",
        exitCode: 0,
      },
    ]);
  });

  it("does not reactivate an older relay hydration after the user switches sessions", () => {
    const sessionA = createEmptyHermesSession("session-a", "2026-05-14T10:00:00.000Z");
    const sessionB = createEmptyHermesSession("session-b", "2026-05-14T10:01:00.000Z");
    let state = {
      ...createInitialHermesChatState(),
      sessionIds: [sessionA.id, sessionB.id],
      sessionsById: {
        [sessionA.id]: sessionA,
        [sessionB.id]: sessionB,
      },
      activeSessionId: sessionB.id,
    };

    state = hydrateHermesSessionFromRelayTranscript(state, {
      session_id: sessionA.id,
      messages: [{ role: "user", content: "Late response from session A" }],
    });

    expect(state.activeSessionId).toBe(sessionB.id);
    expect(state.sessionsById[sessionA.id]!.messages).toMatchObject([
      { role: "user", text: "Late response from session A" },
    ]);
  });

  it("keeps manually edited titles and hides deleted relay sessions from rehydration", () => {
    let state = hydrateHermesSessionFromRelayTranscript(createInitialHermesChatState(), {
      session_id: "abc",
      messages: [{ role: "user", content: "Original title" }],
    });
    state = renameHermesSessionTitle(state, "abc", "Manual title");
    state = hydrateHermesSessionFromRelayTranscript(state, {
      session_id: "abc",
      messages: [{ role: "user", content: "New first prompt" }],
    });
    expect(state.sessionsById.abc!.title).toBe("Manual title");

    state = deleteHermesSession(state, "abc");
    state = hydrateHermesSessionFromRelayTranscript(state, {
      session_id: "abc",
      messages: [{ role: "user", content: "Should stay hidden" }],
    });
    expect(state.sessionsById.abc).toBeUndefined();
    expect(state.deletedSessionIds).toContain("abc");
  });

  it("tracks structured multi-question input requests", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "Plan a trip");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "user_input.requested",
      data: {
        id: "input-1",
        title: "Choose trip details",
        questions: [
          { id: "destination", label: "Destination?", options: ["Paris", "Rome"] },
          { id: "notes", question: "Anything else?", allowFreeText: true },
        ],
      },
    });

    let session = state.sessionsById[state.activeSessionId]!;
    expect(session.structuredInputs[0]).toMatchObject({
      id: "input-1",
      title: "Choose trip details",
      status: "pending",
      questions: [
        { id: "destination", label: "Destination?", options: ["Paris", "Rome"] },
        { id: "notes", label: "Anything else?", allowFreeText: true },
      ],
    });

    state = submitStructuredInput(state, "input-1");
    session = state.sessionsById[state.activeSessionId]!;
    expect(session.structuredInputs[0]!.status).toBe("submitted");
  });

  it("preserves expandable tool details and context usage", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "List files");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.output_item.added",
      data: {
        item: {
          id: "tool-detail",
          type: "tool_call",
          name: "bash",
          command: "ls apps/web",
          files: ["apps/web/package.json"],
        },
      },
    });
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.output_item.done",
      data: {
        item: {
          id: "tool-detail",
          type: "tool_call",
          name: "bash",
          output: "package.json\nsrc",
          exit_code: 0,
        },
      },
    });
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.usage.updated",
      data: { usage: { used_tokens: 12_000, max_tokens: 16_000 } },
    });

    const session = state.sessionsById[state.activeSessionId]!;
    expect(session.toolCalls[0]).toMatchObject({
      id: "tool-detail",
      command: "ls apps/web",
      output: "package.json\nsrc",
      exitCode: 0,
      filePaths: ["apps/web/package.json"],
    });
    expect(session.contextUsage).toEqual({ usedTokens: 12_000, maxTokens: 16_000 });
  });

  it("updates context usage from completed response metadata", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "Hello");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.completed",
      data: {
        response: {
          usage: {
            total_tokens: 1234,
            max_tokens: 8192,
          },
        },
      },
    });

    expect(state.sessionsById[state.activeSessionId]!.contextUsage).toEqual({
      usedTokens: 1234,
      maxTokens: 8192,
    });
  });

  it("combines completed response usage with Hermes metadata context window", () => {
    let state = submitUserMessage(createInitialHermesChatState(), "Hello");
    state = reduceHermesWsMessage(state, {
      type: "hermes.sse",
      event: "response.completed",
      data: {
        type: "response.completed",
        response: {
          id: "resp_metadata_usage",
          usage: {
            input_tokens: 7_500,
            output_tokens: 1_250,
          },
          metadata: {
            model_context_window: 10_000,
          },
        },
      },
    });

    expect(state.sessionsById[state.activeSessionId]!.contextUsage).toEqual({
      usedTokens: 8_750,
      maxTokens: 10_000,
    });
  });
});
