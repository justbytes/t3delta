import { Debouncer } from "@tanstack/react-pacer";
import { create } from "zustand";

const PERSISTED_STATE_KEY = "t3delta:ui-state:v1";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3delta:renderer-state:v8",
  "t3delta:renderer-state:v7",
  "t3delta:renderer-state:v6",
  "t3delta:renderer-state:v5",
  "t3delta:renderer-state:v4",
  "t3delta:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

interface PersistedUiState {
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  threadChangedFilesExpandedById?: Record<string, Record<string, boolean>>;
  threadWorkspaceById?: Record<string, PersistedThreadWorkspaceState>;
}

export type ThreadWorkspaceMode = "agent" | "editor";

interface PersistedThreadWorkspaceState {
  mode?: ThreadWorkspaceMode;
  openFilePaths?: string[];
  activeFilePath?: string | null;
}

export interface UiProjectState {
  projectExpandedById: Record<string, boolean>;
  projectOrder: string[];
}

export interface ThreadWorkspaceState {
  mode: ThreadWorkspaceMode;
  openFilePaths: string[];
  activeFilePath: string | null;
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
  threadChangedFilesExpandedById: Record<string, Record<string, boolean>>;
  threadWorkspaceById: Record<string, ThreadWorkspaceState>;
}

export interface UiState extends UiProjectState, UiThreadState {}

export interface SyncProjectInput {
  key: string;
  cwd: string;
}

export interface SyncThreadInput {
  key: string;
  seedVisitedAt?: string | undefined;
}

const initialState: UiState = {
  projectExpandedById: {},
  projectOrder: [],
  threadLastVisitedAtById: {},
  threadChangedFilesExpandedById: {},
  threadWorkspaceById: {},
};

const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];
const currentProjectCwdById = new Map<string, string>();
let legacyKeysCleanedUp = false;

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        hydratePersistedProjectState(JSON.parse(legacyRaw) as PersistedUiState);
        return initialState;
      }
      return initialState;
    }
    const parsed = JSON.parse(raw) as PersistedUiState;
    hydratePersistedProjectState(parsed);
    return {
      ...initialState,
      threadChangedFilesExpandedById: sanitizePersistedThreadChangedFilesExpanded(
        parsed.threadChangedFilesExpandedById,
      ),
      threadWorkspaceById: sanitizePersistedThreadWorkspaceById(parsed.threadWorkspaceById),
    };
  } catch {
    return initialState;
  }
}

function sanitizePersistedThreadChangedFilesExpanded(
  value: PersistedUiState["threadChangedFilesExpandedById"],
): Record<string, Record<string, boolean>> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const nextState: Record<string, Record<string, boolean>> = {};
  for (const [threadId, turns] of Object.entries(value)) {
    if (!threadId || !turns || typeof turns !== "object") {
      continue;
    }

    const nextTurns: Record<string, boolean> = {};
    for (const [turnId, expanded] of Object.entries(turns)) {
      if (turnId && typeof expanded === "boolean" && expanded === false) {
        nextTurns[turnId] = false;
      }
    }

    if (Object.keys(nextTurns).length > 0) {
      nextState[threadId] = nextTurns;
    }
  }

  return nextState;
}

function sanitizePersistedThreadWorkspaceById(
  value: PersistedUiState["threadWorkspaceById"],
): Record<string, ThreadWorkspaceState> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const nextState: Record<string, ThreadWorkspaceState> = {};
  for (const [threadId, workspace] of Object.entries(value)) {
    if (!threadId || !workspace || typeof workspace !== "object") {
      continue;
    }

    const seenPaths = new Set<string>();
    const openFilePaths = Array.isArray(workspace.openFilePaths)
      ? workspace.openFilePaths.flatMap((path) => {
          if (typeof path !== "string" || path.length === 0 || seenPaths.has(path)) {
            return [];
          }
          seenPaths.add(path);
          return [path];
        })
      : [];

    const mode = workspace.mode === "editor" ? "editor" : "agent";
    if (openFilePaths.length === 0 && mode !== "editor") {
      continue;
    }

    const activeFilePath =
      typeof workspace.activeFilePath === "string" &&
      openFilePaths.includes(workspace.activeFilePath)
        ? workspace.activeFilePath
        : (openFilePaths[0] ?? null);

    nextState[threadId] = {
      mode,
      openFilePaths,
      activeFilePath,
    };
  }

  return nextState;
}

function hydratePersistedProjectState(parsed: PersistedUiState): void {
  persistedExpandedProjectCwds.clear();
  persistedProjectOrderCwds.length = 0;
  for (const cwd of parsed.expandedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedExpandedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.projectOrderCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
      persistedProjectOrderCwds.push(cwd);
    }
  }
}

function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const expandedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([projectId]) => {
        const cwd = currentProjectCwdById.get(projectId);
        return cwd ? [cwd] : [];
      });
    const projectOrderCwds = state.projectOrder.flatMap((projectId) => {
      const cwd = currentProjectCwdById.get(projectId);
      return cwd ? [cwd] : [];
    });
    const threadChangedFilesExpandedById = Object.fromEntries(
      Object.entries(state.threadChangedFilesExpandedById).flatMap(([threadId, turns]) => {
        const nextTurns = Object.fromEntries(
          Object.entries(turns).filter(([, expanded]) => expanded === false),
        );
        return Object.keys(nextTurns).length > 0 ? [[threadId, nextTurns]] : [];
      }),
    );
    const threadWorkspaceById = Object.fromEntries(
      Object.entries(state.threadWorkspaceById).flatMap(([threadId, workspace]) => {
        if (workspace.openFilePaths.length === 0 && workspace.mode !== "editor") {
          return [];
        }
        return [
          [
            threadId,
            {
              mode: workspace.mode,
              openFilePaths: workspace.openFilePaths,
              activeFilePath: workspace.activeFilePath,
            } satisfies PersistedThreadWorkspaceState,
          ],
        ];
      }),
    );
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds,
        projectOrderCwds,
        threadChangedFilesExpandedById,
        threadWorkspaceById,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function projectOrdersEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  );
}

function nestedBooleanRecordsEqual(
  left: Record<string, Record<string, boolean>>,
  right: Record<string, Record<string, boolean>>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (!(key in right) || !recordsEqual(value, right[key]!)) {
      return false;
    }
  }
  return true;
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function threadWorkspaceRecordsEqual(
  left: Record<string, ThreadWorkspaceState>,
  right: Record<string, ThreadWorkspaceState>,
): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  for (const [threadId, workspace] of leftEntries) {
    const other = right[threadId];
    if (
      !other ||
      workspace.mode !== other.mode ||
      workspace.activeFilePath !== other.activeFilePath ||
      !stringArraysEqual(workspace.openFilePaths, other.openFilePaths)
    ) {
      return false;
    }
  }

  return true;
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const previousProjectCwdById = new Map(currentProjectCwdById);
  const previousProjectIdByCwd = new Map(
    [...previousProjectCwdById.entries()].map(([projectId, cwd]) => [cwd, projectId] as const),
  );
  currentProjectCwdById.clear();
  for (const project of projects) {
    currentProjectCwdById.set(project.key, project.cwd);
  }
  const cwdMappingChanged =
    previousProjectCwdById.size !== currentProjectCwdById.size ||
    projects.some((project) => previousProjectCwdById.get(project.key) !== project.cwd);

  const nextExpandedById: Record<string, boolean> = {};
  const previousExpandedById = state.projectExpandedById;
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const mappedProjects = projects.map((project, index) => {
    const previousProjectIdForCwd = previousProjectIdByCwd.get(project.cwd);
    const expanded =
      previousExpandedById[project.key] ??
      (previousProjectIdForCwd ? previousExpandedById[previousProjectIdForCwd] : undefined) ??
      (persistedExpandedProjectCwds.size > 0
        ? persistedExpandedProjectCwds.has(project.cwd)
        : true);
    nextExpandedById[project.key] = expanded;
    return {
      id: project.key,
      cwd: project.cwd,
      incomingIndex: index,
    };
  });

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? (() => {
          const nextProjectIdByCwd = new Map(
            mappedProjects.map((project) => [project.cwd, project.id] as const),
          );
          const usedProjectIds = new Set<string>();
          const orderedProjectIds: string[] = [];

          for (const projectId of state.projectOrder) {
            const matchedProjectId =
              (projectId in nextExpandedById ? projectId : undefined) ??
              (() => {
                const previousCwd = previousProjectCwdById.get(projectId);
                return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined;
              })();
            if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
              continue;
            }
            usedProjectIds.add(matchedProjectId);
            orderedProjectIds.push(matchedProjectId);
          }

          for (const project of mappedProjects) {
            if (usedProjectIds.has(project.id)) {
              continue;
            }
            orderedProjectIds.push(project.id);
          }

          return orderedProjectIds;
        })()
      : mappedProjects
          .map((project) => ({
            id: project.id,
            incomingIndex: project.incomingIndex,
            orderIndex:
              persistedOrderByCwd.get(project.cwd) ??
              persistedProjectOrderCwds.length + project.incomingIndex,
          }))
          .toSorted((left, right) => {
            const byOrder = left.orderIndex - right.orderIndex;
            if (byOrder !== 0) {
              return byOrder;
            }
            return left.incomingIndex - right.incomingIndex;
          })
          .map((project) => project.id);

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    !cwdMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    projectOrder: nextProjectOrder,
  };
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map((thread) => thread.key));
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId),
    ),
  );
  for (const thread of threads) {
    if (
      nextThreadLastVisitedAtById[thread.key] === undefined &&
      thread.seedVisitedAt !== undefined &&
      thread.seedVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.key] = thread.seedVisitedAt;
    }
  }
  const nextThreadChangedFilesExpandedById = Object.fromEntries(
    Object.entries(state.threadChangedFilesExpandedById).filter(([threadId]) =>
      retainedThreadIds.has(threadId),
    ),
  );
  const nextThreadWorkspaceById = Object.fromEntries(
    Object.entries(state.threadWorkspaceById).filter(([threadId]) =>
      retainedThreadIds.has(threadId),
    ),
  );
  if (
    recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById) &&
    nestedBooleanRecordsEqual(
      state.threadChangedFilesExpandedById,
      nextThreadChangedFilesExpandedById,
    ) &&
    threadWorkspaceRecordsEqual(state.threadWorkspaceById, nextThreadWorkspaceById)
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    threadChangedFilesExpandedById: nextThreadChangedFilesExpandedById,
    threadWorkspaceById: nextThreadWorkspaceById,
  };
}

export function markThreadVisited(state: UiState, threadId: string, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: string,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function clearThreadUi(state: UiState, threadId: string): UiState {
  const hasVisitedState = threadId in state.threadLastVisitedAtById;
  const hasChangedFilesState = threadId in state.threadChangedFilesExpandedById;
  const hasWorkspaceState = threadId in state.threadWorkspaceById;
  if (!hasVisitedState && !hasChangedFilesState && !hasWorkspaceState) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  const nextThreadChangedFilesExpandedById = { ...state.threadChangedFilesExpandedById };
  const nextThreadWorkspaceById = { ...state.threadWorkspaceById };
  delete nextThreadLastVisitedAtById[threadId];
  delete nextThreadChangedFilesExpandedById[threadId];
  delete nextThreadWorkspaceById[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
    threadChangedFilesExpandedById: nextThreadChangedFilesExpandedById,
    threadWorkspaceById: nextThreadWorkspaceById,
  };
}

export function setThreadWorkspaceMode(
  state: UiState,
  threadId: string,
  mode: ThreadWorkspaceMode,
): UiState {
  const currentThreadWorkspace = state.threadWorkspaceById[threadId];
  if (!currentThreadWorkspace) {
    if (mode === "editor") {
      return {
        ...state,
        threadWorkspaceById: {
          ...state.threadWorkspaceById,
          [threadId]: {
            mode: "editor",
            openFilePaths: [],
            activeFilePath: null,
          },
        },
      };
    }
    return state;
  }
  if (currentThreadWorkspace.mode === mode) {
    return state;
  }
  return {
    ...state,
    threadWorkspaceById: {
      ...state.threadWorkspaceById,
      [threadId]: {
        ...currentThreadWorkspace,
        mode,
      },
    },
  };
}

export function openThreadWorkspaceFile(
  state: UiState,
  threadId: string,
  filePath: string,
): UiState {
  if (filePath.length === 0) {
    return state;
  }

  const currentThreadWorkspace = state.threadWorkspaceById[threadId];
  const openFilePaths = currentThreadWorkspace?.openFilePaths.includes(filePath)
    ? currentThreadWorkspace.openFilePaths
    : [...(currentThreadWorkspace?.openFilePaths ?? []), filePath];
  const nextThreadWorkspace: ThreadWorkspaceState = {
    mode: "editor",
    openFilePaths,
    activeFilePath: filePath,
  };

  if (
    currentThreadWorkspace &&
    currentThreadWorkspace.mode === nextThreadWorkspace.mode &&
    currentThreadWorkspace.activeFilePath === nextThreadWorkspace.activeFilePath &&
    stringArraysEqual(currentThreadWorkspace.openFilePaths, nextThreadWorkspace.openFilePaths)
  ) {
    return state;
  }

  return {
    ...state,
    threadWorkspaceById: {
      ...state.threadWorkspaceById,
      [threadId]: nextThreadWorkspace,
    },
  };
}

export function activateThreadWorkspaceFile(
  state: UiState,
  threadId: string,
  filePath: string,
): UiState {
  const currentThreadWorkspace = state.threadWorkspaceById[threadId];
  if (!currentThreadWorkspace || !currentThreadWorkspace.openFilePaths.includes(filePath)) {
    return state;
  }
  if (
    currentThreadWorkspace.mode === "editor" &&
    currentThreadWorkspace.activeFilePath === filePath
  ) {
    return state;
  }
  return {
    ...state,
    threadWorkspaceById: {
      ...state.threadWorkspaceById,
      [threadId]: {
        ...currentThreadWorkspace,
        mode: "editor",
        activeFilePath: filePath,
      },
    },
  };
}

export function closeThreadWorkspaceFile(
  state: UiState,
  threadId: string,
  filePath: string,
): UiState {
  const currentThreadWorkspace = state.threadWorkspaceById[threadId];
  if (!currentThreadWorkspace || !currentThreadWorkspace.openFilePaths.includes(filePath)) {
    return state;
  }

  const closedFileIndex = currentThreadWorkspace.openFilePaths.indexOf(filePath);
  const nextOpenFilePaths = currentThreadWorkspace.openFilePaths.filter(
    (path) => path !== filePath,
  );
  if (nextOpenFilePaths.length === 0) {
    return {
      ...state,
      threadWorkspaceById: {
        ...state.threadWorkspaceById,
        [threadId]: {
          ...currentThreadWorkspace,
          mode: "editor",
          openFilePaths: [],
          activeFilePath: null,
        },
      },
    };
  }

  const nextActiveFilePath =
    currentThreadWorkspace.activeFilePath === filePath
      ? nextOpenFilePaths[Math.min(closedFileIndex, nextOpenFilePaths.length - 1)]!
      : currentThreadWorkspace.activeFilePath;

  return {
    ...state,
    threadWorkspaceById: {
      ...state.threadWorkspaceById,
      [threadId]: {
        ...currentThreadWorkspace,
        openFilePaths: nextOpenFilePaths,
        activeFilePath: nextActiveFilePath,
      },
    },
  };
}

export function closeOtherThreadWorkspaceFiles(
  state: UiState,
  threadId: string,
  filePath: string,
): UiState {
  const currentThreadWorkspace = state.threadWorkspaceById[threadId];
  if (!currentThreadWorkspace || !currentThreadWorkspace.openFilePaths.includes(filePath)) {
    return state;
  }

  if (
    currentThreadWorkspace.mode === "editor" &&
    currentThreadWorkspace.activeFilePath === filePath &&
    currentThreadWorkspace.openFilePaths.length === 1
  ) {
    return state;
  }

  return {
    ...state,
    threadWorkspaceById: {
      ...state.threadWorkspaceById,
      [threadId]: {
        ...currentThreadWorkspace,
        mode: "editor",
        openFilePaths: [filePath],
        activeFilePath: filePath,
      },
    },
  };
}

export function closeAllThreadWorkspaceFiles(state: UiState, threadId: string): UiState {
  const currentThreadWorkspace = state.threadWorkspaceById[threadId];
  if (!currentThreadWorkspace) {
    return state;
  }

  if (
    currentThreadWorkspace.mode === "editor" &&
    currentThreadWorkspace.openFilePaths.length === 0 &&
    currentThreadWorkspace.activeFilePath === null
  ) {
    return state;
  }

  return {
    ...state,
    threadWorkspaceById: {
      ...state.threadWorkspaceById,
      [threadId]: {
        ...currentThreadWorkspace,
        mode: "editor",
        openFilePaths: [],
        activeFilePath: null,
      },
    },
  };
}

export function migrateThreadWorkspaceState(
  state: UiState,
  fromThreadId: string,
  toThreadId: string,
): UiState {
  if (fromThreadId === toThreadId) {
    return state;
  }

  const sourceWorkspace = state.threadWorkspaceById[fromThreadId];
  if (!sourceWorkspace) {
    return state;
  }

  const nextThreadWorkspaceById = { ...state.threadWorkspaceById };
  if (!(toThreadId in nextThreadWorkspaceById)) {
    nextThreadWorkspaceById[toThreadId] = sourceWorkspace;
  }
  delete nextThreadWorkspaceById[fromThreadId];

  return {
    ...state,
    threadWorkspaceById: nextThreadWorkspaceById,
  };
}

export function setThreadChangedFilesExpanded(
  state: UiState,
  threadId: string,
  turnId: string,
  expanded: boolean,
): UiState {
  const currentThreadState = state.threadChangedFilesExpandedById[threadId] ?? {};
  const currentExpanded = currentThreadState[turnId] ?? true;
  if (currentExpanded === expanded) {
    return state;
  }

  if (expanded) {
    if (!(turnId in currentThreadState)) {
      return state;
    }

    const nextThreadState = { ...currentThreadState };
    delete nextThreadState[turnId];
    if (Object.keys(nextThreadState).length === 0) {
      const nextState = { ...state.threadChangedFilesExpandedById };
      delete nextState[threadId];
      return {
        ...state,
        threadChangedFilesExpandedById: nextState,
      };
    }

    return {
      ...state,
      threadChangedFilesExpandedById: {
        ...state.threadChangedFilesExpandedById,
        [threadId]: nextThreadState,
      },
    };
  }

  return {
    ...state,
    threadChangedFilesExpandedById: {
      ...state.threadChangedFilesExpandedById,
      [threadId]: {
        ...currentThreadState,
        [turnId]: false,
      },
    },
  };
}

export function toggleProject(state: UiState, projectId: string): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true;
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  };
}

export function setProjectExpanded(state: UiState, projectId: string, expanded: boolean): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state;
  }
  return {
    ...state,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  };
}

export function reorderProjects(
  state: UiState,
  draggedProjectIds: readonly string[],
  targetProjectIds: readonly string[],
): UiState {
  if (draggedProjectIds.length === 0) {
    return state;
  }
  const draggedSet = new Set(draggedProjectIds);
  const targetSet = new Set(targetProjectIds);
  if (draggedProjectIds.every((id) => targetSet.has(id))) {
    return state;
  }

  const originalTargetIndex = state.projectOrder.findIndex((id) => targetSet.has(id));
  if (originalTargetIndex < 0) {
    return state;
  }

  const projectOrder = [...state.projectOrder];

  const removed: string[] = [];
  let draggedBeforeTarget = 0;
  for (let i = projectOrder.length - 1; i >= 0; i--) {
    if (draggedSet.has(projectOrder[i]!)) {
      removed.unshift(projectOrder.splice(i, 1)[0]!);
      if (i < originalTargetIndex) {
        draggedBeforeTarget++;
      }
    }
  }
  if (removed.length === 0) {
    return state;
  }

  const insertIndex = originalTargetIndex - Math.max(0, draggedBeforeTarget - 1);
  projectOrder.splice(insertIndex, 0, ...removed);
  return {
    ...state,
    projectOrder,
  };
}

interface UiStateStore extends UiState {
  syncProjects: (projects: readonly SyncProjectInput[]) => void;
  syncThreads: (threads: readonly SyncThreadInput[]) => void;
  markThreadVisited: (threadId: string, visitedAt?: string) => void;
  markThreadUnread: (threadId: string, latestTurnCompletedAt: string | null | undefined) => void;
  clearThreadUi: (threadId: string) => void;
  setThreadChangedFilesExpanded: (threadId: string, turnId: string, expanded: boolean) => void;
  setThreadWorkspaceMode: (threadId: string, mode: ThreadWorkspaceMode) => void;
  openThreadWorkspaceFile: (threadId: string, filePath: string) => void;
  activateThreadWorkspaceFile: (threadId: string, filePath: string) => void;
  closeThreadWorkspaceFile: (threadId: string, filePath: string) => void;
  closeOtherThreadWorkspaceFiles: (threadId: string, filePath: string) => void;
  closeAllThreadWorkspaceFiles: (threadId: string) => void;
  migrateThreadWorkspaceState: (fromThreadId: string, toThreadId: string) => void;
  toggleProject: (projectId: string) => void;
  setProjectExpanded: (projectId: string, expanded: boolean) => void;
  reorderProjects: (
    draggedProjectIds: readonly string[],
    targetProjectIds: readonly string[],
  ) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  setThreadChangedFilesExpanded: (threadId, turnId, expanded) =>
    set((state) => setThreadChangedFilesExpanded(state, threadId, turnId, expanded)),
  setThreadWorkspaceMode: (threadId, mode) =>
    set((state) => setThreadWorkspaceMode(state, threadId, mode)),
  openThreadWorkspaceFile: (threadId, filePath) =>
    set((state) => openThreadWorkspaceFile(state, threadId, filePath)),
  activateThreadWorkspaceFile: (threadId, filePath) =>
    set((state) => activateThreadWorkspaceFile(state, threadId, filePath)),
  closeThreadWorkspaceFile: (threadId, filePath) =>
    set((state) => closeThreadWorkspaceFile(state, threadId, filePath)),
  closeOtherThreadWorkspaceFiles: (threadId, filePath) =>
    set((state) => closeOtherThreadWorkspaceFiles(state, threadId, filePath)),
  closeAllThreadWorkspaceFiles: (threadId) =>
    set((state) => closeAllThreadWorkspaceFiles(state, threadId)),
  migrateThreadWorkspaceState: (fromThreadId, toThreadId) =>
    set((state) => migrateThreadWorkspaceState(state, fromThreadId, toThreadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectIds, targetProjectIds) =>
    set((state) => reorderProjects(state, draggedProjectIds, targetProjectIds)),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
