import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  ArchiveIcon,
  BotIcon,
  CheckIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  Trash2Icon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { cn } from "~/lib/utils";
import { isElectron } from "../env";
import { sanitizeErrorMessage } from "../hermesChatState";
import { useHermesChatStore } from "../hermesChatStore";
import type {
  HermesApprovalPrompt,
  HermesChatMessage,
  HermesContextUsage,
  HermesSession,
  HermesStructuredInputRequest,
  HermesToolCall,
} from "../hermesChatTypes";

function resolveApiUrl(path: string): string {
  const base = import.meta.env.VITE_API_URL;
  if (typeof base === "string" && base.length > 0) {
    return `${base.replace(/\/$/, "")}${path}`;
  }
  return path;
}

function resolveWsUrl(): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (typeof configured === "string" && configured.length > 0) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

export function normalizeWorkspaceFileResults(body: unknown): string[] {
  const records = (body && typeof body === "object" ? body : {}) as {
    files?: unknown;
    entries?: unknown;
    results?: unknown;
  };
  const raw = Array.isArray(records.files)
    ? records.files
    : Array.isArray(records.entries)
      ? records.entries
      : Array.isArray(records.results)
        ? records.results
        : Array.isArray(body)
          ? body
          : [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const candidate = entry as { path?: unknown; relativePath?: unknown; name?: unknown };
        return candidate.path ?? candidate.relativePath ?? candidate.name;
      }
      return undefined;
    })
    .filter((path): path is string => typeof path === "string" && path.length > 0);
}

async function readJsonError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown }; message?: unknown };
    const message = body.error?.message ?? body.message;
    return sanitizeErrorMessage(typeof message === "string" ? message : response.statusText);
  } catch {
    return sanitizeErrorMessage(response.statusText || "Hermes request failed");
  }
}

export default function HermesChatView() {
  const {
    activeSessionId,
    sessionIds,
    sessionsById,
    gatewayStatus,
    websocketStatus,
    requestInFlight,
    createSession,
    selectSession,
    renameSessionTitle,
    archiveSession,
    unarchiveSession,
    deleteSession,
    setDraft,
    submitUserMessage,
    setRequestInFlight,
    restoreDraftAfterError,
    resolveApprovalPrompt,
    submitStructuredInput,
    stopActiveResponse,
    applyWsMessage,
    setWebsocketStatus,
    setGatewayStatus,
    syncRelaySessions,
    hydrateRelaySession,
  } = useHermesChatStore();
  const activeSession = sessionsById[activeSessionId] ?? Object.values(sessionsById)[0]!;
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [sessionSearch, setSessionSearch] = useState("");
  const [sessionSearchResultIds, setSessionSearchResultIds] = useState<readonly string[] | null>(
    null,
  );
  const [showArchivedSessions, setShowArchivedSessions] = useState(false);
  const [sessionPendingDelete, setSessionPendingDelete] = useState<HermesSession | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const failedTextRef = useRef("");

  useEffect(() => {
    let disposed = false;
    void fetch(resolveApiUrl("/health"))
      .then(async (response) => {
        if (disposed) return;
        if (!response.ok) {
          setGatewayStatus("unreachable");
          return;
        }
        const body = (await response.json().catch(() => null)) as { gateway?: unknown } | null;
        setGatewayStatus(body?.gateway === "reachable" ? "reachable" : "unreachable");
      })
      .catch(() => {
        if (!disposed) setGatewayStatus("unreachable");
      });
    void fetch(resolveApiUrl("/api/sessions"))
      .then((response) => (response.ok ? response.json() : []))
      .then((sessions) => {
        if (!disposed && Array.isArray(sessions)) syncRelaySessions(sessions);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [setGatewayStatus, syncRelaySessions]);

  useEffect(() => {
    const query = sessionSearch.trim();
    if (!query) {
      setSessionSearchResultIds(null);
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      void fetch(resolveApiUrl(`/api/sessions?q=${encodeURIComponent(query)}`))
        .then((response) => (response.ok ? response.json() : []))
        .then((sessions) => {
          if (!disposed && Array.isArray(sessions)) {
            setSessionSearchResultIds(
              sessions
                .map((session) =>
                  session && typeof session === "object"
                    ? (session as { id?: unknown }).id
                    : undefined,
                )
                .filter((id): id is string => typeof id === "string"),
            );
            syncRelaySessions(sessions);
          }
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [sessionSearch, syncRelaySessions]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | undefined;
    let socket: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      setWebsocketStatus("connecting");
      socket = new WebSocket(resolveWsUrl());
      socket.addEventListener("open", () => {
        if (!disposed) setWebsocketStatus("connected");
      });
      socket.addEventListener("message", (event) => {
        try {
          applyWsMessage(JSON.parse(String(event.data)));
        } catch {
          // Ignore non-Hermes frames from legacy RPC clients.
        }
      });
      socket.addEventListener("close", () => {
        if (disposed) return;
        setWebsocketStatus("disconnected");
        reconnectTimer = window.setTimeout(connect, 750);
      });
      socket.addEventListener("error", () => {
        if (!disposed) setWebsocketStatus("disconnected");
      });
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [applyWsMessage, setWebsocketStatus]);

  useEffect(() => {
    if (!isAtBottom) return;
    const frame = window.requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeSession.messages, activeSession.toolCalls, activeSession.isRunning, isAtBottom]);

  const sendDisabled =
    requestInFlight ||
    activeSession.isRunning ||
    gatewayStatus === "unreachable" ||
    activeSession.draft.trim().length === 0;

  const sendMessage = useCallback(async () => {
    const text = activeSession.draft.trim();
    if (!text || sendDisabled) return;
    failedTextRef.current = text;
    submitUserMessage(text);
    setRequestInFlight(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(resolveApiUrl("/api/hermes/v1/responses"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: text,
          stream: true,
          ...(activeSession.conversationId
            ? { conversation_id: activeSession.conversationId }
            : {}),
          ...(activeSession.responseId ? { previous_response_id: activeSession.responseId } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await readJsonError(response));
      }
      await response.text();
    } catch (error) {
      if (controller.signal.aborted) {
        stopActiveResponse();
        return;
      }
      restoreDraftAfterError(
        failedTextRef.current,
        sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRequestInFlight(false);
    }
  }, [
    activeSession.conversationId,
    activeSession.draft,
    activeSession.isRunning,
    activeSession.responseId,
    restoreDraftAfterError,
    sendDisabled,
    setRequestInFlight,
    stopActiveResponse,
    submitUserMessage,
  ]);

  const stopResponse = useCallback(() => {
    abortRef.current?.abort();
    stopActiveResponse();
  }, [stopActiveResponse]);

  const handleScroll = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    setIsAtBottom(atBottom);
    setShowScrollToBottom(!atBottom);
  }, []);

  const orderedSessions = useMemo(
    () =>
      sessionIds
        .map((id) => sessionsById[id])
        .filter((session): session is HermesSession => Boolean(session))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [sessionIds, sessionsById],
  );
  const searchText = sessionSearch.trim().toLowerCase();
  const matchesSessionSearch = useCallback(
    (session: HermesSession) =>
      !searchText ||
      sessionSearchResultIds?.includes(session.id) ||
      session.title.toLowerCase().includes(searchText) ||
      session.messages.some((message) => message.text.toLowerCase().includes(searchText)),
    [searchText, sessionSearchResultIds],
  );
  const visibleSessions = orderedSessions.filter(
    (session) => !session.archivedAt && matchesSessionSearch(session),
  );
  const archivedSessions = orderedSessions.filter(
    (session) => session.archivedAt && matchesSessionSearch(session),
  );
  const loadRelaySession = useCallback(
    async (sessionId: string) => {
      if (sessionId.startsWith("local-")) return;
      const response = await fetch(resolveApiUrl(`/api/sessions/${encodeURIComponent(sessionId)}`));
      if (!response.ok) return;
      hydrateRelaySession(await response.json());
    },
    [hydrateRelaySession],
  );
  const selectAndLoadSession = useCallback(
    (sessionId: string) => {
      selectSession(sessionId);
      void loadRelaySession(sessionId);
    },
    [loadRelaySession, selectSession],
  );
  const commitRename = useCallback(() => {
    if (!renamingSessionId) return;
    renameSessionTitle(renamingSessionId, renamingTitle);
    setRenamingSessionId(null);
    setRenamingTitle("");
  }, [renameSessionTitle, renamingSessionId, renamingTitle]);
  const confirmDeleteSession = useCallback(() => {
    if (!sessionPendingDelete) return;
    if (sessionPendingDelete.isRunning) stopResponse();
    deleteSession(sessionPendingDelete.id);
    setSessionPendingDelete(null);
  }, [deleteSession, sessionPendingDelete, stopResponse]);

  return (
    <div className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
        <HermesHeader
          activeSession={activeSession}
          gatewayStatus={gatewayStatus}
          websocketStatus={websocketStatus}
          onNewSession={createSession}
        />
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-64 shrink-0 border-r border-border/60 bg-card/20 p-3 lg:block">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground/65">
                Hermes sessions
              </p>
              <Button
                aria-label="New session"
                size="icon-xs"
                variant="ghost"
                onClick={createSession}
                title="New session"
              >
                <PlusIcon className="size-3.5" />
              </Button>
            </div>
            <label className="mb-2 block">
              <span className="sr-only">Search sessions</span>
              <input
                className="h-8 w-full rounded-lg border border-border/55 bg-background/60 px-2 text-xs outline-none placeholder:text-muted-foreground/45 focus:border-border"
                placeholder="Search sessions..."
                value={sessionSearch}
                onChange={(event) => setSessionSearch(event.target.value)}
              />
            </label>
            <div className="space-y-1 overflow-y-auto">
              {visibleSessions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/50 px-3 py-4 text-center text-xs text-muted-foreground/70">
                  {searchText
                    ? "No matching sessions."
                    : "No sessions yet. Create a session to start chatting."}
                </div>
              ) : null}
              {visibleSessions.map((session) => (
                <HermesSessionRow
                  key={session.id}
                  session={session}
                  activeSessionId={activeSession.id}
                  renamingSessionId={renamingSessionId}
                  renamingTitle={renamingTitle}
                  setRenamingTitle={setRenamingTitle}
                  onCommitRename={commitRename}
                  onCancelRename={() => setRenamingSessionId(null)}
                  onSelect={() => selectAndLoadSession(session.id)}
                  onStartRename={() => {
                    setRenamingSessionId(session.id);
                    setRenamingTitle(session.title);
                  }}
                  onArchive={() => archiveSession(session.id)}
                  onUnarchive={() => unarchiveSession(session.id)}
                  onDelete={() => setSessionPendingDelete(session)}
                />
              ))}
              {archivedSessions.length > 0 ? (
                <div className="pt-2">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between rounded-md px-1 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60 hover:text-foreground"
                    onClick={() => setShowArchivedSessions((value) => !value)}
                  >
                    Archived sessions
                    <span>{showArchivedSessions ? "Hide" : archivedSessions.length}</span>
                  </button>
                  {showArchivedSessions ? (
                    <div className="mt-1 space-y-1">
                      {archivedSessions.map((session) => (
                        <HermesSessionRow
                          key={session.id}
                          session={session}
                          activeSessionId={activeSession.id}
                          renamingSessionId={renamingSessionId}
                          renamingTitle={renamingTitle}
                          setRenamingTitle={setRenamingTitle}
                          onCommitRename={commitRename}
                          onCancelRename={() => setRenamingSessionId(null)}
                          onSelect={() => selectAndLoadSession(session.id)}
                          onStartRename={() => {
                            setRenamingSessionId(session.id);
                            setRenamingTitle(session.title);
                          }}
                          onArchive={() => archiveSession(session.id)}
                          onUnarchive={() => unarchiveSession(session.id)}
                          onDelete={() => setSessionPendingDelete(session)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </aside>
          <main className="relative flex min-w-0 flex-1 flex-col">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
            >
              <div className="mx-auto w-full max-w-3xl space-y-4">
                <GatewayBanner gatewayStatus={gatewayStatus} />
                <HermesTimeline
                  session={activeSession}
                  onApprovalDecision={async (approval, decision) => {
                    resolveApprovalPrompt(
                      approval.id,
                      decision === "approve" ? "approved" : "denied",
                    );
                    await fetch(resolveApiUrl(`/api/hermes/v1/approvals/${approval.id}`), {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ decision, approved: decision === "approve" }),
                    }).catch(() => undefined);
                  }}
                  onStructuredInputSubmit={async (request, answers) => {
                    submitStructuredInput(request.id);
                    await fetch(resolveApiUrl(`/api/hermes/v1/inputs/${request.id}`), {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ answers }),
                    }).catch(() => undefined);
                  }}
                />
              </div>
            </div>
            {showScrollToBottom ? (
              <Button
                className="absolute bottom-28 left-1/2 -translate-x-1/2 shadow-lg"
                size="sm"
                variant="outline"
                onClick={() => {
                  setIsAtBottom(true);
                  setShowScrollToBottom(false);
                  scrollRef.current?.scrollTo({
                    top: scrollRef.current.scrollHeight,
                    behavior: "smooth",
                  });
                }}
              >
                Scroll to bottom
              </Button>
            ) : null}
            <HermesComposer
              draft={activeSession.draft}
              disabled={sendDisabled}
              isRunning={activeSession.isRunning}
              requestInFlight={requestInFlight}
              gatewayDown={gatewayStatus === "unreachable"}
              onDraftChange={(draft) => setDraft(activeSession.id, draft)}
              onSend={sendMessage}
              onStop={stopResponse}
            />
          </main>
        </div>
      </div>
      <DeleteSessionDialog
        session={sessionPendingDelete}
        onCancel={() => setSessionPendingDelete(null)}
        onConfirm={confirmDeleteSession}
      />
    </div>
  );
}

const HermesSessionRow = memo(function HermesSessionRow(props: {
  session: HermesSession;
  activeSessionId: string;
  renamingSessionId: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSelect: () => void;
  onStartRename: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
}) {
  const isRenaming = props.renamingSessionId === props.session.id;
  return (
    <div
      className={cn(
        "group rounded-lg px-2 py-2 text-sm transition-colors",
        props.session.id === props.activeSessionId
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <button type="button" className="w-full text-left" onClick={props.onSelect}>
        {isRenaming ? (
          <input
            autoFocus
            className="w-full rounded-md border border-border/60 bg-background px-1.5 py-1 text-xs text-foreground"
            value={props.renamingTitle}
            onChange={(event) => props.setRenamingTitle(event.target.value)}
            onBlur={props.onCommitRename}
            onClick={(event) => event.stopPropagation()}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") props.onCommitRename();
              if (event.key === "Escape") props.onCancelRename();
            }}
          />
        ) : (
          <span className="line-clamp-1">{props.session.title}</span>
        )}
        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/60">
          {props.session.isRunning ? <Loader2Icon className="size-3 animate-spin" /> : null}
          {new Date(props.session.updatedAt).toLocaleString()}
        </span>
      </button>
      <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          className="rounded p-1 hover:bg-background/70"
          onClick={props.onStartRename}
          aria-label={`Rename ${props.session.title}`}
        >
          <PencilIcon className="size-3" />
        </button>
        <button
          type="button"
          className="rounded p-1 hover:bg-background/70"
          onClick={props.session.archivedAt ? props.onUnarchive : props.onArchive}
          aria-label={`${props.session.archivedAt ? "Unarchive" : "Archive"} ${props.session.title}`}
        >
          <ArchiveIcon className="size-3" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-red-300 hover:bg-red-500/10"
          onClick={props.onDelete}
          aria-label={`Delete ${props.session.title}`}
        >
          <Trash2Icon className="size-3" />
        </button>
      </div>
    </div>
  );
});

function DeleteSessionDialog(props: {
  session: HermesSession | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={Boolean(props.session)}
      onOpenChange={(open) => (!open ? props.onCancel() : null)}
    >
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>
              {props.session
                ? `Delete "${props.session.title}" permanently from this sidebar.`
                : "Delete this session permanently from this sidebar."}
              {props.session?.isRunning
                ? " The running agent turn will be stopped before deletion."
                : " This action cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={props.onCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={props.onConfirm}>
              Delete session
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

const HermesHeader = memo(function HermesHeader(props: {
  activeSession: HermesSession;
  gatewayStatus: string;
  websocketStatus: string;
  onNewSession: () => void;
}) {
  return (
    <header
      className={cn(
        "border-b border-border px-3 sm:px-5",
        isElectron
          ? "drag-region flex h-[52px] items-center wco:h-[env(titlebar-area-height)]"
          : "py-2 sm:py-3",
      )}
    >
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <BotIcon className="size-4 shrink-0 text-muted-foreground/70" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium text-foreground">
              {props.activeSession.title}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground/60">
              <span>
                Gateway {props.gatewayStatus} • WebSocket {props.websocketStatus}
              </span>
              {props.activeSession.contextUsage ? (
                <>
                  <span aria-hidden="true">•</span>
                  <span>
                    Context {props.activeSession.contextUsage.usedTokens.toLocaleString()}
                    {props.activeSession.contextUsage.maxTokens
                      ? ` / ${props.activeSession.contextUsage.maxTokens.toLocaleString()}`
                      : ""}{" "}
                    tokens
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={props.onNewSession}>
          <PlusIcon className="size-4" />
          New chat
        </Button>
      </div>
    </header>
  );
});

function GatewayBanner({ gatewayStatus }: { gatewayStatus: string }) {
  if (gatewayStatus !== "unreachable") return null;
  return (
    <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
      <div className="flex items-start gap-2">
        <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Hermes Gateway is not reachable.</p>
          <p className="mt-1 text-red-100/75">
            Start Hermes Gateway at <code>http://127.0.0.1:8642</code> and try again. Previously
            loaded messages remain available.
          </p>
        </div>
      </div>
    </div>
  );
}

function HermesTimeline({
  session,
  onApprovalDecision,
  onStructuredInputSubmit,
}: {
  session: HermesSession;
  onApprovalDecision: (
    approval: HermesApprovalPrompt,
    decision: "approve" | "deny",
  ) => Promise<void>;
  onStructuredInputSubmit: (
    request: HermesStructuredInputRequest,
    answers: Record<string, string>,
  ) => Promise<void>;
}) {
  const pendingApprovals = (session.approvals ?? []).filter(
    (approval) => approval.status === "pending",
  );
  const pendingInputs = (session.structuredInputs ?? []).filter(
    (input) => input.status === "pending",
  );
  if (
    session.messages.length === 0 &&
    session.toolCalls.length === 0 &&
    pendingApprovals.length === 0 &&
    pendingInputs.length === 0 &&
    !session.isRunning
  ) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="rounded-3xl border border-border/55 bg-card/20 px-8 py-12 text-center shadow-sm/5">
          <h2 className="text-xl font-semibold text-foreground">Start a Hermes conversation</h2>
          <p className="mt-2 text-sm text-muted-foreground/78">
            Type a message below. Responses stream in here with tool activity as it happens.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {session.contextUsage ? <HermesContextUsageMeter usage={session.contextUsage} /> : null}
      {session.messages.map((message) => (
        <HermesMessageBubble key={message.id} message={message} />
      ))}
      {pendingApprovals.map((approval) => (
        <ApprovalPromptCard
          key={approval.id}
          approval={approval}
          onDecision={(decision) => onApprovalDecision(approval, decision)}
        />
      ))}
      {pendingInputs.map((request) => (
        <StructuredInputCard
          key={request.id}
          request={request}
          onSubmit={(answers) => onStructuredInputSubmit(request, answers)}
        />
      ))}
      {session.toolCalls.length > 0 ? (
        <div className="rounded-xl border border-border/45 bg-card/25 px-2 py-1.5">
          <p className="mb-1.5 px-0.5 text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
            Tool calls ({session.toolCalls.length})
          </p>
          <div className="space-y-1">
            {session.toolCalls.map((tool) => (
              <HermesToolCallRow key={tool.id} tool={tool} />
            ))}
          </div>
        </div>
      ) : null}
      {session.isRunning && !session.activeAssistantMessageId ? (
        <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground/70">
          <span className="inline-flex items-center gap-[3px]">
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/30" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/30 [animation-delay:200ms]" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-muted-foreground/30 [animation-delay:400ms]" />
          </span>
          <span>Working...</span>
        </div>
      ) : null}
      {session.error ? (
        <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          <p className="font-medium">Hermes request failed</p>
          <p className="mt-1 text-red-100/75">{session.error}</p>
        </div>
      ) : null}
    </>
  );
}

const HermesMessageBubble = memo(function HermesMessageBubble({
  message,
}: {
  message: HermesChatMessage;
}) {
  const [copied, setCopied] = useState(false);
  const [expandedImage, setExpandedImage] = useState<{ src: string; alt?: string } | null>(null);
  const copyMessage = useCallback(() => {
    if (!message.text || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    void navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }, [message.text]);

  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm border border-border bg-secondary px-4 py-3">
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {message.text}
          </div>
          <p className="mt-1.5 text-right text-xs text-muted-foreground/50">
            {new Date(message.createdAt).toLocaleTimeString()}
          </p>
        </div>
      </div>
    );
  }

  const text = message.text || (message.streaming ? "" : "(empty response)");
  return (
    <div className="min-w-0 px-1 py-0.5">
      <ChatMarkdown
        text={text}
        cwd={undefined}
        isStreaming={Boolean(message.streaming)}
        onImageClick={(src, alt) => setExpandedImage(alt === undefined ? { src } : { src, alt })}
      />
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/40">
        {message.streaming ? <Loader2Icon className="size-3 animate-spin" /> : null}
        {message.interrupted ? <AlertCircleIcon className="size-3 text-amber-400" /> : null}
        <span>
          {message.interrupted ? "Interrupted • " : ""}
          {new Date(message.createdAt).toLocaleTimeString()}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
          onClick={copyMessage}
          disabled={!message.text}
          aria-label="Copy assistant message"
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {expandedImage ? (
        <ImageLightbox image={expandedImage} onClose={() => setExpandedImage(null)} />
      ) : null}
    </div>
  );
});

function HermesToolCallRow({ tool }: { tool: HermesToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const Icon =
    tool.status === "running"
      ? Loader2Icon
      : tool.status === "failed"
        ? AlertCircleIcon
        : CheckCircle2Icon;
  return (
    <div className="rounded-lg text-xs text-muted-foreground/80">
      <button
        type="button"
        className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-secondary/50"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDownIcon className="mt-0.5 size-3.5 shrink-0" />
        ) : (
          <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0" />
        )}
        <WrenchIcon className="mt-0.5 size-3.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground/85">{tool.name}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-[10px]">
              <Icon className={cn("size-3", tool.status === "running" ? "animate-spin" : null)} />
              {tool.status}
            </span>
          </div>
          <p className="mt-0.5 truncate">{tool.description}</p>
        </div>
      </button>
      {expanded ? <HermesToolDetails tool={tool} /> : null}
    </div>
  );
}

function HermesToolDetails({ tool }: { tool: HermesToolCall }) {
  return (
    <div className="mx-2 mb-2 space-y-2 rounded-lg border border-border/55 bg-background/60 p-3">
      {tool.command ? <DetailRow label="Command" value={tool.command} mono /> : null}
      {tool.filePaths.length > 0 ? (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
            File paths
          </p>
          <div className="space-y-1">
            {tool.filePaths.map((path) => (
              <div key={path} className="flex items-center gap-1.5 font-mono text-[11px]">
                <FileIcon className="size-3" />
                {path}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {tool.exitCode !== undefined ? (
        <DetailRow label="Exit code" value={String(tool.exitCode)} />
      ) : null}
      {tool.output ? <DetailBlock label="Output" value={tool.output} /> : null}
      {tool.error ? <DetailBlock label="Error details" value={tool.error} error /> : null}
      {!tool.command && !tool.output && !tool.error && tool.exitCode === undefined ? (
        <DetailBlock
          label="Raw details"
          value={tool.details ?? "No additional details were provided."}
        />
      ) : null}
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
        {label}
      </p>
      <p className={cn("text-foreground/85", mono ? "font-mono text-[11px]" : "text-xs")}>
        {value}
      </p>
    </div>
  );
}

function DetailBlock({
  label,
  value,
  error = false,
}: {
  label: string;
  value: string;
  error?: boolean;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
        {label}
      </p>
      <pre
        className={cn(
          "max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-border/45 bg-black/20 p-2 font-mono text-[11px]",
          error ? "text-red-200" : "text-foreground/85",
        )}
      >
        {value}
      </pre>
    </div>
  );
}

export function HermesContextUsageMeter({ usage }: { usage: HermesContextUsage }) {
  const percentage =
    usage.maxTokens && usage.maxTokens > 0
      ? Math.min(100, (usage.usedTokens / usage.maxTokens) * 100)
      : 0;
  const warning = percentage >= 80;
  return (
    <div className="rounded-xl border border-border/50 bg-card/25 px-3 py-2">
      <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground/70">
        <span>Context window</span>
        <span>
          {usage.usedTokens.toLocaleString()}
          {usage.maxTokens ? ` / ${usage.maxTokens.toLocaleString()}` : ""} tokens
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full", warning ? "bg-amber-400" : "bg-muted-foreground")}
          style={{ width: `${usage.maxTokens ? percentage : 12}%` }}
        />
      </div>
    </div>
  );
}

function ApprovalPromptCard({
  approval,
  onDecision,
}: {
  approval: HermesApprovalPrompt;
  onDecision: (decision: "approve" | "deny") => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const decide = (decision: "approve" | "deny") => {
    setBusy(decision);
    void onDecision(decision).finally(() => setBusy(null));
  };
  return (
    <div className="rounded-xl border border-amber-400/45 bg-amber-400/10 p-4 text-sm">
      <p className="font-medium text-amber-100">Hermes requests approval</p>
      <p className="mt-2 whitespace-pre-wrap text-foreground/85">{approval.action}</p>
      {approval.detail ? (
        <p className="mt-1 text-xs text-muted-foreground">{approval.detail}</p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => decide("approve")} disabled={busy !== null}>
          {busy === "approve" ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <CheckIcon className="size-3" />
          )}
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide("deny")} disabled={busy !== null}>
          {busy === "deny" ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <XIcon className="size-3" />
          )}
          Deny
        </Button>
      </div>
    </div>
  );
}

function StructuredInputCard({
  request,
  onSubmit,
}: {
  request: HermesStructuredInputRequest;
  onSubmit: (answers: Record<string, string>) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="rounded-xl border border-blue-400/35 bg-blue-400/10 p-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSubmit(answers).finally(() => setBusy(false));
      }}
    >
      <p className="font-medium text-blue-100">{request.title}</p>
      <div className="mt-3 space-y-3">
        {request.questions.map((question) => (
          <label key={question.id} className="block space-y-1.5">
            <span className="text-xs font-medium text-foreground/85">{question.label}</span>
            {question.options.length > 0 ? (
              <select
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={answers[question.id] ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                }
              >
                <option value="">Choose an option…</option>
                {question.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {question.allowFreeText ? <option value="__custom__">Custom answer…</option> : null}
              </select>
            ) : null}
            {question.allowFreeText &&
            (question.options.length === 0 || answers[question.id] === "__custom__") ? (
              <textarea
                className="min-h-16 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                value={answers[`${question.id}:custom`] ?? ""}
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: event.target.value,
                    [`${question.id}:custom`]: event.target.value,
                  }))
                }
                placeholder="Type an answer"
              />
            ) : null}
          </label>
        ))}
      </div>
      <Button className="mt-3" size="sm" type="submit" disabled={busy}>
        {busy ? <Loader2Icon className="size-3 animate-spin" /> : null}
        Submit answers
      </Button>
    </form>
  );
}

function ImageLightbox({
  image,
  onClose,
}: {
  image: { src: string; alt?: string };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        type="button"
        className="absolute right-4 top-4 rounded-full bg-background/90 p-2 text-foreground"
        onClick={onClose}
        aria-label="Close expanded image"
      >
        <XIcon className="size-4" />
      </button>
      <img
        src={image.src}
        alt={image.alt ?? ""}
        className="max-h-full max-w-full rounded-xl object-contain"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function HermesComposer(props: {
  draft: string;
  disabled: boolean;
  isRunning: boolean;
  requestInFlight: boolean;
  gatewayDown: boolean;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionFiles, setMentionFiles] = useState<string[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (mentionQuery === null) {
      setMentionFiles([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setMentionLoading(true);
      void fetch(resolveApiUrl(`/api/workspace/files?q=${encodeURIComponent(mentionQuery)}`), {
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : { files: [] }))
        .then((body) => setMentionFiles(normalizeWorkspaceFileResults(body)))
        .catch(() => setMentionFiles([]))
        .finally(() => setMentionLoading(false));
    }, 180);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [mentionQuery]);

  const updateMentionQuery = useCallback((value: string, cursor: number) => {
    const prefix = value.slice(0, cursor);
    const match = prefix.match(/(?:^|\s)@([^\s@]*)$/);
    setMentionQuery(match ? (match[1] ?? "") : null);
  }, []);

  const insertMention = useCallback(
    (path: string) => {
      const node = textareaRef.current;
      const cursor = node?.selectionStart ?? props.draft.length;
      const prefix = props.draft.slice(0, cursor);
      const suffix = props.draft.slice(cursor);
      const match = prefix.match(/(?:^|\s)@([^\s@]*)$/);
      if (!match || match.index === undefined) return;
      const leading = prefix.slice(0, match.index);
      const spacer = match[0].startsWith(" ") ? " " : "";
      const next = `${leading}${spacer}@${path} ${suffix}`;
      props.onDraftChange(next);
      setMentionQuery(null);
      window.requestAnimationFrame(() => node?.focus());
    },
    [props],
  );

  return (
    <form
      className="border-t border-border bg-background/95 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSend();
      }}
    >
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-border bg-card/35 p-2">
        <textarea
          ref={textareaRef}
          className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/40 disabled:opacity-60"
          placeholder={
            props.gatewayDown
              ? "Hermes Gateway is not reachable"
              : "Message Hermes... (Enter to send, Shift+Enter for newline)"
          }
          rows={2}
          value={props.draft}
          disabled={props.gatewayDown}
          onChange={(event) => {
            props.onDraftChange(event.target.value);
            updateMentionQuery(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={(event) => {
            if (mentionQuery !== null && mentionFiles.length > 0 && event.key === "Tab") {
              event.preventDefault();
              insertMention(mentionFiles[0]!);
              return;
            }
            if (mentionQuery !== null && event.key === "Escape") {
              event.preventDefault();
              setMentionQuery(null);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void props.onSend();
            }
          }}
        />
        {props.isRunning ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={props.onStop}
            title="Stop response"
          >
            <SquareIcon className="size-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={props.disabled} title="Send message">
            {props.requestInFlight ? (
              <RefreshCwIcon className="size-4 animate-spin" />
            ) : (
              <SendIcon className="size-4" />
            )}
          </Button>
        )}
      </div>
      {mentionQuery !== null ? (
        <div className="mx-auto mt-2 max-w-3xl rounded-xl border border-border bg-popover p-2 shadow-lg">
          <div className="mb-1 px-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
            {mentionLoading ? "Searching files…" : "File mentions"}
          </div>
          <div className="max-h-48 overflow-auto">
            {mentionFiles.length > 0 ? (
              mentionFiles.map((path) => (
                <button
                  key={path}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-secondary"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertMention(path)}
                >
                  <FileIcon className="size-3.5 text-muted-foreground" />
                  <span className="font-mono">{path}</span>
                </button>
              ))
            ) : (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {mentionLoading ? "Loading workspace files…" : "No files found"}
              </p>
            )}
          </div>
        </div>
      ) : null}
      <p className="mx-auto mt-1 max-w-3xl text-[11px] text-muted-foreground/45">
        Enter sends. Shift+Enter adds a newline. Drafts are preserved per session.
      </p>
    </form>
  );
}
