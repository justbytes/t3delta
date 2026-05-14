import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SendIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import ChatMarkdown from "./ChatMarkdown";
import { Button } from "./ui/button";
import { cn } from "~/lib/utils";
import { isElectron } from "../env";
import { sanitizeErrorMessage } from "../hermesChatState";
import { useHermesChatStore } from "../hermesChatStore";
import type { HermesChatMessage, HermesSession, HermesToolCall } from "../hermesChatTypes";

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
    setDraft,
    submitUserMessage,
    setRequestInFlight,
    restoreDraftAfterError,
    stopActiveResponse,
    applyWsMessage,
    setWebsocketStatus,
    setGatewayStatus,
    syncRelaySessions,
  } = useHermesChatStore();
  const activeSession = sessionsById[activeSessionId] ?? Object.values(sessionsById)[0]!;
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
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
              <Button size="icon-xs" variant="ghost" onClick={createSession} title="New session">
                <PlusIcon className="size-3.5" />
              </Button>
            </div>
            <div className="space-y-1 overflow-y-auto">
              {orderedSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className={cn(
                    "w-full rounded-lg px-2 py-2 text-left text-sm transition-colors",
                    session.id === activeSession.id
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                  onClick={() => selectSession(session.id)}
                >
                  <span className="line-clamp-1">{session.title}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/60">
                    {session.isRunning ? <Loader2Icon className="size-3 animate-spin" /> : null}
                    {new Date(session.updatedAt).toLocaleString()}
                  </span>
                </button>
              ))}
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
                <HermesTimeline session={activeSession} />
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
    </div>
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
            <p className="text-[11px] text-muted-foreground/60">
              Gateway {props.gatewayStatus} • WebSocket {props.websocketStatus}
            </p>
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

function HermesTimeline({ session }: { session: HermesSession }) {
  if (session.messages.length === 0 && session.toolCalls.length === 0 && !session.isRunning) {
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
      {session.messages.map((message) => (
        <HermesMessageBubble key={message.id} message={message} />
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
      <ChatMarkdown text={text} cwd={undefined} isStreaming={Boolean(message.streaming)} />
      <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground/40">
        {message.streaming ? <Loader2Icon className="size-3 animate-spin" /> : null}
        {message.interrupted ? <AlertCircleIcon className="size-3 text-amber-400" /> : null}
        <span>
          {message.interrupted ? "Interrupted • " : ""}
          {new Date(message.createdAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
});

function HermesToolCallRow({ tool }: { tool: HermesToolCall }) {
  const Icon =
    tool.status === "running"
      ? Loader2Icon
      : tool.status === "failed"
        ? AlertCircleIcon
        : CheckCircle2Icon;
  return (
    <div className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs text-muted-foreground/80">
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
          className="min-h-12 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground/40 disabled:opacity-60"
          placeholder={
            props.gatewayDown
              ? "Hermes Gateway is not reachable"
              : "Message Hermes... (Enter to send, Shift+Enter for newline)"
          }
          rows={2}
          value={props.draft}
          disabled={props.gatewayDown}
          onChange={(event) => props.onDraftChange(event.target.value)}
          onKeyDown={(event) => {
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
      <p className="mx-auto mt-1 max-w-3xl text-[11px] text-muted-foreground/45">
        Enter sends. Shift+Enter adds a newline. Drafts are preserved per session.
      </p>
    </form>
  );
}
