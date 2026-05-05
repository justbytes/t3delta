import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { scopedThreadKey, scopeThreadRef } from "@t3delta/client-runtime";
import type {
  ContextMenuItem,
  EnvironmentId,
  ProjectEntry,
  ProjectListDirectoryResult,
  ProjectId,
  ThreadId,
} from "@t3delta/contracts";
import { AlertCircleIcon, ChevronRightIcon, FolderOpenIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { requireEnvironmentConnection } from "../environments/runtime";
import { useTheme } from "../hooks/useTheme";
import { cn } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { useThreadEditorStore } from "../threadEditorStore";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useUiStateStore } from "../uiStateStore";
import { basenameOfPath } from "../vscode-icons";
import { useComposerDraftStore } from "../composerDraftStore";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
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
import { Input } from "./ui/input";
import { toastManager } from "./ui/toast";
import {
  WorkspaceSidecarLoadingState,
  WorkspaceSidecarShell,
  type WorkspaceSidecarLayoutMode,
  type WorkspaceSidecarMode,
} from "./WorkspaceSidecarShell";

const PROJECT_EXPLORER_QUERY_PREFIX = "project-explorer-directory";
const EMPTY_DIAGNOSTIC_COUNTS_BY_PATH: Readonly<
  Record<string, { errors: number; warnings: number }>
> = {};

function mergeDiagnosticCountsByPath(
  projectRuleCounts: Readonly<Record<string, { errors: number; warnings: number }>>,
  editorCounts: Readonly<Record<string, { errors: number; warnings: number }>>,
): Readonly<Record<string, { errors: number; warnings: number }>> {
  if (projectRuleCounts === EMPTY_DIAGNOSTIC_COUNTS_BY_PATH) {
    return editorCounts;
  }
  if (editorCounts === EMPTY_DIAGNOSTIC_COUNTS_BY_PATH) {
    return projectRuleCounts;
  }

  const merged = { ...projectRuleCounts };
  for (const [filePath, counts] of Object.entries(editorCounts)) {
    const current = merged[filePath];
    merged[filePath] = current
      ? {
          errors: current.errors + counts.errors,
          warnings: current.warnings + counts.warnings,
        }
      : counts;
  }
  return merged;
}

function projectExplorerDirectoryQueryKey(
  environmentId: EnvironmentId | null,
  cwd: string | null,
  directoryPath: string,
) {
  return [PROJECT_EXPLORER_QUERY_PREFIX, environmentId ?? null, cwd, directoryPath] as const;
}

type ExplorerContextMenuAction =
  | "new-file"
  | "new-folder"
  | "rename"
  | "move-to-trash"
  | "delete"
  | "open-default"
  | "open-preview"
  | "copy-relative-path"
  | "copy-absolute-path";

interface ExplorerContextTarget {
  readonly kind: "root" | "file" | "directory";
  readonly path: string;
}

interface ExplorerTextPromptState {
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly confirmLabel: string;
}

function parentPathOf(input: string): string {
  const normalized = input.replaceAll("\\", "/");
  const separatorIndex = normalized.lastIndexOf("/");
  if (separatorIndex === -1) {
    return "";
  }
  return normalized.slice(0, separatorIndex);
}

function joinRelativePath(parentPath: string, childName: string): string {
  const trimmedParent = parentPath.replace(/^\/+|\/+$/g, "");
  const trimmedChild = childName.replace(/^\/+|\/+$/g, "");
  return trimmedParent ? `${trimmedParent}/${trimmedChild}` : trimmedChild;
}

function joinWorkspacePath(cwd: string, relativePath: string): string {
  const separator = cwd.includes("\\") ? "\\" : "/";
  const trimmedCwd = cwd.replace(/[\\/]+$/, "");
  const normalizedRelativePath = relativePath.replaceAll(/[\\/]+/g, separator);
  return `${trimmedCwd}${separator}${normalizedRelativePath}`;
}

function validateNewEntryName(rawName: string | null): string | null {
  const name = rawName?.trim();
  if (!name) {
    return null;
  }
  if (
    name === "." ||
    name === ".." ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("../") ||
    name.includes("..\\")
  ) {
    throw new Error("Names must stay inside the selected folder.");
  }
  return name.replaceAll("\\", "/");
}

interface ExplorerEntriesListProps {
  entries: ReadonlyArray<ProjectEntry>;
  depth: number;
  diagnosticCountsByPath: Readonly<Record<string, { errors: number; warnings: number }>>;
  environmentId: EnvironmentId;
  cwd: string;
  resolvedTheme: "light" | "dark";
  expandedDirectories: ReadonlySet<string>;
  toggleDirectory: (directoryPath: string) => void;
  fetchDirectory: (directoryPath: string) => Promise<ProjectListDirectoryResult>;
  onOpenFile: (relativePath: string) => void;
  onOpenContextMenu: (target: ExplorerContextTarget, position: { x: number; y: number }) => void;
  selectedFilePath: string | null;
}

function DiagnosticBadge(props: { counts: { errors: number; warnings: number } | undefined }) {
  if (!props.counts || (props.counts.errors === 0 && props.counts.warnings === 0)) {
    return null;
  }

  const hasErrors = props.counts.errors > 0;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-1 ring-background",
        hasErrors ? "bg-destructive" : "bg-amber-400",
      )}
    />
  );
}

function EntryIconWithDiagnostics(props: {
  counts: { errors: number; warnings: number } | undefined;
  pathValue: string;
  kind: "file" | "directory";
  theme: "light" | "dark";
  opened: boolean | undefined;
}) {
  return (
    <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
      <VscodeEntryIcon
        pathValue={props.pathValue}
        kind={props.kind}
        theme={props.theme}
        {...(props.opened === undefined ? {} : { opened: props.opened })}
        className="size-3.5"
      />
      <DiagnosticBadge counts={props.counts} />
    </span>
  );
}

function getDirectoryDiagnosticCounts(
  diagnosticsByPath: Readonly<Record<string, { errors: number; warnings: number }>>,
  directoryPath: string,
): { errors: number; warnings: number } {
  const prefix = `${directoryPath}/`;
  let errors = 0;
  let warnings = 0;
  for (const [filePath, counts] of Object.entries(diagnosticsByPath)) {
    if (filePath.startsWith(prefix)) {
      errors += counts.errors;
      warnings += counts.warnings;
    }
  }
  return { errors, warnings };
}

function ExplorerEntriesList(props: ExplorerEntriesListProps) {
  return (
    <div className="space-y-0.5">
      {props.entries.map((entry) =>
        entry.kind === "directory" ? (
          <ExplorerDirectoryNode key={`dir:${entry.path}`} entry={entry} {...props} />
        ) : (
          <ExplorerFileNode key={`file:${entry.path}`} entry={entry} {...props} />
        ),
      )}
    </div>
  );
}

function ExplorerDirectoryNode(
  props: ExplorerEntriesListProps & {
    entry: ProjectEntry;
  },
) {
  const {
    cwd,
    entry,
    environmentId,
    expandedDirectories,
    fetchDirectory,
    resolvedTheme,
    toggleDirectory,
    depth,
    onOpenFile,
    onOpenContextMenu,
    selectedFilePath,
  } = props;
  const isExpanded = expandedDirectories.has(entry.path);
  const leftPadding = 10 + depth * 14;
  const diagnosticCounts = getDirectoryDiagnosticCounts(props.diagnosticCountsByPath, entry.path);
  const directoryQuery = useQuery({
    queryKey: projectExplorerDirectoryQueryKey(environmentId, cwd, entry.path),
    queryFn: () => fetchDirectory(entry.path),
    enabled: isExpanded,
    staleTime: 15_000,
  });

  return (
    <div>
      <button
        type="button"
        className={cn(
          "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors",
          isExpanded ? "bg-accent/45" : "hover:bg-background/80",
        )}
        style={{ paddingLeft: `${leftPadding}px` }}
        onClick={() => toggleDirectory(entry.path)}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenContextMenu(
            { kind: "directory", path: entry.path },
            { x: event.clientX, y: event.clientY },
          );
        }}
        title={entry.path}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
            isExpanded && "rotate-90",
          )}
        />
        <EntryIconWithDiagnostics
          pathValue={entry.path}
          kind="directory"
          theme={resolvedTheme}
          opened={isExpanded}
          counts={diagnosticCounts}
        />
        <span
          className={cn(
            "truncate font-mono text-[11px] group-hover:text-foreground/90",
            isExpanded ? "text-foreground/90" : "text-muted-foreground/90",
          )}
        >
          {basenameOfPath(entry.path)}
        </span>
      </button>
      {isExpanded && (
        <div className="space-y-0.5">
          {directoryQuery.isPending ? (
            <div
              className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground/70"
              style={{ paddingLeft: `${leftPadding + 18}px` }}
            >
              <Loader2Icon className="size-3 animate-spin" />
              Loading…
            </div>
          ) : directoryQuery.error ? (
            <div
              className="py-1 text-[11px] text-destructive/80"
              style={{ paddingLeft: `${leftPadding + 18}px` }}
            >
              {directoryQuery.error instanceof Error
                ? directoryQuery.error.message
                : "Failed to load folder contents."}
            </div>
          ) : directoryQuery.data && directoryQuery.data.entries.length > 0 ? (
            <ExplorerEntriesList
              entries={directoryQuery.data.entries}
              depth={depth + 1}
              environmentId={environmentId}
              cwd={cwd}
              diagnosticCountsByPath={props.diagnosticCountsByPath}
              resolvedTheme={resolvedTheme}
              expandedDirectories={expandedDirectories}
              toggleDirectory={toggleDirectory}
              fetchDirectory={fetchDirectory}
              onOpenFile={onOpenFile}
              onOpenContextMenu={props.onOpenContextMenu}
              selectedFilePath={selectedFilePath}
            />
          ) : (
            <div
              className="py-1 text-[11px] text-muted-foreground/60"
              style={{ paddingLeft: `${leftPadding + 18}px` }}
            >
              Empty folder
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExplorerFileNode(
  props: ExplorerEntriesListProps & {
    entry: ProjectEntry;
  },
) {
  const { entry, resolvedTheme, depth, onOpenFile, onOpenContextMenu, selectedFilePath } = props;
  const leftPadding = 10 + depth * 14;
  const isSelected = selectedFilePath === entry.path;
  const diagnosticCounts = props.diagnosticCountsByPath[entry.path];

  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-background/80",
      )}
      style={{ paddingLeft: `${leftPadding}px` }}
      onClick={() => onOpenFile(entry.path)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenContextMenu(
          { kind: "file", path: entry.path },
          { x: event.clientX, y: event.clientY },
        );
      }}
      title={entry.path}
    >
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      <EntryIconWithDiagnostics
        pathValue={entry.path}
        kind="file"
        theme={resolvedTheme}
        opened={undefined}
        counts={diagnosticCounts}
      />
      <span
        className={cn(
          "truncate font-mono text-[11px]",
          isSelected
            ? "text-accent-foreground"
            : "text-muted-foreground/85 group-hover:text-foreground/90",
        )}
      >
        {basenameOfPath(entry.path)}
      </span>
    </button>
  );
}

export default function ProjectExplorerPanel(props: {
  mode: WorkspaceSidecarLayoutMode;
  onSelectSidecar?: (sidecar: WorkspaceSidecarMode) => void;
  source?: {
    environmentId: EnvironmentId;
    threadId: ThreadId;
    projectId: ProjectId;
    worktreePath: string | null;
  };
}) {
  const queryClient = useQueryClient();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = props.source
    ? null
    : routeTarget?.kind === "server"
      ? routeTarget.threadRef
      : null;
  const draftSession = useComposerDraftStore((store) =>
    !props.source && routeTarget?.kind === "draft"
      ? store.getDraftSession(routeTarget.draftId)
      : null,
  );
  const activeThreadRef =
    routeThreadRef ??
    (props.source
      ? scopeThreadRef(props.source.environmentId, props.source.threadId)
      : draftSession
        ? scopeThreadRef(draftSession.environmentId, draftSession.threadId)
        : null);
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProjectId =
    activeThread?.projectId ?? props.source?.projectId ?? draftSession?.projectId ?? null;
  const activeEnvironmentId =
    activeThread?.environmentId ??
    props.source?.environmentId ??
    draftSession?.environmentId ??
    null;
  const activeThreadId =
    activeThread?.id ?? props.source?.threadId ?? draftSession?.threadId ?? null;
  const routeThreadKey = activeThreadRef ? scopedThreadKey(activeThreadRef) : null;
  const activeProject = useStore((store) =>
    activeEnvironmentId && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeEnvironmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const activeCwd =
    activeThread?.worktreePath ??
    props.source?.worktreePath ??
    draftSession?.worktreePath ??
    activeProject?.cwd ??
    null;
  const { resolvedTheme } = useTheme();
  const explorerTheme = resolvedTheme === "light" ? "light" : "dark";
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set());
  const [textPrompt, setTextPrompt] = useState<ExplorerTextPromptState | null>(null);
  const [textPromptValue, setTextPromptValue] = useState("");
  const textPromptResolveRef = useRef<((value: string | null) => void) | null>(null);
  const threadWorkspace = useUiStateStore(
    useCallback(
      (state) =>
        activeThreadId && routeThreadKey
          ? (state.threadWorkspaceById[routeThreadKey] ?? state.threadWorkspaceById[activeThreadId])
          : undefined,
      [activeThreadId, routeThreadKey],
    ),
  );
  const projectRuleDiagnosticCountsByPath = useThreadEditorStore(
    useCallback(
      (state) => {
        if (!activeThreadId || !routeThreadKey) {
          return EMPTY_DIAGNOSTIC_COUNTS_BY_PATH;
        }

        return (
          state.projectRuleDiagnosticCountsByThreadKey[routeThreadKey] ??
          state.projectRuleDiagnosticCountsByThreadKey[activeThreadId] ??
          EMPTY_DIAGNOSTIC_COUNTS_BY_PATH
        );
      },
      [activeThreadId, routeThreadKey],
    ),
  );
  const editorDiagnosticCountsByPath = useThreadEditorStore(
    useCallback(
      (state) => {
        if (!activeThreadId || !routeThreadKey) {
          return EMPTY_DIAGNOSTIC_COUNTS_BY_PATH;
        }

        return (
          state.editorDiagnosticCountsByThreadKey[routeThreadKey] ??
          state.editorDiagnosticCountsByThreadKey[activeThreadId] ??
          EMPTY_DIAGNOSTIC_COUNTS_BY_PATH
        );
      },
      [activeThreadId, routeThreadKey],
    ),
  );
  const diagnosticCountsByPath = useMemo(
    () =>
      mergeDiagnosticCountsByPath(projectRuleDiagnosticCountsByPath, editorDiagnosticCountsByPath),
    [editorDiagnosticCountsByPath, projectRuleDiagnosticCountsByPath],
  );
  const openThreadWorkspaceFile = useUiStateStore((state) => state.openThreadWorkspaceFile);
  const closeThreadWorkspaceFile = useUiStateStore((state) => state.closeThreadWorkspaceFile);

  useEffect(() => {
    return () => {
      textPromptResolveRef.current?.(null);
      textPromptResolveRef.current = null;
    };
  }, []);

  useEffect(() => {
    setExpandedDirectories(new Set());
  }, [activeCwd, activeEnvironmentId]);

  const fetchDirectory = useCallback(
    async (directoryPath: string): Promise<ProjectListDirectoryResult> => {
      if (!activeEnvironmentId || !activeCwd) {
        throw new Error("File explorer is unavailable.");
      }
      return requireEnvironmentConnection(activeEnvironmentId).client.projects.listDirectory({
        cwd: activeCwd,
        ...(directoryPath.length > 0 ? { relativePath: directoryPath } : {}),
      });
    },
    [activeCwd, activeEnvironmentId],
  );

  const rootDirectoryQuery = useQuery({
    queryKey: projectExplorerDirectoryQueryKey(activeEnvironmentId, activeCwd, ""),
    queryFn: () => fetchDirectory(""),
    enabled: activeEnvironmentId !== null && activeCwd !== null,
    staleTime: 15_000,
  });

  const toggleDirectory = useCallback((directoryPath: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(directoryPath)) {
        next.delete(directoryPath);
      } else {
        next.add(directoryPath);
      }
      return next;
    });
  }, []);

  const refreshExplorer = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [PROJECT_EXPLORER_QUERY_PREFIX, activeEnvironmentId, activeCwd],
    });
    void queryClient.invalidateQueries({
      queryKey: ["thread-workspace-file", activeEnvironmentId, activeCwd],
    });
  }, [activeCwd, activeEnvironmentId, queryClient]);

  const openFile = useCallback(
    (relativePath: string) => {
      if (!routeThreadKey) {
        return;
      }
      openThreadWorkspaceFile(routeThreadKey, relativePath);
    },
    [openThreadWorkspaceFile, routeThreadKey],
  );

  const closeOpenPathsMatching = useCallback(
    (removedPath: string) => {
      if (!routeThreadKey) {
        return;
      }
      const workspace = useUiStateStore.getState().threadWorkspaceById[routeThreadKey];
      if (!workspace) {
        return;
      }
      for (const filePath of workspace.openFilePaths) {
        if (filePath === removedPath || filePath.startsWith(`${removedPath}/`)) {
          closeThreadWorkspaceFile(routeThreadKey, filePath);
        }
      }
    },
    [closeThreadWorkspaceFile, routeThreadKey],
  );

  const renameOpenPathsMatching = useCallback(
    (fromPath: string, toPath: string) => {
      if (!routeThreadKey) {
        return;
      }
      const workspace = useUiStateStore.getState().threadWorkspaceById[routeThreadKey];
      if (!workspace) {
        return;
      }
      for (const filePath of workspace.openFilePaths) {
        if (filePath === fromPath || filePath.startsWith(`${fromPath}/`)) {
          const suffix = filePath === fromPath ? "" : filePath.slice(fromPath.length);
          closeThreadWorkspaceFile(routeThreadKey, filePath);
          openThreadWorkspaceFile(routeThreadKey, `${toPath}${suffix}`);
        }
      }
    },
    [closeThreadWorkspaceFile, openThreadWorkspaceFile, routeThreadKey],
  );

  const copyPathToClipboard = useCallback(async (label: string, pathValue: string) => {
    try {
      await navigator.clipboard.writeText(pathValue);
      toastManager.add({
        type: "success",
        title: `Copied ${label}`,
        description: pathValue,
      });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Could not copy ${label}`,
        description: error instanceof Error ? error.message : "Clipboard access failed.",
      });
    }
  }, []);

  const requestTextPrompt = useCallback(
    (options: ExplorerTextPromptState & { readonly initialValue?: string }) =>
      new Promise<string | null>((resolve) => {
        textPromptResolveRef.current?.(null);
        textPromptResolveRef.current = resolve;
        setTextPrompt({
          title: options.title,
          description: options.description,
          label: options.label,
          confirmLabel: options.confirmLabel,
        });
        setTextPromptValue(options.initialValue ?? "");
      }),
    [],
  );

  const closeTextPrompt = useCallback((value: string | null) => {
    const resolve = textPromptResolveRef.current;
    textPromptResolveRef.current = null;
    setTextPrompt(null);
    setTextPromptValue("");
    resolve?.(value);
  }, []);

  const submitTextPrompt = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      closeTextPrompt(textPromptValue);
    },
    [closeTextPrompt, textPromptValue],
  );

  const handleExplorerContextMenu = useCallback(
    async (target: ExplorerContextTarget, position: { x: number; y: number }) => {
      if (!activeEnvironmentId || !activeCwd) {
        return;
      }

      const localApi = readLocalApi();
      if (!localApi) {
        return;
      }

      const targetDirectory =
        target.kind === "directory" || target.kind === "root"
          ? target.path
          : parentPathOf(target.path);
      const absolutePath =
        target.kind === "root" ? activeCwd : joinWorkspacePath(activeCwd, target.path);
      const menuItems: ContextMenuItem<ExplorerContextMenuAction>[] = [
        { id: "new-file", label: "New File..." },
        { id: "new-folder", label: "New Folder..." },
      ];

      if (target.kind !== "root") {
        menuItems.push(
          { id: "open-preview", label: "Open Preview" },
          { id: "open-default", label: "Open in Default App" },
          { id: "rename", label: "Rename..." },
          { id: "copy-relative-path", label: "Copy Relative Path" },
          { id: "copy-absolute-path", label: "Copy Absolute Path" },
          { id: "move-to-trash", label: "Move to Trash" },
          { id: "delete", label: "Delete Permanently...", destructive: true },
        );
      } else {
        menuItems.push(
          { id: "open-default", label: "Open in Default App" },
          { id: "copy-absolute-path", label: "Copy Workspace Path" },
        );
      }

      const clicked = await localApi.contextMenu.show(menuItems, position);
      if (!clicked) {
        return;
      }

      const api = requireEnvironmentConnection(activeEnvironmentId).client.projects;

      try {
        switch (clicked) {
          case "new-file": {
            const name = validateNewEntryName(
              await requestTextPrompt({
                title: "New file",
                description: targetDirectory
                  ? `Create a file in ${targetDirectory}.`
                  : "Create a file at the workspace root.",
                label: "File name",
                confirmLabel: "Create",
              }),
            );
            if (!name) return;
            const relativePath = joinRelativePath(targetDirectory, name);
            await api.writeFile({ cwd: activeCwd, relativePath, contents: "" });
            setExpandedDirectories((current) => new Set(current).add(targetDirectory));
            refreshExplorer();
            openFile(relativePath);
            return;
          }
          case "new-folder": {
            const name = validateNewEntryName(
              await requestTextPrompt({
                title: "New folder",
                description: targetDirectory
                  ? `Create a folder in ${targetDirectory}.`
                  : "Create a folder at the workspace root.",
                label: "Folder name",
                confirmLabel: "Create",
              }),
            );
            if (!name) return;
            const relativePath = joinRelativePath(targetDirectory, name);
            await api.createDirectory({ cwd: activeCwd, relativePath });
            setExpandedDirectories((current) => new Set(current).add(targetDirectory));
            refreshExplorer();
            return;
          }
          case "rename": {
            if (target.kind === "root") return;
            const currentName = basenameOfPath(target.path);
            const name = validateNewEntryName(
              await requestTextPrompt({
                title: "Rename",
                description: `Rename ${target.path}.`,
                label: "New name",
                confirmLabel: "Rename",
                initialValue: currentName,
              }),
            );
            if (!name || name === currentName) return;
            const toRelativePath = joinRelativePath(parentPathOf(target.path), name);
            await api.renameEntry({
              cwd: activeCwd,
              fromRelativePath: target.path,
              toRelativePath,
            });
            refreshExplorer();
            renameOpenPathsMatching(target.path, toRelativePath);
            return;
          }
          case "delete": {
            if (target.kind === "root") return;
            const confirmed = await localApi.dialogs.confirm(
              `Delete ${target.kind} "${target.path}" permanently? This cannot be undone.`,
            );
            if (!confirmed) return;
            await api.deleteEntry({
              cwd: activeCwd,
              relativePath: target.path,
              recursive: target.kind === "directory",
              mode: "delete",
            });
            refreshExplorer();
            closeOpenPathsMatching(target.path);
            return;
          }
          case "move-to-trash": {
            if (target.kind === "root") return;
            const confirmed = await localApi.dialogs.confirm(
              `Move ${target.kind} "${target.path}" to the trash?`,
            );
            if (!confirmed) return;
            await api.deleteEntry({
              cwd: activeCwd,
              relativePath: target.path,
              recursive: target.kind === "directory",
              mode: "trash",
            });
            refreshExplorer();
            closeOpenPathsMatching(target.path);
            return;
          }
          case "open-default":
            await localApi.shell.openInEditor(absolutePath, "file-manager");
            return;
          case "open-preview":
            if (target.kind === "file") {
              openFile(target.path);
            } else if (target.kind === "directory") {
              toggleDirectory(target.path);
            }
            return;
          case "copy-relative-path":
            if (target.kind !== "root") {
              await copyPathToClipboard("relative path", target.path);
            }
            return;
          case "copy-absolute-path":
            await copyPathToClipboard(
              target.kind === "root" ? "workspace path" : "absolute path",
              absolutePath,
            );
            return;
        }
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Explorer action failed",
          description:
            error instanceof Error ? error.message : "The file operation could not be completed.",
        });
      }
    },
    [
      activeCwd,
      activeEnvironmentId,
      closeOpenPathsMatching,
      copyPathToClipboard,
      openFile,
      refreshExplorer,
      renameOpenPathsMatching,
      requestTextPrompt,
      toggleDirectory,
    ],
  );

  return (
    <>
      <WorkspaceSidecarShell
        mode={props.mode}
        sidecar="explorer"
        {...(props.onSelectSidecar ? { onSelectSidecar: props.onSelectSidecar } : {})}
      >
        {!activeEnvironmentId || !activeCwd ? (
          <div className="flex flex-1 items-center justify-center p-5">
            <div className="flex max-w-[20rem] flex-col items-center gap-2 rounded-xl border border-border/70 bg-card/35 px-4 py-5 text-center">
              <FolderOpenIcon className="size-8 text-muted-foreground/55" />
              <p className="text-sm font-medium text-foreground">No active project</p>
              <p className="text-xs text-muted-foreground/70">
                Open a thread with an attached project to browse files here.
              </p>
            </div>
          </div>
        ) : rootDirectoryQuery.isPending && !rootDirectoryQuery.data ? (
          <WorkspaceSidecarLoadingState label="Loading file explorer..." />
        ) : rootDirectoryQuery.error ? (
          <div className="flex flex-1 items-center justify-center p-5">
            <div className="flex max-w-[22rem] flex-col items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-5 text-center">
              <AlertCircleIcon className="size-8 text-destructive/70" />
              <p className="text-sm font-medium text-foreground">Explorer unavailable</p>
              <p className="text-xs text-destructive/80">
                {rootDirectoryQuery.error instanceof Error
                  ? rootDirectoryQuery.error.message
                  : "Failed to load project files."}
              </p>
            </div>
          </div>
        ) : !rootDirectoryQuery.data || rootDirectoryQuery.data.entries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-5">
            <div className="flex max-w-[20rem] flex-col items-center gap-2 rounded-xl border border-border/70 bg-card/35 px-4 py-5 text-center">
              <FolderOpenIcon className="size-8 text-muted-foreground/55" />
              <p className="text-sm font-medium text-foreground">Nothing to show</p>
              <p className="text-xs text-muted-foreground/70">
                This project folder is empty or only contains ignored directories.
              </p>
            </div>
          </div>
        ) : (
          <div
            className="min-h-0 flex-1 overflow-auto px-2 py-2"
            onContextMenu={(event) => {
              event.preventDefault();
              handleExplorerContextMenu(
                { kind: "root", path: "" },
                { x: event.clientX, y: event.clientY },
              );
            }}
          >
            <ExplorerEntriesList
              entries={rootDirectoryQuery.data.entries}
              depth={0}
              environmentId={activeEnvironmentId}
              cwd={activeCwd}
              diagnosticCountsByPath={diagnosticCountsByPath}
              resolvedTheme={explorerTheme}
              expandedDirectories={expandedDirectories}
              toggleDirectory={toggleDirectory}
              fetchDirectory={fetchDirectory}
              onOpenFile={openFile}
              onOpenContextMenu={handleExplorerContextMenu}
              selectedFilePath={threadWorkspace?.activeFilePath ?? null}
            />
          </div>
        )}
      </WorkspaceSidecarShell>
      <Dialog
        open={textPrompt !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeTextPrompt(null);
          }
        }}
      >
        <DialogPopup className="max-w-md">
          <form onSubmit={submitTextPrompt}>
            <DialogHeader>
              <DialogTitle>{textPrompt?.title ?? "File operation"}</DialogTitle>
              <DialogDescription>{textPrompt?.description ?? ""}</DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-2">
              <label className="grid gap-1.5 text-xs font-medium text-foreground">
                {textPrompt?.label ?? "Name"}
                <Input
                  autoFocus
                  aria-label={textPrompt?.label ?? "Name"}
                  value={textPromptValue}
                  onChange={(event) => setTextPromptValue(event.target.value)}
                />
              </label>
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" onClick={() => closeTextPrompt(null)}>
                Cancel
              </Button>
              <Button type="submit">{textPrompt?.confirmLabel ?? "Continue"}</Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
