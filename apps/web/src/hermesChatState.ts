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
    deletedSessionIds: [],
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
    const deletedSessionIds = Array.isArray(parsed.deletedSessionIds)
      ? parsed.deletedSessionIds.filter((id): id is string => typeof id === "string")
      : [];
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
      deletedSessionIds,
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
    deletedSessionIds: state.deletedSessionIds ?? [],
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
  const nextTitle =
    session.messages.length === 0 && !session.titleManuallyEdited
      ? buildSessionTitle(text)
      : session.title;
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

export function selectHermesSession(state: HermesChatState, sessionId: string): HermesChatState {
  if (!state.sessionsById[sessionId] || state.activeSessionId === sessionId) return state;
  return { ...state, activeSessionId: sessionId };
}

export function renameHermesSessionTitle(
  state: HermesChatState,
  sessionId: string,
  title: string,
): HermesChatState {
  const session = state.sessionsById[sessionId];
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!session || !normalized || session.title === normalized) return state;
  return updateSession(state, {
    ...session,
    title: normalized,
    titleManuallyEdited: true,
    updatedAt: nowIso(),
  });
}

export function archiveHermesSession(state: HermesChatState, sessionId: string): HermesChatState {
  const session = state.sessionsById[sessionId];
  if (!session || session.archivedAt) return state;
  return updateSession(state, { ...session, archivedAt: nowIso(), updatedAt: nowIso() });
}

export function unarchiveHermesSession(state: HermesChatState, sessionId: string): HermesChatState {
  const session = state.sessionsById[sessionId];
  if (!session || !session.archivedAt) return state;
  return updateSession(state, { ...session, archivedAt: undefined, updatedAt: nowIso() });
}

export function deleteHermesSession(state: HermesChatState, sessionId: string): HermesChatState {
  if (!state.sessionsById[sessionId]) return state;
  const sessionsById = { ...state.sessionsById };
  delete sessionsById[sessionId];
  const sessionIds = state.sessionIds.filter((id) => id !== sessionId);
  const deletedSessionIds = [...new Set([...(state.deletedSessionIds ?? []), sessionId])];
  if (sessionIds.length === 0) {
    const empty = createEmptyHermesSession();
    return {
      ...state,
      sessionIds: [empty.id],
      deletedSessionIds,
      sessionsById: { [empty.id]: empty },
      activeSessionId: empty.id,
      requestInFlight: false,
    };
  }
  return {
    ...state,
    sessionIds,
    deletedSessionIds,
    sessionsById,
    activeSessionId: state.activeSessionId === sessionId ? sessionIds[0]! : state.activeSessionId,
    requestInFlight: state.activeSessionId === sessionId ? false : state.requestInFlight,
  };
}

export function hydrateHermesSessionFromRelayTranscript(
  state: HermesChatState,
  transcript: unknown,
): HermesChatState {
  if (!isRecord(transcript)) return state;
  const id = readString(transcript, ["session_id", "id", "conversation_id"]);
  if (!id || state.deletedSessionIds.includes(id)) return state;
  const existing = state.sessionsById[id];
  const createdAt =
    normalizeIsoString(readString(transcript, ["session_start", "created_at", "createdAt"])) ??
    existing?.createdAt ??
    nowIso();
  const updatedAt =
    normalizeIsoString(readString(transcript, ["last_updated", "updated_at", "updatedAt"])) ??
    existing?.updatedAt ??
    createdAt;
  const messages = transcriptMessagesToChatMessages(transcript.messages, id, createdAt);
  const toolCalls = transcriptMessagesToToolCalls(transcript.messages, createdAt);
  const inferredTitle =
    readString(transcript, ["title", "name"]) ??
    messages.find((message) => message.role === "user")?.text.slice(0, 80) ??
    existing?.title ??
    "Hermes session";
  const session: HermesSession = {
    ...(existing ?? createEmptyHermesSession(id, createdAt)),
    id,
    title: existing?.titleManuallyEdited ? existing.title : buildSessionTitle(inferredTitle),
    createdAt,
    updatedAt,
    conversationId: id,
    messages,
    toolCalls,
    approvals: existing?.approvals ?? [],
    structuredInputs: existing?.structuredInputs ?? [],
    contextUsage: existing?.contextUsage,
    draft: existing?.draft ?? "",
    isRunning: existing?.isRunning ?? false,
    activeAssistantMessageId: existing?.activeAssistantMessageId,
    activeStartedAt: existing?.activeStartedAt,
    archivedAt: existing?.archivedAt,
    titleManuallyEdited: existing?.titleManuallyEdited,
    error: existing?.error,
  };
  const activeSession = state.sessionsById[state.activeSessionId];
  const shouldActivateHydratedSession =
    state.activeSessionId === id ||
    !activeSession ||
    (state.activeSessionId === DEFAULT_SESSION_ID &&
      activeSession.messages.length === 0 &&
      !activeSession.draft);
  const nextState = updateSession(state, session);
  return {
    ...nextState,
    activeSessionId: shouldActivateHydratedSession ? id : state.activeSessionId,
  };
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

export function setHermesSessionModel(
  state: HermesChatState,
  sessionId: string,
  model: string | undefined,
): HermesChatState {
  const session = state.sessionsById[sessionId];
  if (!session) return state;
  const normalized = model?.trim();
  return updateSession(state, {
    ...session,
    selectedModel: normalized || undefined,
    updatedAt: nowIso(),
  });
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
  return stopHermesSessionResponse(state, state.activeSessionId);
}

export function stopHermesSessionResponse(
  state: HermesChatState,
  sessionId: string,
): HermesChatState {
  const session = state.sessionsById[sessionId];
  if (!session) return { ...state, requestInFlight: false };
  const now = nowIso();
  return updateSession(
    {
      ...state,
      requestInFlight: state.activeSessionId === sessionId ? false : state.requestInFlight,
    },
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
      return applyOutputItemAdded(state, envelope.data);
    case "response.output_item.done":
    case "response.output_item.completed":
      return applyOutputItemDone(state, envelope.data);
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
    case "approval_request.created":
    case "permission.requested":
    case "permission_request.created":
    case "response.approval_requested":
    case "response.requires_approval":
    case "response.permission_requested":
      return applyApprovalRequested(state, envelope.data);
    case "approval.resolved":
    case "approval_request.resolved":
    case "permission.resolved":
    case "permission_request.resolved":
    case "response.approval_resolved":
    case "response.permission_resolved":
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
  const contextUsage = extractContextUsage(data) ?? session.contextUsage;
  return updateSession(state, {
    ...session,
    responseId: responseId ?? session.responseId,
    conversationId: conversationId ?? session.conversationId,
    contextUsage,
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
  const contextUsage = extractContextUsage(data) ?? session.contextUsage;
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
      contextUsage,
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

function applyOutputItemAdded(state: HermesChatState, data: unknown): HermesChatState {
  if (isApprovalRequestPayload(data)) {
    return applyApprovalRequested(state, data);
  }
  return applyToolEvent(state, data, "running");
}

function applyOutputItemDone(state: HermesChatState, data: unknown): HermesChatState {
  if (isApprovalRequestPayload(data)) {
    return applyApprovalResolved(state, data);
  }
  return applyToolEvent(state, data, "completed");
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

function isApprovalRequestPayload(data: unknown): boolean {
  const item =
    readObject(data, "item") ?? readObject(data, "request") ?? (isRecord(data) ? data : undefined);
  if (!item) return false;
  const kind = readString(item, ["type", "kind", "category"]) ?? "";
  const name = readString(item, ["name", "tool_name", "function.name", "call.name"]) ?? "";
  return /approval|permission/i.test(kind) || /approval|permission/i.test(name);
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
      "input.command",
      "arguments.command",
      "item.command",
      "item.description",
      "item.action",
      "item.input.command",
      "item.arguments.command",
      "request.command",
      "request.action",
    ]) ?? "Hermes requests approval to continue";
  const detail = readString(data, [
    "reason",
    "summary",
    "detail",
    "item.reason",
    "item.summary",
    "item.detail",
    "request.reason",
    "request.detail",
  ]);
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
  const sources = [
    readObject(data, "usage"),
    readObject(data, "response.usage"),
    readObject(data, "metadata.usage"),
    readObject(data, "response.metadata.usage"),
    readObject(data, "context_window"),
    readObject(data, "response.context_window"),
    readObject(data, "metadata.context_window"),
    readObject(data, "response.metadata.context_window"),
    readObject(data, "contextWindow"),
    readObject(data, "response.contextWindow"),
    readObject(data, "metadata.contextWindow"),
    readObject(data, "response.metadata.contextWindow"),
    isRecord(data) ? data : undefined,
    readObject(data, "response"),
    readObject(data, "metadata"),
    readObject(data, "response.metadata"),
  ].filter((source): source is Record<string, unknown> => Boolean(source));

  const usedTokens =
    readFirstNumber(sources, [
      "used_tokens",
      "usedTokens",
      "total_tokens",
      "totalTokens",
      "prompt_tokens",
      "promptTokens",
      "context_tokens",
      "contextTokens",
      "context_window.used_tokens",
      "contextWindow.usedTokens",
      "tokens.used",
      "token_counts.total",
      "tokenCounts.total",
      "token_counts.used",
      "tokenCounts.used",
    ]) ?? readSummedTokenUsage(sources);
  const maxTokens =
    readFirstNumber(sources, [
      "max_tokens",
      "maxTokens",
      "model_context_window",
      "modelContextWindow",
      "context_window",
      "contextWindow",
      "context_window.max_tokens",
      "contextWindow.maxTokens",
      "context_window.max",
      "contextWindow.max",
      "tokens.max",
      "token_counts.max",
      "tokenCounts.max",
    ]) ?? null;
  if (usedTokens === undefined) return null;
  return { usedTokens, maxTokens };
}

function readFirstNumber(
  sources: readonly Record<string, unknown>[],
  paths: readonly string[],
): number | undefined {
  for (const source of sources) {
    const value = readNumber(source, paths);
    if (value !== undefined) return value;
  }
  return undefined;
}

function readSummedTokenUsage(sources: readonly Record<string, unknown>[]): number | undefined {
  for (const source of sources) {
    const inputTokens = readNumber(source, [
      "input_tokens",
      "inputTokens",
      "prompt_tokens",
      "promptTokens",
    ]);
    const outputTokens = readNumber(source, [
      "output_tokens",
      "outputTokens",
      "completion_tokens",
      "completionTokens",
    ]);
    if (inputTokens !== undefined || outputTokens !== undefined) {
      return (inputTokens ?? 0) + (outputTokens ?? 0);
    }
  }
  return undefined;
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

function transcriptMessagesToChatMessages(
  value: unknown,
  sessionId: string,
  fallbackCreatedAt: string,
): HermesChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((message, index): HermesChatMessage[] => {
    if (!isRecord(message)) return [];
    const role = readString(message, ["role"]);
    if (role !== "user" && role !== "assistant" && role !== "system") return [];
    const text = textFromTranscriptMessage(message);
    if (!text && role === "assistant") return [];
    const createdAt =
      normalizeIsoString(readString(message, ["created_at", "createdAt", "timestamp", "time"])) ??
      fallbackCreatedAt;
    return [
      {
        id: readString(message, ["id"]) ?? `relay-${sessionId}-${index}`,
        role,
        text,
        createdAt,
        completedAt: role === "assistant" ? createdAt : undefined,
        streaming: false,
      },
    ];
  });
}

function transcriptMessagesToToolCalls(
  value: unknown,
  fallbackCreatedAt: string,
): HermesToolCall[] {
  if (!Array.isArray(value)) return [];
  const toolResults = new Map<string, Record<string, unknown>>();
  for (const message of value) {
    if (!isRecord(message) || readString(message, ["role"]) !== "tool") continue;
    const id = readString(message, ["tool_call_id", "id", "call_id"]);
    if (!id) continue;
    const parsedContent = parseMaybeJson(message.content);
    toolResults.set(
      id,
      isRecord(parsedContent) ? parsedContent : { output: textFromContent(message.content) },
    );
  }

  const tools: HermesToolCall[] = [];
  value.forEach((message, messageIndex) => {
    if (!isRecord(message)) return;
    const rawToolCalls = message.tool_calls;
    if (!Array.isArray(rawToolCalls)) return;
    rawToolCalls.forEach((toolCall, toolIndex) => {
      if (!isRecord(toolCall)) return;
      const id =
        readString(toolCall, ["id", "call_id", "tool_call_id"]) ??
        `relay-tool-${messageIndex}-${toolIndex}`;
      const name = readString(toolCall, ["function.name", "name", "type"]) ?? "tool";
      const argumentsValue = readPath(toolCall, "function.arguments") ?? toolCall.arguments;
      const parsedArguments = parseMaybeJson(argumentsValue);
      const command = isRecord(parsedArguments)
        ? readString(parsedArguments, ["command", "cmd", "input.command"])
        : readString(toolCall, ["command", "input.command"]);
      const result = toolResults.get(id);
      const output = result
        ? readString(result, ["output", "stdout", "result", "content"])
        : undefined;
      const error = result ? readString(result, ["error", "stderr", "message"]) : undefined;
      const exitCode = result ? readNumber(result, ["exit_code", "exitCode"]) : undefined;
      const createdAt =
        normalizeIsoString(readString(message, ["created_at", "createdAt", "timestamp", "time"])) ??
        fallbackCreatedAt;
      tools.push({
        id,
        name,
        description: command ? `Running command: ${command}` : `Using ${name}`,
        status: error ? "failed" : "completed",
        createdAt,
        completedAt: createdAt,
        command,
        output,
        error,
        exitCode,
        filePaths: [],
        details: stringifyDetails(toolCall),
      });
    });
  });
  return tools;
}

function textFromTranscriptMessage(message: Record<string, unknown>): string {
  return textFromContent(message.content);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string"
          ? part
          : isRecord(part)
            ? (readString(part, ["text", "content", "output_text"]) ?? "")
            : "",
      )
      .join("");
  }
  return "";
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeIsoString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function updateSession(state: HermesChatState, session: HermesSession): HermesChatState {
  const sessionAlreadyExists = Boolean(state.sessionsById[session.id]);
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
    activeSessionId: sessionAlreadyExists ? state.activeSessionId : session.id,
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
