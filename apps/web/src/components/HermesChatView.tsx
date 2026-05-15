import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircleIcon,
  ArchiveIcon,
  BoxIcon,
  BotIcon,
  BrainIcon,
  CheckIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  FolderTreeIcon,
  GitCompareIcon,
  GlobeIcon,
  ImageIcon,
  ListTodoIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
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
import {
  buildHermesSlashCommands,
  filterHermesSkills,
  filterHermesSlashCommands,
  hermesSkillsHubCatalog,
  normalizeHermesSkills,
} from "../hermesSkills";
import type { HermesHubSkill, HermesSkillSummary, HermesSlashCommand } from "../hermesSkills";
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

export interface HermesModelOption {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface HermesMemoryDocument {
  readonly file: "memory" | "user";
  readonly title: string;
  readonly filename: string;
  readonly content: string;
}

export type HermesJobStatus = "running" | "paused" | "completed" | "failed" | "scheduled";

export interface HermesJobSummary {
  readonly id: string;
  readonly name: string;
  readonly schedule: string;
  readonly status: HermesJobStatus;
  readonly config: string;
  readonly output: string;
  readonly error: string;
  readonly history: readonly string[];
}

function readRecordString(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function readRecordBool(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => record[key] === true);
}

function formatJson(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function normalizeHermesModels(body: unknown): HermesModelOption[] {
  const records = (body && typeof body === "object" ? body : {}) as {
    data?: unknown;
    models?: unknown;
    default_model?: unknown;
    defaultModel?: unknown;
  };
  const defaultModel =
    typeof records.default_model === "string"
      ? records.default_model
      : typeof records.defaultModel === "string"
        ? records.defaultModel
        : undefined;
  const raw = Array.isArray(records.data)
    ? records.data
    : Array.isArray(records.models)
      ? records.models
      : Array.isArray(body)
        ? body
        : [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") {
        const [provider, ...nameParts] = entry.split("/");
        return {
          id: entry,
          provider: nameParts.length > 0 ? provider! : "Hermes",
          name: nameParts.length > 0 ? nameParts.join("/") : entry,
          isDefault: entry === defaultModel,
        } satisfies HermesModelOption;
      }
      if (entry && typeof entry === "object") {
        const candidate = entry as Record<string, unknown>;
        const id = readRecordString(candidate, ["id", "model", "slug", "name"]);
        if (!id) return undefined;
        const provider =
          readRecordString(candidate, ["provider", "owned_by", "provider_name"]) ??
          (id.includes("/") ? id.split("/")[0]! : "Hermes");
        const name =
          readRecordString(candidate, ["display_name", "label", "name"]) ??
          (id.includes("/") ? id.split("/").slice(1).join("/") : id);
        return {
          id,
          provider,
          name,
          isDefault: readRecordBool(candidate, ["default", "is_default"]) || id === defaultModel,
        } satisfies HermesModelOption;
      }
      return undefined;
    })
    .filter((model): model is HermesModelOption => Boolean(model));
}

export function normalizeHermesMemory(body: unknown): HermesMemoryDocument[] {
  const records = (body && typeof body === "object" ? body : {}) as {
    memory?: unknown;
    user?: unknown;
  };
  return [
    {
      file: "memory",
      title: "Agent memory",
      filename: "MEMORY.md",
      content: typeof records.memory === "string" ? records.memory : "",
    },
    {
      file: "user",
      title: "User profile",
      filename: "USER.md",
      content: typeof records.user === "string" ? records.user : "",
    },
  ];
}

function normalizeJobStatus(value: unknown): HermesJobStatus {
  const status = typeof value === "string" ? value.toLowerCase() : "";
  if (status === "running" || status === "active") return "running";
  if (status === "paused" || status === "disabled") return "paused";
  if (status === "completed" || status === "success" || status === "succeeded") return "completed";
  if (status === "failed" || status === "error") return "failed";
  return "scheduled";
}

export function normalizeHermesJobs(body: unknown): HermesJobSummary[] {
  const records = (body && typeof body === "object" ? body : {}) as {
    jobs?: unknown;
    data?: unknown;
    results?: unknown;
  };
  const raw = Array.isArray(records.jobs)
    ? records.jobs
    : Array.isArray(records.data)
      ? records.data
      : Array.isArray(records.results)
        ? records.results
        : Array.isArray(body)
          ? body
          : [];
  return raw.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const id = readRecordString(record, ["id", "job_id", "name"]) ?? `job-${index}`;
    const historySource = Array.isArray(record.history)
      ? record.history
      : Array.isArray(record.executions)
        ? record.executions
        : [];
    return [
      {
        id,
        name: readRecordString(record, ["name", "title", "description"]) ?? id,
        schedule:
          readRecordString(record, ["schedule", "cron", "interval", "next_run"]) ?? "Manual",
        status: normalizeJobStatus(record.status ?? record.state),
        config: formatJson(record.config ?? {}),
        output: formatJson(record.output ?? record.last_output ?? record.stdout),
        error: formatJson(record.error ?? record.last_error ?? record.stderr),
        history: historySource.map((item) => formatJson(item)).filter(Boolean),
      } satisfies HermesJobSummary,
    ];
  });
}

const HERMES_OPEN_PANELS_KEY = "t3delta.hermes.openPanels";

type HermesPanelId =
  | "skills"
  | "memory"
  | "models"
  | "jobs"
  | "file-tree"
  | "diff-view"
  | "image-gen"
  | "glb-viewer"
  | "web-browser";

function loadPersistedPanelIds(): HermesPanelId[] {
  if (typeof window === "undefined") return ["skills"];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(HERMES_OPEN_PANELS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return ["skills"];
    const known = new Set<HermesPanelId>([
      "skills",
      "memory",
      "models",
      "jobs",
      "file-tree",
      "diff-view",
      "image-gen",
      "glb-viewer",
      "web-browser",
    ]);
    const filtered = parsed.filter((id): id is HermesPanelId => known.has(id));
    return filtered.length > 0 ? filtered : ["skills"];
  } catch {
    return ["skills"];
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
    setSessionModel,
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
  const [installedSkills, setInstalledSkills] = useState<readonly HermesSkillSummary[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<readonly HermesModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [memoryDocuments, setMemoryDocuments] = useState<readonly HermesMemoryDocument[]>([]);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<"memory" | "user", string>>({
    memory: "",
    user: "",
  });
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState<"memory" | "user" | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<readonly HermesJobSummary[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<readonly string[]>([]);
  const [workspaceFilesLoading, setWorkspaceFilesLoading] = useState(false);
  const [workspaceFilesError, setWorkspaceFilesError] = useState<string | null>(null);
  const [openPanelIds, setOpenPanelIds] = useState<readonly HermesPanelId[]>(loadPersistedPanelIds);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const failedTextRef = useRef("");
  const defaultModel = modelOptions.find((model) => model.isDefault)?.id ?? modelOptions[0]?.id;
  const selectedModel = activeSession.selectedModel ?? defaultModel ?? null;
  const togglePanel = useCallback((panelId: HermesPanelId) => {
    setOpenPanelIds((current) =>
      current.includes(panelId) ? current.filter((id) => id !== panelId) : [...current, panelId],
    );
  }, []);

  const refreshSkills = useCallback(async () => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const response = await fetch(resolveApiUrl("/api/skills"));
      if (!response.ok) throw new Error(await readJsonError(response));
      setInstalledSkills(normalizeHermesSkills(await response.json()));
    } catch (error) {
      setInstalledSkills([]);
      setSkillsError(sanitizeErrorMessage(error instanceof Error ? error.message : String(error)));
    } finally {
      setSkillsLoading(false);
    }
  }, []);

  const refreshMemory = useCallback(async () => {
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const response = await fetch(resolveApiUrl("/api/memory"));
      if (!response.ok) throw new Error(await readJsonError(response));
      const documents = normalizeHermesMemory(await response.json());
      setMemoryDocuments(documents);
      setMemoryDrafts({
        memory: documents.find((document) => document.file === "memory")?.content ?? "",
        user: documents.find((document) => document.file === "user")?.content ?? "",
      });
    } catch (error) {
      setMemoryError(sanitizeErrorMessage(error instanceof Error ? error.message : String(error)));
    } finally {
      setMemoryLoading(false);
    }
  }, []);

  const saveMemory = useCallback(
    async (file: "memory" | "user") => {
      setMemorySaving(file);
      setMemoryError(null);
      try {
        const response = await fetch(resolveApiUrl(`/api/memory/${file}`), {
          method: "PUT",
          headers: { "content-type": "text/markdown; charset=utf-8" },
          body: memoryDrafts[file],
        });
        if (!response.ok) throw new Error(await readJsonError(response));
        await refreshMemory();
      } catch (error) {
        setMemoryError(
          sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
        );
      } finally {
        setMemorySaving(null);
      }
    },
    [memoryDrafts, refreshMemory],
  );

  const refreshJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const response = await fetch(resolveApiUrl("/api/jobs"));
      if (!response.ok) throw new Error(await readJsonError(response));
      const nextJobs = normalizeHermesJobs(await response.json());
      setJobs(nextJobs);
      setSelectedJobId((current) => current ?? nextJobs[0]?.id ?? null);
    } catch (error) {
      setJobs([]);
      setJobsError(sanitizeErrorMessage(error instanceof Error ? error.message : String(error)));
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const triggerJob = useCallback(
    async (job: HermesJobSummary) => {
      setJobsError(null);
      setJobs((current) =>
        current.map((item) => (item.id === job.id ? { ...item, status: "running" } : item)),
      );
      try {
        const response = await fetch(resolveApiUrl(`/api/jobs/${encodeURIComponent(job.id)}/run`), {
          method: "POST",
        });
        if (!response.ok) throw new Error(await readJsonError(response));
        await refreshJobs();
      } catch (error) {
        setJobsError(sanitizeErrorMessage(error instanceof Error ? error.message : String(error)));
        setJobs((current) => current.map((item) => (item.id === job.id ? job : item)));
      }
    },
    [refreshJobs],
  );

  const refreshWorkspaceFiles = useCallback(async () => {
    setWorkspaceFilesLoading(true);
    setWorkspaceFilesError(null);
    try {
      const response = await fetch(resolveApiUrl("/api/workspace/files"));
      if (!response.ok) throw new Error(await readJsonError(response));
      setWorkspaceFiles(normalizeWorkspaceFileResults(await response.json()));
    } catch (error) {
      setWorkspaceFiles([]);
      setWorkspaceFilesError(
        sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
      );
    } finally {
      setWorkspaceFilesLoading(false);
    }
  }, []);

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
    void refreshSkills();
  }, [refreshSkills]);

  useEffect(() => {
    void refreshMemory();
    void refreshJobs();
    void refreshWorkspaceFiles();
  }, [refreshJobs, refreshMemory, refreshWorkspaceFiles]);

  useEffect(() => {
    window.localStorage.setItem(HERMES_OPEN_PANELS_KEY, JSON.stringify(openPanelIds));
  }, [openPanelIds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshJobs();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refreshJobs]);

  useEffect(() => {
    if (modelOptions.length > 0) return;
    let disposed = false;
    setModelsLoading(true);
    setModelError(null);
    void fetch(resolveApiUrl("/api/hermes/v1/models"))
      .then(async (response) => {
        if (!response.ok) throw new Error(await readJsonError(response));
        return response.json();
      })
      .then((body) => {
        if (!disposed) setModelOptions(normalizeHermesModels(body));
      })
      .catch((error) => {
        if (!disposed) {
          setModelError(
            sanitizeErrorMessage(error instanceof Error ? error.message : String(error)),
          );
        }
      })
      .finally(() => {
        if (!disposed) setModelsLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [modelOptions.length]);

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
          const message = JSON.parse(String(event.data)) as { type?: unknown; event?: unknown };
          applyWsMessage(message);
          if (
            message.type === "job.status" ||
            (typeof message.event === "string" && message.event.startsWith("job."))
          ) {
            void refreshJobs();
          }
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
  }, [applyWsMessage, refreshJobs, setWebsocketStatus]);

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

  const sendText = useCallback(
    async (text: string) => {
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
            ...(selectedModel ? { model: selectedModel } : {}),
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
    },
    [
      activeSession.conversationId,
      activeSession.responseId,
      restoreDraftAfterError,
      selectedModel,
      setRequestInFlight,
      stopActiveResponse,
      submitUserMessage,
    ],
  );

  const sendMessage = useCallback(async () => {
    const text = activeSession.draft.trim();
    if (!text || sendDisabled) return;
    await sendText(text);
  }, [activeSession.draft, sendDisabled, sendText]);

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
  const executeSlashCommand = useCallback(
    (command: HermesSlashCommand) => {
      if (command.id === "model") {
        setModelPickerOpen(true);
        setDraft(activeSession.id, "");
        return;
      }
      if (command.id === "new") {
        createSession();
        return;
      }
      if (command.id === "clear") {
        setDraft(activeSession.id, "");
        return;
      }
      if (command.kind === "skill" && command.skill) {
        if (gatewayStatus === "unreachable" || requestInFlight || activeSession.isRunning) return;
        void sendText(`/${command.skill.name}`);
      }
    },
    [
      activeSession.id,
      activeSession.isRunning,
      createSession,
      gatewayStatus,
      requestInFlight,
      sendText,
      setDraft,
    ],
  );
  const insertSkillReference = useCallback(
    (skill: HermesSkillSummary) => {
      const current = activeSession.draft;
      const next = current.replace(
        /(?:^|\s)\$[^\s$]*$/,
        (match) => `${match.startsWith(" ") ? " " : ""}$${skill.name} `,
      );
      setDraft(activeSession.id, next === current ? `${current}$${skill.name} ` : next);
    },
    [activeSession.draft, activeSession.id, setDraft],
  );
  const installHubSkill = useCallback(
    async (skill: HermesHubSkill) => {
      setSkillsError(null);
      try {
        const response = await fetch(resolveApiUrl("/api/skills/install"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identifier: skill.identifier, category: skill.category }),
        });
        if (!response.ok) throw new Error(await readJsonError(response));
        const body = (await response.json().catch(() => ({ success: true }))) as {
          success?: unknown;
          error?: unknown;
        };
        if (body.success === false) {
          throw new Error(typeof body.error === "string" ? body.error : "Skill install failed");
        }
        await refreshSkills();
      } catch (error) {
        setSkillsError(
          `Unable to install ${skill.name}: ${sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      }
    },
    [refreshSkills],
  );
  const uninstallSkill = useCallback(
    async (skill: HermesSkillSummary) => {
      setSkillsError(null);
      try {
        const response = await fetch(
          resolveApiUrl(`/api/skills/${encodeURIComponent(skill.name)}`),
          {
            method: "DELETE",
          },
        );
        if (!response.ok) throw new Error(await readJsonError(response));
        const body = (await response.json().catch(() => ({ success: true }))) as {
          success?: unknown;
          error?: unknown;
        };
        if (body.success === false) {
          throw new Error(typeof body.error === "string" ? body.error : "Skill uninstall failed");
        }
        await refreshSkills();
      } catch (error) {
        setSkillsError(
          `Unable to uninstall ${skill.name}: ${sanitizeErrorMessage(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      }
    },
    [refreshSkills],
  );

  return (
    <div className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
        <HermesHeader
          activeSession={activeSession}
          gatewayStatus={gatewayStatus}
          websocketStatus={websocketStatus}
          selectedModel={selectedModel}
          onNewSession={createSession}
          onOpenModelPicker={() => setModelPickerOpen(true)}
          onToggleSkillsPanel={() => togglePanel("skills")}
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
              installedSkills={installedSkills}
              onSlashCommand={executeSlashCommand}
              onSkillReference={insertSkillReference}
              onDraftChange={(draft) => setDraft(activeSession.id, draft)}
              onSend={sendMessage}
              onStop={stopResponse}
            />
          </main>
          <HermesPanelSidebar
            activeSession={activeSession}
            openPanelIds={openPanelIds}
            modelOptions={modelOptions}
            modelsLoading={modelsLoading}
            modelError={modelError}
            selectedModel={selectedModel}
            memoryDocuments={memoryDocuments}
            memoryDrafts={memoryDrafts}
            memoryLoading={memoryLoading}
            memorySaving={memorySaving}
            memoryError={memoryError}
            jobs={jobs}
            jobsLoading={jobsLoading}
            jobsError={jobsError}
            selectedJobId={selectedJobId}
            workspaceFiles={workspaceFiles}
            workspaceFilesLoading={workspaceFilesLoading}
            workspaceFilesError={workspaceFilesError}
            installedSkills={installedSkills}
            skillsLoading={skillsLoading}
            skillsError={skillsError}
            onTogglePanel={togglePanel}
            onClosePanel={togglePanel}
            onOpenModelPicker={() => setModelPickerOpen(true)}
            onSelectModel={(model) => setSessionModel(activeSession.id, model)}
            onRefreshMemory={refreshMemory}
            onMemoryDraftChange={(file, content) =>
              setMemoryDrafts((current) => ({ ...current, [file]: content }))
            }
            onSaveMemory={saveMemory}
            onRefreshJobs={refreshJobs}
            onSelectJob={setSelectedJobId}
            onTriggerJob={triggerJob}
            onRefreshWorkspaceFiles={refreshWorkspaceFiles}
            onRefreshSkills={refreshSkills}
            onInstallSkill={installHubSkill}
            onUninstallSkill={uninstallSkill}
          />
        </div>
      </div>
      <HermesModelPickerDialog
        open={modelPickerOpen}
        models={modelOptions}
        loading={modelsLoading}
        error={modelError}
        selectedModel={selectedModel}
        onClose={() => setModelPickerOpen(false)}
        onSelect={(model) => {
          setSessionModel(activeSession.id, model);
          setModelPickerOpen(false);
        }}
      />
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
  selectedModel: string | null;
  onNewSession: () => void;
  onOpenModelPicker: () => void;
  onToggleSkillsPanel: () => void;
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
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={props.onOpenModelPicker}>
            <SparklesIcon className="size-4" />
            {props.selectedModel ?? "Model"}
          </Button>
          <Button size="sm" variant="outline" onClick={props.onToggleSkillsPanel}>
            <WrenchIcon className="size-4" />
            Skills
          </Button>
          <Button size="sm" variant="outline" onClick={props.onNewSession}>
            <PlusIcon className="size-4" />
            New chat
          </Button>
        </div>
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

function HermesPanelIcon({ id }: { id: HermesPanelId }) {
  if (id === "skills") return <WrenchIcon className="size-4" />;
  if (id === "memory") return <BrainIcon className="size-4" />;
  if (id === "models") return <SparklesIcon className="size-4" />;
  if (id === "jobs") return <ListTodoIcon className="size-4" />;
  if (id === "file-tree") return <FolderTreeIcon className="size-4" />;
  if (id === "diff-view") return <GitCompareIcon className="size-4" />;
  if (id === "image-gen") return <ImageIcon className="size-4" />;
  if (id === "glb-viewer") return <BoxIcon className="size-4" />;
  return <GlobeIcon className="size-4" />;
}

const hermesPanelRegistry: readonly {
  readonly id: HermesPanelId;
  readonly name: string;
  readonly description: string;
  readonly placeholder?: boolean;
}[] = [
  { id: "skills", name: "Skills", description: "Installed skills and Skills Hub" },
  { id: "memory", name: "Memory", description: "MEMORY.md and USER.md editor" },
  { id: "models", name: "Models", description: "Hermes provider/model picker" },
  { id: "jobs", name: "Jobs", description: "Scheduled job monitor" },
  { id: "file-tree", name: "Files", description: "Workspace directory tree" },
  { id: "diff-view", name: "Diffs", description: "Changed files and color-coded diffs" },
  {
    id: "image-gen",
    name: "Images",
    description: "Future image generation results",
    placeholder: true,
  },
  { id: "glb-viewer", name: "GLB", description: "Future 3D/GLB viewer", placeholder: true },
  {
    id: "web-browser",
    name: "Browser",
    description: "Future embedded web browser",
    placeholder: true,
  },
];

function HermesPanelSidebar(props: {
  activeSession: HermesSession;
  openPanelIds: readonly HermesPanelId[];
  modelOptions: readonly HermesModelOption[];
  modelsLoading: boolean;
  modelError: string | null;
  selectedModel: string | null;
  memoryDocuments: readonly HermesMemoryDocument[];
  memoryDrafts: Record<"memory" | "user", string>;
  memoryLoading: boolean;
  memorySaving: "memory" | "user" | null;
  memoryError: string | null;
  jobs: readonly HermesJobSummary[];
  jobsLoading: boolean;
  jobsError: string | null;
  selectedJobId: string | null;
  workspaceFiles: readonly string[];
  workspaceFilesLoading: boolean;
  workspaceFilesError: string | null;
  installedSkills: readonly HermesSkillSummary[];
  skillsLoading: boolean;
  skillsError: string | null;
  onTogglePanel: (panelId: HermesPanelId) => void;
  onClosePanel: (panelId: HermesPanelId) => void;
  onOpenModelPicker: () => void;
  onSelectModel: (model: string | undefined) => void;
  onRefreshMemory: () => void;
  onMemoryDraftChange: (file: "memory" | "user", content: string) => void;
  onSaveMemory: (file: "memory" | "user") => void;
  onRefreshJobs: () => void;
  onSelectJob: (jobId: string) => void;
  onTriggerJob: (job: HermesJobSummary) => void;
  onRefreshWorkspaceFiles: () => void;
  onRefreshSkills: () => void;
  onInstallSkill: (skill: HermesHubSkill) => void;
  onUninstallSkill: (skill: HermesSkillSummary) => void;
}) {
  return (
    <aside className="hidden w-[25rem] shrink-0 border-l border-border/60 bg-card/20 xl:flex">
      <nav className="flex w-14 flex-col items-center gap-1 border-r border-border/55 py-3">
        {hermesPanelRegistry.map((panel) => {
          const open = props.openPanelIds.includes(panel.id);
          return (
            <button
              key={panel.id}
              type="button"
              className={cn(
                "group relative rounded-xl p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
                open ? "bg-secondary text-foreground" : "",
              )}
              title={`${open ? "Close" : "Open"} ${panel.name}: ${panel.description}`}
              aria-label={`${open ? "Close" : "Open"} ${panel.name} panel`}
              onClick={() => props.onTogglePanel(panel.id)}
            >
              <HermesPanelIcon id={panel.id} />
              {panel.placeholder ? (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-primary px-1 text-[8px] text-primary-foreground">
                  soon
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {props.openPanelIds.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            Open a panel tab to view memory, models, jobs, files, diffs, or future creative slots.
          </div>
        ) : null}
        {props.openPanelIds.map((panelId) => (
          <section key={panelId} className="border-b border-border/45">
            <div className="flex items-center justify-between gap-2 border-b border-border/35 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <HermesPanelIcon id={panelId} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {hermesPanelRegistry.find((panel) => panel.id === panelId)?.name}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground/60">
                    {hermesPanelRegistry.find((panel) => panel.id === panelId)?.description}
                  </p>
                </div>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Close ${panelId} panel`}
                onClick={() => props.onClosePanel(panelId)}
              >
                <XIcon className="size-3.5" />
              </Button>
            </div>
            {panelId === "skills" ? (
              <HermesSkillsPanel
                embedded
                installedSkills={props.installedSkills}
                loading={props.skillsLoading}
                error={props.skillsError}
                onRefresh={props.onRefreshSkills}
                onInstall={async (skill) => props.onInstallSkill(skill)}
                onUninstall={async (skill) => props.onUninstallSkill(skill)}
              />
            ) : null}
            {panelId === "memory" ? (
              <HermesMemoryPanel
                documents={props.memoryDocuments}
                drafts={props.memoryDrafts}
                loading={props.memoryLoading}
                saving={props.memorySaving}
                error={props.memoryError}
                onRefresh={props.onRefreshMemory}
                onDraftChange={props.onMemoryDraftChange}
                onSave={props.onSaveMemory}
              />
            ) : null}
            {panelId === "models" ? (
              <HermesModelsPanel
                models={props.modelOptions}
                loading={props.modelsLoading}
                error={props.modelError}
                selectedModel={props.selectedModel}
                onOpenDialog={props.onOpenModelPicker}
                onSelect={props.onSelectModel}
              />
            ) : null}
            {panelId === "jobs" ? (
              <HermesJobsPanel
                jobs={props.jobs}
                loading={props.jobsLoading}
                error={props.jobsError}
                selectedJobId={props.selectedJobId}
                onRefresh={props.onRefreshJobs}
                onSelect={props.onSelectJob}
                onTrigger={props.onTriggerJob}
              />
            ) : null}
            {panelId === "file-tree" ? (
              <HermesFileTreePanel
                files={props.workspaceFiles}
                loading={props.workspaceFilesLoading}
                error={props.workspaceFilesError}
                onRefresh={props.onRefreshWorkspaceFiles}
              />
            ) : null}
            {panelId === "diff-view" ? <HermesDiffPanel session={props.activeSession} /> : null}
            {panelId === "image-gen" || panelId === "glb-viewer" || panelId === "web-browser" ? (
              <HermesPlaceholderPanel
                panel={hermesPanelRegistry.find((panel) => panel.id === panelId)!}
              />
            ) : null}
          </section>
        ))}
      </div>
    </aside>
  );
}

function HermesMemoryPanel(props: {
  documents: readonly HermesMemoryDocument[];
  drafts: Record<"memory" | "user", string>;
  loading: boolean;
  saving: "memory" | "user" | null;
  error: string | null;
  onRefresh: () => void;
  onDraftChange: (file: "memory" | "user", content: string) => void;
  onSave: (file: "memory" | "user") => void;
}) {
  const documents =
    props.documents.length > 0
      ? props.documents
      : normalizeHermesMemory({ memory: props.drafts.memory, user: props.drafts.user });
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground/70">
          Edits are written to Hermes memory and persist across sessions.
        </p>
        <Button size="xs" variant="outline" onClick={props.onRefresh}>
          <RefreshCwIcon className="size-3" />
          Refresh
        </Button>
      </div>
      {props.error ? (
        <p className="rounded-lg border border-red-500/35 bg-red-500/10 p-2 text-xs text-red-100">
          {props.error}
        </p>
      ) : null}
      {props.loading ? <p className="text-sm text-muted-foreground">Loading memory…</p> : null}
      {documents.map((document) => (
        <div key={document.file} className="rounded-xl border border-border/50 bg-background/35">
          <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
            <div>
              <p className="text-sm font-medium">{document.title}</p>
              <p className="font-mono text-[10px] text-muted-foreground/60">{document.filename}</p>
            </div>
            <Button
              size="xs"
              disabled={props.saving === document.file}
              onClick={() => props.onSave(document.file)}
            >
              {props.saving === document.file ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <CheckIcon className="size-3" />
              )}
              Save
            </Button>
          </div>
          <textarea
            className="min-h-40 w-full resize-y bg-transparent p-3 font-mono text-xs outline-none placeholder:text-muted-foreground/45"
            placeholder={`No ${document.filename} content yet.`}
            value={props.drafts[document.file]}
            onChange={(event) => props.onDraftChange(document.file, event.target.value)}
          />
          {props.drafts[document.file].trim() ? (
            <div className="border-t border-border/35 p-3">
              <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
                Readable preview
              </p>
              <ChatMarkdown text={props.drafts[document.file]} cwd={undefined} />
            </div>
          ) : (
            <p className="border-t border-border/35 p-3 text-xs text-muted-foreground">
              Empty memory section. Add preferences or persistent context for future agent turns.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function HermesModelsPanel(props: {
  models: readonly HermesModelOption[];
  loading: boolean;
  error: string | null;
  selectedModel: string | null;
  onOpenDialog: () => void;
  onSelect: (model: string | undefined) => void;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, HermesModelOption[]>();
    for (const model of props.models) {
      groups.set(model.provider, [...(groups.get(model.provider) ?? []), model]);
    }
    return Array.from(groups.entries());
  }, [props.models]);
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground/70">
          Current session model:{" "}
          <span className="font-mono">{props.selectedModel ?? "Hermes default"}</span>
        </p>
        <Button size="xs" variant="outline" onClick={props.onOpenDialog}>
          Dialog
        </Button>
      </div>
      {props.loading ? <p className="text-sm text-muted-foreground">Loading models…</p> : null}
      {props.error ? (
        <p className="rounded-lg border border-red-500/35 bg-red-500/10 p-2 text-xs text-red-100">
          {props.error}
        </p>
      ) : null}
      {grouped.length === 0 && !props.loading ? (
        <p className="text-sm text-muted-foreground">No Hermes models returned.</p>
      ) : null}
      {grouped.map(([provider, models]) => (
        <div key={provider} className="rounded-xl border border-border/50 bg-background/35 p-2">
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/60">
            {provider}
          </p>
          <div className="space-y-1">
            {models.map((model) => (
              <button
                key={model.id}
                type="button"
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs",
                  props.selectedModel === model.id
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-secondary",
                )}
                onClick={() => props.onSelect(model.id)}
              >
                <span>
                  <span className="font-medium">{model.name}</span>
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground/60">
                    {model.id}
                  </span>
                  {model.isDefault ? (
                    <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px]">
                      default
                    </span>
                  ) : null}
                </span>
                {props.selectedModel === model.id ? <CheckIcon className="size-3.5" /> : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HermesJobsPanel(props: {
  jobs: readonly HermesJobSummary[];
  loading: boolean;
  error: string | null;
  selectedJobId: string | null;
  onRefresh: () => void;
  onSelect: (jobId: string) => void;
  onTrigger: (job: HermesJobSummary) => void;
}) {
  const selectedJob = props.jobs.find((job) => job.id === props.selectedJobId) ?? props.jobs[0];
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground/70">Status refreshes automatically.</p>
        <Button size="xs" variant="outline" onClick={props.onRefresh}>
          <RefreshCwIcon className="size-3" />
          Refresh
        </Button>
      </div>
      {props.error ? (
        <p className="rounded-lg border border-red-500/35 bg-red-500/10 p-2 text-xs text-red-100">
          {props.error}
        </p>
      ) : null}
      {props.loading ? <p className="text-sm text-muted-foreground">Loading jobs…</p> : null}
      {props.jobs.length === 0 && !props.loading ? (
        <p className="rounded-lg border border-dashed border-border/45 p-3 text-sm text-muted-foreground">
          No scheduled Hermes jobs returned.
        </p>
      ) : null}
      <div className="space-y-1">
        {props.jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            className={cn(
              "w-full rounded-lg border p-2 text-left text-xs",
              selectedJob?.id === job.id ? "border-primary bg-primary/10" : "border-border/50",
            )}
            onClick={() => props.onSelect(job.id)}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="font-medium">{job.name}</span>
              <HermesJobStatusPill status={job.status} />
            </span>
            <span className="mt-1 block text-muted-foreground/70">{job.schedule}</span>
          </button>
        ))}
      </div>
      {selectedJob ? (
        <div className="rounded-xl border border-border/50 bg-background/35 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{selectedJob.name}</p>
              <p className="font-mono text-[10px] text-muted-foreground/60">{selectedJob.id}</p>
            </div>
            <Button size="xs" onClick={() => props.onTrigger(selectedJob)}>
              <RefreshCwIcon className="size-3" />
              Run now
            </Button>
          </div>
          <dl className="space-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground/60">Full configuration</dt>
              <dd className="mt-1 whitespace-pre-wrap rounded bg-background/60 p-2 font-mono">
                {selectedJob.config || "No configuration returned."}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground/60">Last execution output</dt>
              <dd className="mt-1 whitespace-pre-wrap rounded bg-green-500/5 p-2 font-mono text-green-100">
                {selectedJob.output || "No output yet."}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground/60">Error logs</dt>
              <dd className="mt-1 whitespace-pre-wrap rounded bg-red-500/5 p-2 font-mono text-red-100">
                {selectedJob.error || "No errors reported."}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function HermesJobStatusPill({ status }: { status: HermesJobStatus }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] capitalize",
        status === "running"
          ? "bg-blue-500/15 text-blue-100"
          : status === "failed"
            ? "bg-red-500/15 text-red-100"
            : status === "completed"
              ? "bg-green-500/15 text-green-100"
              : "bg-secondary text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function HermesFileTreePanel(props: {
  files: readonly string[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const tree = useMemo(() => buildFileTree(props.files), [props.files]);
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground/70">Workspace directory structure</p>
        <Button size="xs" variant="outline" onClick={props.onRefresh}>
          Refresh
        </Button>
      </div>
      {props.loading ? <p className="text-sm text-muted-foreground">Loading files…</p> : null}
      {props.error ? (
        <p className="rounded-lg border border-red-500/35 bg-red-500/10 p-2 text-xs text-red-100">
          {props.error}
        </p>
      ) : null}
      <div className="rounded-xl border border-border/50 bg-background/35 p-2 font-mono text-xs">
        {tree.length > 0 ? (
          tree.map((node) => <HermesFileTreeNode key={node.path} node={node} level={0} />)
        ) : (
          <p className="p-2 text-muted-foreground">No workspace files returned.</p>
        )}
      </div>
    </div>
  );
}

interface FileTreeNode {
  readonly name: string;
  readonly path: string;
  readonly children: FileTreeNode[];
}

function buildFileTree(paths: readonly string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const path of paths.slice(0, 200)) {
    let current = root;
    const parts = path.split("/").filter(Boolean);
    let accumulated = "";
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      let node = current.find((entry) => entry.name === part);
      if (!node) {
        node = { name: part, path: accumulated, children: [] };
        current.push(node);
      }
      current = node.children;
    }
  }
  return root.sort((left, right) => left.name.localeCompare(right.name));
}

function HermesFileTreeNode({ node, level }: { node: FileTreeNode; level: number }) {
  const isDirectory = node.children.length > 0;
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-secondary"
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        title={isDirectory ? node.path : `Open ${node.path}`}
      >
        {isDirectory ? <ChevronRightIcon className="size-3" /> : <FileIcon className="size-3" />}
        <span className={isDirectory ? "text-foreground" : "text-muted-foreground"}>
          {node.name}
        </span>
      </button>
      {node.children.map((child) => (
        <HermesFileTreeNode key={child.path} node={child} level={level + 1} />
      ))}
    </div>
  );
}

function HermesDiffPanel({ session }: { session: HermesSession }) {
  const files = Array.from(new Set(session.toolCalls.flatMap((tool) => tool.filePaths)));
  return (
    <div className="space-y-3 p-3">
      <p className="text-xs text-muted-foreground/70">
        Changed-file references from agent tool calls with diff-style color coding.
      </p>
      {files.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/45 p-3 text-sm text-muted-foreground">
          No changed files detected for this session yet.
        </p>
      ) : (
        files.map((file) => (
          <div
            key={file}
            className="overflow-hidden rounded-xl border border-border/50 bg-background/35"
          >
            <div className="border-b border-border/40 px-3 py-2 font-mono text-xs">{file}</div>
            <div className="font-mono text-xs">
              <div className="bg-green-500/10 px-3 py-1 text-green-100">
                + Agent reported changes may appear here.
              </div>
              <div className="bg-red-500/10 px-3 py-1 text-red-100">
                - Removed lines are highlighted in red.
              </div>
              <div className="px-3 py-1 text-muted-foreground">
                {"  "}Open tool details for full output and paths.
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function HermesPlaceholderPanel(props: { panel: (typeof hermesPanelRegistry)[number] }) {
  return (
    <div className="p-3">
      <div className="rounded-xl border border-dashed border-border/55 bg-background/30 p-4 text-sm">
        <p className="font-medium">{props.panel.name} placeholder</p>
        <p className="mt-1 text-xs text-muted-foreground/75">
          {props.panel.description}. This slot is registered through the extensible panel registry
          and can be replaced with a real panel without changing the core layout.
        </p>
      </div>
    </div>
  );
}

function HermesSkillsPanel(props: {
  installedSkills: readonly HermesSkillSummary[];
  loading: boolean;
  error: string | null;
  embedded?: boolean;
  onRefresh: () => void;
  onInstall: (skill: HermesHubSkill) => Promise<void>;
  onUninstall: (skill: HermesSkillSummary) => Promise<void>;
}) {
  const installedNames = new Set(props.installedSkills.map((skill) => skill.name));
  return (
    <aside
      className={cn(
        "overflow-y-auto p-3",
        props.embedded ? "" : "hidden w-80 shrink-0 border-l border-border/60 bg-card/20 xl:block",
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground/65">
            Hermes skills
          </p>
          <p className="text-[11px] text-muted-foreground/55">Installed skills and Skills Hub</p>
        </div>
        <Button size="icon-xs" variant="ghost" onClick={props.onRefresh} title="Refresh skills">
          <RefreshCwIcon className={cn("size-3.5", props.loading ? "animate-spin" : null)} />
        </Button>
      </div>
      {props.error ? (
        <div className="mb-3 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-100">
          <p className="font-medium">Skill operation failed</p>
          <p className="mt-1 text-red-100/75">{props.error}</p>
        </div>
      ) : null}
      <section>
        <h2 className="mb-2 text-sm font-medium">Installed</h2>
        {props.loading ? (
          <div className="rounded-lg border border-border/50 px-3 py-4 text-center text-xs text-muted-foreground">
            Loading installed skills…
          </div>
        ) : props.installedSkills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border/50 px-3 py-4 text-center text-xs text-muted-foreground">
            No skills installed. Browse the Skills Hub below; slash commands still include
            built-ins.
          </div>
        ) : (
          <div className="space-y-2">
            {props.installedSkills.map((skill) => (
              <div
                key={skill.name}
                className="rounded-lg border border-border/45 bg-background/40 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{skill.name}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
                      {skill.category}
                    </p>
                  </div>
                  <Button size="xs" variant="outline" onClick={() => void props.onUninstall(skill)}>
                    Uninstall
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground/75">{skill.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="mt-5">
        <h2 className="mb-2 text-sm font-medium">Skills Hub</h2>
        <div className="space-y-2">
          {hermesSkillsHubCatalog.map((skill) => {
            const installed = installedNames.has(skill.name);
            return (
              <div
                key={skill.identifier}
                className="rounded-lg border border-border/45 bg-background/40 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{skill.name}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/55">
                      {skill.category} • {skill.trustTier}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant={installed ? "secondary" : "outline"}
                    disabled={installed}
                    onClick={() => void props.onInstall(skill)}
                  >
                    <DownloadIcon className="size-3" />
                    {installed ? "Installed" : "Install"}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground/75">{skill.description}</p>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function HermesModelPickerDialog(props: {
  open: boolean;
  models: readonly HermesModelOption[];
  loading: boolean;
  error: string | null;
  selectedModel: string | null;
  onClose: () => void;
  onSelect: (model: string) => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(open) => (!open ? props.onClose() : null)}>
      <DialogPopup>
        <DialogPanel>
          <DialogHeader>
            <DialogTitle>Select Hermes model</DialogTitle>
            <DialogDescription>
              Choose the model for subsequent messages in this session.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-y-auto py-2">
            {props.loading ? (
              <p className="text-sm text-muted-foreground">Loading models…</p>
            ) : props.error ? (
              <p className="rounded-lg border border-red-500/35 bg-red-500/10 p-3 text-sm text-red-100">
                {props.error}
              </p>
            ) : props.models.length === 0 ? (
              <p className="text-sm text-muted-foreground">No models returned by Hermes.</p>
            ) : (
              props.models.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm",
                    props.selectedModel === model.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-secondary",
                  )}
                  onClick={() => props.onSelect(model.id)}
                >
                  <span>
                    <span>{model.provider}</span>
                    <span className="mx-1 text-muted-foreground/55">/</span>
                    <span>{model.name}</span>
                    {model.isDefault ? (
                      <span className="ml-2 rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        default
                      </span>
                    ) : null}
                  </span>
                  {props.selectedModel === model.id ? <CheckIcon className="size-4" /> : null}
                </button>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={props.onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function HermesSlashCommandMenu(props: {
  commands: readonly HermesSlashCommand[];
  selectedIndex: number;
  onSelect: (command: HermesSlashCommand) => void;
}) {
  return (
    <div className="mx-auto mt-2 max-w-3xl rounded-xl border border-border bg-popover p-2 shadow-lg">
      <div className="mb-1 px-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
        Slash commands
      </div>
      <div className="max-h-64 overflow-auto">
        {props.commands.length > 0 ? (
          props.commands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs",
                index === props.selectedIndex
                  ? "bg-secondary text-foreground"
                  : "hover:bg-secondary",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onSelect(command)}
            >
              <SparklesIcon className="mt-0.5 size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block font-mono font-medium">{command.name}</span>
                <span className="mt-0.5 block text-muted-foreground/75">{command.description}</span>
              </span>
              <span className="rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {command.kind === "skill" ? command.skill?.category : "built-in"}
              </span>
            </button>
          ))
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">No slash commands match.</p>
        )}
      </div>
    </div>
  );
}

function HermesSkillSearchMenu(props: {
  skills: readonly HermesSkillSummary[];
  selectedIndex: number;
  onSelect: (skill: HermesSkillSummary) => void;
}) {
  return (
    <div className="mx-auto mt-2 max-w-3xl rounded-xl border border-border bg-popover p-2 shadow-lg">
      <div className="mb-1 flex items-center gap-1 px-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground/55">
        <SearchIcon className="size-3" />
        Skill search
      </div>
      <div className="max-h-64 overflow-auto">
        {props.skills.length > 0 ? (
          props.skills.map((skill, index) => (
            <button
              key={skill.name}
              type="button"
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs",
                index === props.selectedIndex
                  ? "bg-secondary text-foreground"
                  : "hover:bg-secondary",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => props.onSelect(skill)}
            >
              <WrenchIcon className="mt-0.5 size-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">${skill.name}</span>
                <span className="mt-0.5 block text-muted-foreground/75">{skill.description}</span>
              </span>
              <span className="rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {skill.category}
              </span>
            </button>
          ))
        ) : (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            No installed Hermes skills match. Install one from the Skills Hub.
          </p>
        )}
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
  installedSkills: readonly HermesSkillSummary[];
  onSlashCommand: (command: HermesSlashCommand) => void;
  onSkillReference: (skill: HermesSkillSummary) => void;
  onDraftChange: (draft: string) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionFiles, setMentionFiles] = useState<string[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [skillQuery, setSkillQuery] = useState<string | null>(null);
  const [skillIndex, setSkillIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const slashCommands = useMemo(
    () =>
      filterHermesSlashCommands(buildHermesSlashCommands(props.installedSkills), slashQuery ?? ""),
    [props.installedSkills, slashQuery],
  );
  const skillResults = useMemo(
    () => filterHermesSkills(props.installedSkills, skillQuery ?? ""),
    [props.installedSkills, skillQuery],
  );

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

  const updateCommandQueries = useCallback((value: string, cursor: number) => {
    const prefix = value.slice(0, cursor);
    const slashMatch = prefix.match(/(?:^|\s)\/([^\s/]*)$/);
    const skillMatch = prefix.match(/(?:^|\s)\$([^\s$]*)$/);
    setSlashQuery(slashMatch ? (slashMatch[1] ?? "") : null);
    setSkillQuery(skillMatch ? (skillMatch[1] ?? "") : null);
    setSlashIndex(0);
    setSkillIndex(0);
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

  const closeCommandMenus = useCallback(() => {
    setSlashQuery(null);
    setSkillQuery(null);
  }, []);

  const chooseSlashCommand = useCallback(
    (command: HermesSlashCommand) => {
      closeCommandMenus();
      props.onSlashCommand(command);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [closeCommandMenus, props],
  );

  const chooseSkill = useCallback(
    (skill: HermesSkillSummary) => {
      closeCommandMenus();
      props.onSkillReference(skill);
      window.requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [closeCommandMenus, props],
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
            updateCommandQueries(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={(event) => {
            if (slashQuery !== null) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSlashIndex((value) =>
                  Math.min(value + 1, Math.max(0, slashCommands.length - 1)),
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSlashIndex((value) => Math.max(0, value - 1));
                return;
              }
              if ((event.key === "Enter" || event.key === "Tab") && slashCommands[slashIndex]) {
                event.preventDefault();
                chooseSlashCommand(slashCommands[slashIndex]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setSlashQuery(null);
                return;
              }
            }
            if (skillQuery !== null) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSkillIndex((value) => Math.min(value + 1, Math.max(0, skillResults.length - 1)));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setSkillIndex((value) => Math.max(0, value - 1));
                return;
              }
              if ((event.key === "Enter" || event.key === "Tab") && skillResults[skillIndex]) {
                event.preventDefault();
                chooseSkill(skillResults[skillIndex]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setSkillQuery(null);
                return;
              }
            }
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
      {slashQuery !== null ? (
        <HermesSlashCommandMenu
          commands={slashCommands}
          selectedIndex={slashIndex}
          onSelect={chooseSlashCommand}
        />
      ) : null}
      {skillQuery !== null ? (
        <HermesSkillSearchMenu
          skills={skillResults}
          selectedIndex={skillIndex}
          onSelect={chooseSkill}
        />
      ) : null}
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
