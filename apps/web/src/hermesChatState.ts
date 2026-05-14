import type {
  HermesChatMessage,
  HermesChatState,
  HermesContextUsage,
  HermesSession,
  HermesStructuredInputQuestion,
  HermesToolCall,
  HermesToolStatus,
  HermesWsEnvelope,
} from "./hermesChatTypes";

const STORAGE_KEY = "t3delta.hermes.chat.v1";
const ACTIVE_SESSION_KEY = "t3delta.hermes.activeSessionId.v1";
const DEFAULT_SESSION_ID = "local-new-session";
const MAX_TITLE_LENGTH = 48;

export function nowIso(): string {
  return new Date().toISOString();
}

export function createEmptyHermesSession(
  id = DEFAULT_SESSION_ID,
  createdAt = nowIso(),
): HermesSession {
  return {
    id,
    title: "New chat",
    createdAt,
    updatedAt: createdAt,
    messages: [],
    toolCalls: [],
    approvals: [],
    structuredInputs: [],
    draft: "",
    isRunning: false,
  };
}

export function createInitialHermesChatState(): HermesChatState {
  const session = createEmptyHermesSession();
  return {
    sessionIds: [session.id],
    sessionsById: { [session.id]: session },
    activeSessionId: session.id,
    gatewayStatus: "unknown",
    websocketStatus: "connecting",
    requestInFlight: false,
  };
}

export function loadPersistedHermesChatState(): HermesChatState {
  if (typeof window === "undefined") return createInitialHermesChatState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialHermesChatState();
    const parsed = JSON.parse(raw) as Partial<HermesChatState>;
    const sessionIds = Array.isArray(parsed.sessionIds) ? parsed.sessionIds : [];
    const sessionsById =
      parsed.sessionsById && typeof parsed.sessionsById === "object" ? parsed.sessionsById : {};
    const validSessionIds = sessionIds.filter((id) => Boolean(sessionsById[id]));
    if (validSessionIds.length === 0) return createInitialHermesChatState();
    const persistedActiveId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
    const activeSessionId =
      persistedActiveId && sessionsById[persistedActiveId]
        ? persistedActiveId
        : (parsed.activeSessionId && sessionsById[parsed.activeSessionId]
            ? parsed.activeSessionId
            : validSessionIds[0])!;
    return {
      sessionIds: validSessionIds,
      sessionsById: Object.fromEntries(
        validSessionIds.map((id) => {
          const session = sessionsById[id]!;
          return [
            id,
            {
              ...session,
              approvals: session.approvals ?? [],
              structuredInputs: session.structuredInputs ?? [],
              isRunning: false,
              activeAssistantMessageId: undefined,
              activeStartedAt: undefined,
            } satisfies HermesSession,
          ];
        }),
      ),
      activeSessionId,
      gatewayStatus: "unknown",
      websocketStatus: "connecting",
      requestInFlight: false,
    };
  } catch {
    return createInitialHermesChatState();
  }
}

export function persistHermesChatState(state: HermesChatState): void {
  if (typeof window === "undefined") return;
  const persisted: HermesChatState = {
    ...state,
    gatewayStatus: "unknown",
    websocketStatus: "connecting",
    requestInFlight: false,
    sessionsById: Object.fromEntries(
      state.sessionIds.map((id) => {
        const session = state.sessionsById[id]!;
        return [
          id,
          {
            ...session,
            approvals: session.approvals ?? [],
            structuredInputs: session.structuredInputs ?? [],
            isRunning: false,
            activeAssistantMessageId: undefined,
            activeStartedAt: undefined,
          } satisfies HermesSession,
        ];
      }),
    ),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  window.localStorage.setItem(ACTIVE_SESSION_KEY, state.activeSessionId);
}

export function buildSessionTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  return normalized.length <= MAX_TITLE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_TITLE_LENGTH - 1)}…`;
}

export function createUserMessage(text: string, createdAt = nowIso()): HermesChatMessage {
  return {
    id: `user-${cryptoRandomId()}`,
    role: "user",
    text,
    createdAt,
  };
}

export function createAssistantMessage(createdAt = nowIso()): HermesChatMessage {
  return {
    id: `assistant-${cryptoRandomId()}`,
    role: "assistant",
    text: "",
    createdAt,
    streaming: true,
  };
}

export function submitUserMessage(state: HermesChatState, text: string): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  const createdAt = nowIso();
  const userMessage = createUserMessage(text, createdAt);
  const nextTitle = session.messages.length === 0 ? buildSessionTitle(text) : session.title;
  return updateSession(state, {
    ...session,
    title: nextTitle,
    updatedAt: createdAt,
    messages: [...session.messages, userMessage],
    draft: "",
    isRunning: true,
    activeStartedAt: createdAt,
    error: undefined,
  });
}

export function setDraft(
  state: HermesChatState,
  sessionId: string,
  draft: string,
): HermesChatState {
  const session = state.sessionsById[sessionId];
  if (!session || session.draft === draft) return state;
  return updateSession(state, { ...session, draft, updatedAt: nowIso() });
}

export function restoreDraftAfterError(
  state: HermesChatState,
  text: string,
  message: string,
): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  return updateSession(
    {
      ...state,
      requestInFlight: false,
    },
    {
      ...session,
      draft: text,
      isRunning: false,
      error: sanitizeErrorMessage(message),
      updatedAt: nowIso(),
    },
  );
}

export function markRequestInFlight(
  state: HermesChatState,
  requestInFlight: boolean,
): HermesChatState {
  return state.requestInFlight === requestInFlight ? state : { ...state, requestInFlight };
}

export function stopActiveResponse(state: HermesChatState): HermesChatState {
  const session = state.sessionsById[state.activeSessionId];
  if (!session) return { ...state, requestInFlight: false };
  const now = nowIso();
  return updateSession(
    { ...state, requestInFlight: false },
    {
      ...session,
      isRunning: false,
      activeStartedAt: undefined,
      activeAssistantMessageId: undefined,
      updatedAt: now,
      messages: session.messages.map((message) =>
        message.id === session.activeAssistantMessageId
          ? { ...message, streaming: false, interrupted: true, completedAt: now }
          : message,
      ),
      toolCalls: session.toolCalls.map((tool) =>
        tool.status === "running" ? { ...tool, status: "completed", completedAt: now } : tool,
      ),
    },
  );
}

export function reduceHermesWsMessage(
  state: HermesChatState,
  envelope: HermesWsEnvelope,
): HermesChatState {
  if (envelope.type === "gateway.status") {
    const status = envelope.status === "reachable" ? "reachable" : "unreachable";
    return { ...state, gatewayStatus: status };
  }

  if (envelope.type === "hermes.sse.interrupted") {
    const session = state.sessionsById[state.activeSessionId];
    if (!session?.isRunning) return state;
    const message = extractErrorMessage(envelope.error) ?? "Hermes stream interrupted unexpectedly";
    return markActiveAssistantInterrupted(state, sanitizeErrorMessage(message));
  }

  if (envelope.type !== "hermes.sse" || typeof envelope.event !== "string") {
    return state;
  }

  switch (envelope.event) {
    case "response.created":
      return applyResponseCreated(state, envelope.data);
    case "response.output_item.added":
      return applyToolEvent(state, envelope.data, "running");
    case "response.output_item.done":
    case "response.output_item.completed":
      return applyToolEvent(state, envelope.data, "completed");
    case "response.content_part.added":
      return ensureAssistantMessage(state, envelope.data);
    case "response.content_part.delta":
    case "response.output_text.delta":
      return applyContentDelta(state, envelope.data);
    case "response.output_text.done":
      return applyOutputTextDone(state, envelope.data);
    case "response.completed":
      return applyResponseCompleted(state, envelope.data);
    case "response.failed":
      return applyResponseFailed(state, envelope.data);
    case "approval.requested":
    case "response.approval_requested":
    case "response.requires_approval":
      return applyApprovalRequested(state, envelope.data);
    case "approval.resolved":
    case "response.approval_resolved":
      return applyApprovalResolved(state, envelope.data);
    case "user_input.requested":
    case "user-input.requested":
    case "response.input_requested":
    case "response.requires_input":
      return applyStructuredInputRequested(state, envelope.data);
    case "user_input.resolved":
    case "user-input.resolved":
    case "response.input_resolved":
      return applyStructuredInputResolved(state, envelope.data);
    case "response.usage.updated":
    case "context_window.updated":
      return applyContextUsage(state, envelope.data);
    case "response.cancelled":
    case "response.canceled":
      return stopActiveResponse(state);
    default:
      return state;
  }
}

export function resolveApprovalPrompt(
  state: HermesChatState,
  approvalId: string,
  decision: "approved" | "denied",
): HermesChatState {
  const session = state.sessionsById[state.activeSessionId];
  if (!session) return state;
  return updateSession(state, {
    ...session,
    approvals: (session.approvals ?? []).map((approval) =>
      approval.id === approvalId ? { ...approval, status: decision } : approval,
    ),
    updatedAt: nowIso(),
  });
}

export function submitStructuredInput(state: HermesChatState, requestId: string): HermesChatState {
  const session = state.sessionsById[state.activeSessionId];
  if (!session) return state;
  return updateSession(state, {
    ...session,
    structuredInputs: (session.structuredInputs ?? []).map((request) =>
      request.id === requestId ? { ...request, status: "submitted" } : request,
    ),
    updatedAt: nowIso(),
  });
}

function applyResponseCreated(state: HermesChatState, data: unknown): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  const responseId = readString(data, ["id", "response_id", "response.id"]);
  const conversationId = readString(data, [
    "conversation_id",
    "conversation.id",
    "response.conversation_id",
    "response.conversation.id",
  ]);
  const createdAt = nowIso();
  return updateSession(state, {
    ...session,
    responseId: responseId ?? session.responseId,
    conversationId: conversationId ?? session.conversationId,
    isRunning: true,
    activeStartedAt: session.activeStartedAt ?? createdAt,
    updatedAt: createdAt,
    error: undefined,
  });
}

function ensureAssistantMessage(state: HermesChatState, data: unknown): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  if (session.activeAssistantMessageId) return state;
  const createdAt = nowIso();
  const message = createAssistantMessage(createdAt);
  const responseId = readString(data, ["response_id", "id"]) ?? session.responseId;
  return updateSession(state, {
    ...session,
    responseId,
    isRunning: true,
    activeAssistantMessageId: message.id,
    activeStartedAt: session.activeStartedAt ?? createdAt,
    updatedAt: createdAt,
    messages: [...session.messages, message],
  });
}

function applyContentDelta(state: HermesChatState, data: unknown): HermesChatState {
  const delta = extractTextDelta(data);
  if (!delta) return ensureAssistantMessage(state, data);
  const ensured = ensureAssistantMessage(state, data);
  const session = ensured.sessionsById[ensured.activeSessionId]!;
  const activeMessageId = session.activeAssistantMessageId;
  return updateSession(ensured, {
    ...session,
    updatedAt: nowIso(),
    messages: session.messages.map((message) =>
      message.id === activeMessageId ? { ...message, text: `${message.text}${delta}` } : message,
    ),
  });
}

function applyOutputTextDone(state: HermesChatState, data: unknown): HermesChatState {
  const text = readString(data, ["text"]);
  if (!text) return state;
  const ensured = ensureAssistantMessage(state, data);
  const session = ensured.sessionsById[ensured.activeSessionId]!;
  const activeMessageId = session.activeAssistantMessageId;
  const now = nowIso();
  return updateSession(
    { ...ensured, requestInFlight: false },
    {
      ...session,
      isRunning: false,
      activeAssistantMessageId: undefined,
      activeStartedAt: undefined,
      updatedAt: now,
      messages: session.messages.map((message) =>
        message.id === activeMessageId && text.length > message.text.length
          ? { ...message, text, streaming: false, completedAt: now }
          : message.id === activeMessageId
            ? { ...message, streaming: false, completedAt: now }
            : message,
      ),
    },
  );
}

function applyResponseCompleted(state: HermesChatState, data: unknown): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  const now = nowIso();
  const responseId = readString(data, ["id", "response_id", "response.id"]) ?? session.responseId;
  const conversationId =
    readString(data, [
      "conversation_id",
      "conversation.id",
      "response.conversation_id",
      "response.conversation.id",
    ]) ?? session.conversationId;
  const finalText = extractFinalText(data);
  const messages =
    session.activeAssistantMessageId && (finalText === undefined || finalText.length === 0)
      ? session.messages
      : ensureFinalAssistantText(session, finalText ?? "", now);
  return updateSession(
    { ...state, requestInFlight: false },
    {
      ...session,
      responseId,
      conversationId,
      messages: messages.map((message) =>
        message.id === session.activeAssistantMessageId
          ? { ...message, streaming: false, completedAt: now }
          : message,
      ),
      toolCalls: session.toolCalls.map((tool) =>
        tool.status === "running" ? { ...tool, status: "completed", completedAt: now } : tool,
      ),
      isRunning: false,
      activeAssistantMessageId: undefined,
      activeStartedAt: undefined,
      updatedAt: now,
      error: undefined,
    },
  );
}

function applyResponseFailed(state: HermesChatState, data: unknown): HermesChatState {
  const message = extractErrorMessage(data) ?? "Hermes response failed";
  return markActiveAssistantInterrupted(state, sanitizeErrorMessage(message));
}

function markActiveAssistantInterrupted(state: HermesChatState, error: string): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  const now = nowIso();
  return updateSession(
    { ...state, requestInFlight: false },
    {
      ...session,
      error,
      isRunning: false,
      activeAssistantMessageId: undefined,
      activeStartedAt: undefined,
      updatedAt: now,
      messages: session.messages.map((message) =>
        message.id === session.activeAssistantMessageId
          ? { ...message, streaming: false, interrupted: true, error, completedAt: now }
          : message,
      ),
      toolCalls: session.toolCalls.map((tool) =>
        tool.status === "running" ? { ...tool, status: "failed", completedAt: now } : tool,
      ),
    },
  );
}

function applyToolEvent(
  state: HermesChatState,
  data: unknown,
  status: HermesToolStatus,
): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  const tool = extractToolCall(data, status);
  if (!tool) return state;
  const existing = session.toolCalls.find((entry) => entry.id === tool.id);
  const now = nowIso();
  return updateSession(state, {
    ...session,
    isRunning: status === "running" ? true : session.isRunning,
    activeStartedAt: session.activeStartedAt ?? now,
    updatedAt: now,
    toolCalls: existing
      ? session.toolCalls.map((entry) =>
          entry.id === tool.id
            ? {
                ...entry,
                ...tool,
                createdAt: entry.createdAt,
                filePaths: mergeStrings(entry.filePaths, tool.filePaths),
                output: tool.output ?? entry.output,
                error: tool.error ?? entry.error,
                exitCode: tool.exitCode ?? entry.exitCode,
                command: tool.command ?? entry.command,
                description:
                  tool.description === `Using ${tool.name}` ? entry.description : tool.description,
                completedAt: status === "running" ? entry.completedAt : now,
              }
            : entry,
        )
      : [...session.toolCalls, tool],
  });
}

function extractToolCall(data: unknown, status: HermesToolStatus): HermesToolCall | null {
  const item = readObject(data, "item") ?? (isRecord(data) ? data : undefined);
  if (!item) return null;
  const kind = readString(item, ["type", "kind"]) ?? "";
  const explicitName = readString(item, ["name", "tool_name", "function.name", "call.name"]);
  if (
    kind === "message" ||
    kind === "output_text" ||
    (!explicitName && !/tool|function|call/i.test(kind))
  ) {
    return null;
  }
  const name = explicitName ?? (kind.includes("tool") || kind.includes("function") ? kind : "tool");
  const id =
    readString(item, ["id", "call_id", "tool_call_id"]) ?? `tool-${name}-${cryptoRandomId()}`;
  const command = readString(item, ["command", "arguments.command", "input.command"]);
  const path = readString(item, ["path", "file_path", "input.path"]);
  const output = readString(item, [
    "output",
    "result.output",
    "result.stdout",
    "stdout",
    "content.output",
  ]);
  const error = readString(item, ["error.message", "error", "stderr", "result.stderr"]);
  const exitCode = readNumber(item, [
    "exit_code",
    "exitCode",
    "result.exit_code",
    "result.exitCode",
  ]);
  const filePaths = extractFilePaths(item);
  const description =
    readString(item, ["description", "summary", "input", "arguments"]) ??
    (command ? `Running command: ${command}` : path ? `Using file: ${path}` : `Using ${name}`);
  return {
    id,
    name,
    description: typeof description === "string" ? description : String(description),
    status,
    createdAt: nowIso(),
    command,
    output,
    error,
    exitCode,
    filePaths,
    details: stringifyDetails(item),
    ...(status === "running" ? {} : { completedAt: nowIso() }),
  };
}

function applyApprovalRequested(state: HermesChatState, data: unknown): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  const now = nowIso();
  const id =
    readString(data, ["id", "request_id", "approval_id", "item.id", "data.id"]) ??
    `approval-${cryptoRandomId()}`;
  const action =
    readString(data, [
      "action",
      "description",
      "detail",
      "command",
      "item.command",
      "item.description",
      "request.action",
    ]) ?? "Hermes requests approval to continue";
  const detail = readString(data, ["reason", "summary", "item.summary", "request.detail"]);
  const approvals = session.approvals ?? [];
  return updateSession(state, {
    ...session,
    isRunning: true,
    activeStartedAt: session.activeStartedAt ?? now,
    updatedAt: now,
    approvals: approvals.some((approval) => approval.id === id)
      ? approvals.map((approval) =>
          approval.id === id ? { ...approval, action, detail, status: "pending" } : approval,
        )
      : [...approvals, { id, action, detail, status: "pending", createdAt: now }],
  });
}

function applyApprovalResolved(state: HermesChatState, data: unknown): HermesChatState {
  const id = readString(data, ["id", "request_id", "approval_id"]);
  if (!id) return state;
  const approved = readBoolean(data, ["approved", "accepted", "decision.approved"]);
  return resolveApprovalPrompt(state, id, approved === false ? "denied" : "approved");
}

function applyStructuredInputRequested(state: HermesChatState, data: unknown): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  const now = nowIso();
  const id = readString(data, ["id", "request_id", "input_id"]) ?? `input-${cryptoRandomId()}`;
  const questions = extractQuestions(data);
  if (questions.length === 0) return state;
  const title =
    readString(data, ["title", "prompt", "description"]) ?? "Hermes needs more information";
  const existing = session.structuredInputs ?? [];
  return updateSession(state, {
    ...session,
    isRunning: true,
    activeStartedAt: session.activeStartedAt ?? now,
    updatedAt: now,
    structuredInputs: existing.some((request) => request.id === id)
      ? existing.map((request) =>
          request.id === id ? { ...request, title, questions, status: "pending" } : request,
        )
      : [...existing, { id, title, questions, status: "pending", createdAt: now }],
  });
}

function applyStructuredInputResolved(state: HermesChatState, data: unknown): HermesChatState {
  const id = readString(data, ["id", "request_id", "input_id"]);
  return id ? submitStructuredInput(state, id) : state;
}

function applyContextUsage(state: HermesChatState, data: unknown): HermesChatState {
  const session = state.sessionsById[state.activeSessionId] ?? createEmptyHermesSession();
  const usage = extractContextUsage(data);
  if (!usage) return state;
  return updateSession(state, { ...session, contextUsage: usage, updatedAt: nowIso() });
}

function ensureFinalAssistantText(
  session: HermesSession,
  finalText: string,
  completedAt: string,
): HermesChatMessage[] {
  if (session.activeAssistantMessageId) {
    return session.messages.map((message) =>
      message.id === session.activeAssistantMessageId && finalText.length > message.text.length
        ? { ...message, text: finalText, completedAt, streaming: false }
        : message,
    );
  }
  if (!finalText) return session.messages;
  const lastAssistant = session.messages
    .toReversed()
    .find((message) => message.role === "assistant");
  if (lastAssistant && lastAssistant.text === finalText) {
    return session.messages.map((message) =>
      message.id === lastAssistant.id ? { ...message, completedAt, streaming: false } : message,
    );
  }
  return [
    ...session.messages,
    {
      id: `assistant-${cryptoRandomId()}`,
      role: "assistant",
      text: finalText,
      createdAt: completedAt,
      completedAt,
      streaming: false,
    },
  ];
}

export function sanitizeErrorMessage(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "Hermes request failed";
  if (
    /at\s+[\w./:-]+\(.+\)/.test(trimmed) ||
    trimmed.includes("Error: Error:") ||
    /^Error: .+\bat\b.+\(/.test(trimmed)
  ) {
    return "Hermes request failed. Check that the Gateway is reachable and try again.";
  }
  return trimmed.length > 220 ? `${trimmed.slice(0, 217)}…` : trimmed;
}

function extractTextDelta(data: unknown): string {
  return readString(data, ["delta", "text", "content", "part.text", "item.content"]) ?? "";
}

function extractFinalText(data: unknown): string | undefined {
  const direct = readString(data, ["output_text", "text", "content"]);
  if (direct) return direct;
  const source = readObject(data, "response") ?? (isRecord(data) ? data : undefined);
  if (!source) return undefined;
  const output = source.output;
  if (!Array.isArray(output)) return undefined;
  const parts: string[] = [];
  for (const item of output) {
    const content = isRecord(item) ? item.content : undefined;
    if (Array.isArray(content)) {
      for (const part of content) {
        const text = readString(part, ["text", "content"]);
        if (text) parts.push(text);
      }
    }
  }
  return parts.length > 0 ? parts.join("") : undefined;
}

function extractErrorMessage(data: unknown): string | undefined {
  return readString(data, ["message", "error.message", "error", "failure.message"]);
}

function extractContextUsage(data: unknown): HermesContextUsage | null {
  const source = readObject(data, "usage") ?? readObject(data, "response.usage") ?? data;
  const usedTokens = readNumber(source, [
    "used_tokens",
    "usedTokens",
    "input_tokens",
    "total_tokens",
    "tokens.used",
  ]);
  const maxTokens =
    readNumber(source, ["max_tokens", "maxTokens", "context_window", "contextWindow"]) ?? null;
  if (usedTokens === undefined) return null;
  return { usedTokens, maxTokens };
}

function extractQuestions(data: unknown): HermesStructuredInputQuestion[] {
  const rawQuestions = readPath(data, "questions") ?? readPath(data, "input.questions");
  if (!Array.isArray(rawQuestions)) return [];
  return rawQuestions.flatMap((question, index): HermesStructuredInputQuestion[] => {
    if (!isRecord(question)) return [];
    const label =
      readString(question, ["label", "question", "prompt", "text"]) ?? `Question ${index + 1}`;
    const id = readString(question, ["id", "name", "key"]) ?? `question-${index + 1}`;
    const rawOptions = question.options ?? question.choices;
    const options = Array.isArray(rawOptions)
      ? rawOptions
          .map((option) =>
            typeof option === "string"
              ? option
              : (readString(option, ["label", "value", "text", "name"]) ?? ""),
          )
          .filter((option) => option.length > 0)
      : [];
    const allowFreeText = readBoolean(question, ["allow_free_text", "allowFreeText", "free_text"]);
    return [{ id, label, options, allowFreeText: allowFreeText ?? options.length === 0 }];
  });
}

function extractFilePaths(item: Record<string, unknown>): string[] {
  const paths = new Set<string>();
  for (const path of [
    readString(item, ["path", "file_path", "input.path"]),
    readString(item, ["file", "filename", "input.file"]),
  ]) {
    if (path) paths.add(path);
  }
  for (const key of ["files", "file_paths", "paths", "result.files"]) {
    const value = readPath(item, key);
    if (Array.isArray(value)) {
      for (const entry of value) {
        const path =
          typeof entry === "string" ? entry : readString(entry, ["path", "file_path", "name"]);
        if (path) paths.add(path);
      }
    }
  }
  return [...paths];
}

function stringifyDetails(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

function mergeStrings(left: readonly string[] = [], right: readonly string[] = []): string[] {
  return [...new Set([...left, ...right])];
}

function updateSession(state: HermesChatState, session: HermesSession): HermesChatState {
  const sessionIds = state.sessionIds.includes(session.id)
    ? state.sessionIds
    : [session.id, ...state.sessionIds];
  return {
    ...state,
    sessionIds,
    sessionsById: {
      ...state.sessionsById,
      [session.id]: session,
    },
    activeSessionId: session.id,
  };
}

function readObject(value: unknown, path: string): Record<string, unknown> | undefined {
  const next = readPath(value, path);
  return isRecord(next) ? next : undefined;
}

function readString(value: unknown, paths: readonly string[]): string | undefined {
  for (const path of paths) {
    const next = readPath(value, path);
    if (typeof next === "string" && next.length > 0) return next;
    if (typeof next === "number") return String(next);
  }
  return undefined;
}

function readNumber(value: unknown, paths: readonly string[]): number | undefined {
  for (const path of paths) {
    const next = readPath(value, path);
    if (typeof next === "number" && Number.isFinite(next)) return next;
    if (typeof next === "string" && next.trim().length > 0) {
      const parsed = Number(next);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function readBoolean(value: unknown, paths: readonly string[]): boolean | undefined {
  for (const path of paths) {
    const next = readPath(value, path);
    if (typeof next === "boolean") return next;
    if (typeof next === "string") {
      if (/^(true|approved|yes|allow)$/i.test(next)) return true;
      if (/^(false|denied|no|deny)$/i.test(next)) return false;
    }
  }
  return undefined;
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) return undefined;
    return current[key];
  }, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
