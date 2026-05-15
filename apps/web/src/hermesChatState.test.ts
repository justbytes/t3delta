import { describe, expect, it } from "vitest";
import {
  createEmptyHermesSession,
  createInitialHermesChatState,
  reduceHermesWsMessage,
  restoreDraftAfterError,
  setDraft,
  stopActiveResponse,
  submitUserMessage,
  resolveApprovalPrompt,
  submitStructuredInput,
} from "./hermesChatState";

describe("Hermes chat state", () => {
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
});
