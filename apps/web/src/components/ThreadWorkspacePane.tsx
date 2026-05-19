import Editor, { type OnMount } from "@monaco-editor/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { EnvironmentId, ProjectLanguageServerStreamEvent } from "@t3delta/contracts";
import {
  AlertCircleIcon,
  BotIcon,
  ChevronRightIcon,
  FileCode2Icon,
  FileWarningIcon,
  ImageIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { readEnvironmentApi } from "../environmentApi";
import { requireEnvironmentConnection } from "../environments/runtime";
import { useSettings } from "../hooks/useSettings";
import { registerMonacoAutoCloseTags } from "../lib/monacoAutoCloseTags";
import { configureMonacoDiagnostics } from "../lib/monacoDiagnostics";
import { registerMonacoJsxTagCompletions } from "../lib/monacoJsxTagCompletions";
import { registerMonacoLanguageServerProviders } from "../lib/monacoLanguageServer";
import { resolveMonacoProjectProfile } from "../lib/monacoProjectProfile";
import { cn } from "../lib/utils";
import { resolveEditorLanguage } from "../lib/editorSyntax";
import { useThreadEditorStore, type ThreadEditorBufferState } from "../threadEditorStore";
import { basenameOfPath } from "../vscode-icons";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "./ui/menu";

interface ThreadWorkspaceTabStripProps {
  activeFilePath: string | null;
  dirtyFilePaths: ReadonlySet<string>;
  openFilePaths: readonly string[];
  mode: "agent" | "editor";
  resolvedTheme: "light" | "dark";
  onOpenAgent: () => void;
  onActivateFile: (filePath: string) => void;
  onCloseFile: (filePath: string) => void;
  onCloseOtherFiles: (filePath: string) => void;
  onCloseAllFiles: () => void;
}

export function ThreadWorkspaceTabStrip(props: ThreadWorkspaceTabStripProps) {
  return (
    <div className="border-b border-border px-3 sm:px-5">
      <div className="thread-workspace-tab-strip flex min-h-11 items-end gap-1 overflow-x-auto py-2">
        <button
          type="button"
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-xs font-medium transition-colors",
            props.mode === "agent"
              ? "border-border bg-card text-foreground"
              : "border-transparent bg-muted/35 text-muted-foreground hover:bg-muted/55",
          )}
          onClick={props.onOpenAgent}
        >
          <BotIcon className="size-3.5" />
          Agent
        </button>
        {props.openFilePaths.map((filePath) => {
          const isActive = props.activeFilePath === filePath;
          const isDirty = props.dirtyFilePaths.has(filePath);
          return (
            <div
              key={filePath}
              className={cn(
                "group inline-flex h-8 shrink-0 items-center gap-2 rounded-t-md border border-b-0 px-2.5 text-xs",
                isActive && props.mode === "editor"
                  ? "border-border bg-card text-foreground"
                  : "border-transparent bg-muted/35 text-muted-foreground hover:bg-muted/55",
              )}
            >
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-2"
                onMouseDown={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    props.onCloseFile(filePath);
                  }
                }}
                onClick={() => props.onActivateFile(filePath)}
                title={filePath}
              >
                <VscodeEntryIcon
                  pathValue={filePath}
                  kind="file"
                  theme={props.resolvedTheme}
                  className="size-3.5"
                />
                <span className="truncate font-mono">{basenameOfPath(filePath)}</span>
                {isDirty ? <span className="text-amber-400">●</span> : null}
              </button>
              <Menu>
                <MenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Tab actions for ${basenameOfPath(filePath)}`}
                      className={cn(
                        "rounded-sm p-0.5 text-muted-foreground/80 transition-colors hover:bg-background/80 hover:text-foreground",
                        isActive && props.mode === "editor"
                          ? "opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
                    />
                  }
                >
                  <MoreHorizontalIcon className="size-3" />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuItem onClick={() => props.onActivateFile(filePath)}>Select tab</MenuItem>
                  <MenuItem onClick={() => props.onCloseFile(filePath)}>Close</MenuItem>
                  <MenuItem
                    disabled={props.openFilePaths.length <= 1}
                    onClick={() => props.onCloseOtherFiles(filePath)}
                  >
                    Close others
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem
                    disabled={props.openFilePaths.length === 0}
                    onClick={props.onCloseAllFiles}
                  >
                    Close all
                  </MenuItem>
                </MenuPopup>
              </Menu>
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground/80 transition-colors hover:bg-background/80 hover:text-foreground"
                onClick={() => props.onCloseFile(filePath)}
                aria-label={`Close ${basenameOfPath(filePath)}`}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface WorkspaceProblemItem {
  readonly key: string;
  readonly line: number;
  readonly column: number;
  readonly endLine: number;
  readonly endColumn: number;
  readonly severity: "error" | "warning" | "information" | "hint";
  readonly message: string;
  readonly source: string;
  readonly code?: string;
}

type ImagePreviewBuffer = Extract<ThreadEditorBufferState, { byteLength: number }> & {
  dataUrl: string;
  mediaType: string;
};

function isImagePreviewBuffer(
  buffer: ThreadEditorBufferState | null,
): buffer is ImagePreviewBuffer {
  return Boolean(
    buffer &&
    "dataUrl" in buffer &&
    typeof buffer.dataUrl === "string" &&
    "mediaType" in buffer &&
    typeof buffer.mediaType === "string" &&
    buffer.mediaType.startsWith("image/"),
  );
}

function severityFromMarker(severity: number): WorkspaceProblemItem["severity"] {
  if (severity === 8) return "error";
  if (severity === 4) return "warning";
  if (severity === 2) return "information";
  return "hint";
}

export function ThreadWorkspacePane(props: {
  activeFilePath: string | null;
  cwd: string | null;
  environmentId: EnvironmentId;
  resolvedTheme: "light" | "dark";
  threadKey: string | null;
  onOpenExplorer: () => void;
  onSwitchToAgent: () => void;
  onToggleTerminal: () => void;
  terminalOpen: boolean;
}) {
  const editorCustomAssociations = useSettings((settings) => settings.editorCustomAssociations);
  const editorEnabledLanguageIds = useSettings((settings) => settings.editorEnabledLanguageIds);
  const editorLanguageServerPreferences = useSettings(
    (settings) => settings.editorLanguageServerPreferences,
  );
  const enableMonacoEditorDiagnostics = useSettings(
    (settings) => settings.enableMonacoEditorDiagnostics,
  );
  const enableProjectDiagnostics = useSettings((settings) => settings.enableProjectDiagnostics);
  const [editorProblems, setEditorProblems] = useState<WorkspaceProblemItem[]>([]);
  const [activeLspDiagnosticKeys, setActiveLspDiagnosticKeys] = useState<string[]>([]);
  const monacoEditorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null);
  const monacoEditorDisposablesRef = useRef<{ dispose: () => void }[]>([]);
  const monacoLspDisposablesRef = useRef<{ dispose: () => void }[]>([]);
  const lspDocumentSyncRef = useRef<{
    cwd: string;
    serverId: string;
    relativePath: string;
    languageId: string;
    version: number;
    lastText: string;
    saveSignature: string | null;
  } | null>(null);
  const lspFeatureContextRef = useRef<{
    environmentId: EnvironmentId | null;
    cwd: string | null;
    relativePath: string | null;
    serverId: string | null;
  }>({
    environmentId: null,
    cwd: null,
    relativePath: null,
    serverId: null,
  });
  const queryClient = useQueryClient();
  const activeEditorBuffer = useThreadEditorStore(
    useCallback(
      (state) =>
        props.threadKey && props.activeFilePath
          ? (state.buffersByThreadKey[props.threadKey]?.[props.activeFilePath] ?? null)
          : null,
      [props.activeFilePath, props.threadKey],
    ),
  );
  const ensureLoadingBuffer = useThreadEditorStore((state) => state.ensureLoadingBuffer);
  const receiveReadResult = useThreadEditorStore((state) => state.receiveReadResult);
  const setLoadError = useThreadEditorStore((state) => state.setLoadError);
  const updateDraft = useThreadEditorStore((state) => state.updateDraft);
  const setSaving = useThreadEditorStore((state) => state.setSaving);
  const setSaveError = useThreadEditorStore((state) => state.setSaveError);
  const commitSavedDraft = useThreadEditorStore((state) => state.commitSavedDraft);
  const setEditorDiagnosticCounts = useThreadEditorStore(
    (state) => state.setEditorDiagnosticCounts,
  );
  const activeTextBuffer = activeEditorBuffer?.kind === "text" ? activeEditorBuffer : null;
  const activeImagePreviewBuffer = isImagePreviewBuffer(activeEditorBuffer)
    ? activeEditorBuffer
    : null;
  const activeBinaryBuffer = activeEditorBuffer?.kind === "binary" ? activeEditorBuffer : null;
  const activeTooLargeBuffer = activeEditorBuffer?.kind === "tooLarge" ? activeEditorBuffer : null;
  const isActiveTextBufferDirty =
    activeTextBuffer !== null && activeTextBuffer.draftContents !== activeTextBuffer.savedContents;
  const shouldReadFile =
    props.threadKey !== null &&
    props.cwd !== null &&
    props.activeFilePath !== null &&
    (activeEditorBuffer === null ||
      activeEditorBuffer.kind === "loading" ||
      activeEditorBuffer.kind === "error");

  const fileQuery = useQuery({
    queryKey: ["thread-workspace-file", props.environmentId, props.cwd, props.activeFilePath],
    queryFn: () => {
      const readFile = requireEnvironmentConnection(props.environmentId).client.projects.readFile;
      if (typeof readFile !== "function") {
        throw new Error(
          "Editor preview needs a full app reload because the live workspace RPC client is stale.",
        );
      }
      return readFile({
        cwd: props.cwd!,
        relativePath: props.activeFilePath!,
      });
    },
    enabled: shouldReadFile,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!props.threadKey || !props.activeFilePath || !props.cwd) {
      return;
    }
    if (activeEditorBuffer !== null) {
      return;
    }
    ensureLoadingBuffer(props.threadKey, props.activeFilePath);
  }, [activeEditorBuffer, ensureLoadingBuffer, props.activeFilePath, props.cwd, props.threadKey]);

  useEffect(() => {
    if (!props.threadKey || !fileQuery.data) {
      return;
    }
    receiveReadResult(props.threadKey, fileQuery.data);
  }, [fileQuery.data, props.threadKey, receiveReadResult]);

  useEffect(() => {
    if (!props.threadKey || !props.activeFilePath || !fileQuery.error) {
      return;
    }
    setLoadError(
      props.threadKey,
      props.activeFilePath,
      fileQuery.error instanceof Error ? fileQuery.error.message : "Failed to read workspace file.",
    );
  }, [fileQuery.error, props.activeFilePath, props.threadKey, setLoadError]);

  const textFileLanguage = useMemo(() => {
    if (!activeTextBuffer) {
      return null;
    }
    return resolveEditorLanguage(activeTextBuffer.relativePath, {
      enabledLanguageIds: editorEnabledLanguageIds,
      customAssociations: editorCustomAssociations,
    });
  }, [activeEditorBuffer, activeTextBuffer, editorCustomAssociations, editorEnabledLanguageIds]);
  const monacoProjectProfile = useMemo(
    () => (activeTextBuffer ? resolveMonacoProjectProfile(activeTextBuffer.relativePath) : "web"),
    [activeTextBuffer],
  );
  const activeLanguageServerPreference = useMemo(
    () => (textFileLanguage ? (editorLanguageServerPreferences[textFileLanguage] ?? null) : null),
    [editorLanguageServerPreferences, textFileLanguage],
  );
  const activeLanguageServerId =
    activeLanguageServerPreference?.enabled &&
    activeLanguageServerPreference.serverId.trim().length > 0
      ? activeLanguageServerPreference.serverId.trim()
      : null;
  const supportsMonacoLanguageServer =
    textFileLanguage === "typescript" ||
    textFileLanguage === "javascript" ||
    textFileLanguage === "rust" ||
    textFileLanguage === "python" ||
    textFileLanguage === "solidity" ||
    textFileLanguage === "cpp" ||
    textFileLanguage === "java" ||
    textFileLanguage === "csharp" ||
    textFileLanguage === "html" ||
    textFileLanguage === "css";
  const monacoDiagnosticsMode =
    activeLanguageServerId &&
    (textFileLanguage === "typescript" || textFileLanguage === "javascript")
      ? "full"
      : enableMonacoEditorDiagnostics || enableProjectDiagnostics
        ? "full"
        : "syntax";
  useEffect(() => {
    lspFeatureContextRef.current = {
      environmentId: props.environmentId,
      cwd: props.cwd,
      relativePath: activeTextBuffer?.relativePath ?? null,
      serverId: supportsMonacoLanguageServer ? activeLanguageServerId : null,
    };
  }, [
    activeLanguageServerId,
    activeTextBuffer?.relativePath,
    props.cwd,
    props.environmentId,
    supportsMonacoLanguageServer,
    textFileLanguage,
  ]);
  const diagnosticsQuery = useQuery({
    queryKey: [
      "thread-workspace-diagnostics",
      props.environmentId,
      props.cwd,
      activeTextBuffer?.relativePath ?? null,
      activeTextBuffer?.modifiedAt ?? null,
      textFileLanguage ?? null,
      enableProjectDiagnostics,
    ],
    queryFn: () =>
      requireEnvironmentConnection(props.environmentId).client.projects.readDiagnostics({
        cwd: props.cwd!,
        relativePath: activeTextBuffer!.relativePath,
      }),
    enabled:
      enableProjectDiagnostics &&
      props.cwd !== null &&
      activeTextBuffer !== null &&
      !isActiveTextBufferDirty &&
      textFileLanguage !== null &&
      textFileLanguage !== "plaintext",
    staleTime: 0,
  });
  const saveCurrentFile = useCallback(async () => {
    if (
      !props.threadKey ||
      !props.cwd ||
      !props.activeFilePath ||
      !activeTextBuffer ||
      activeTextBuffer.isSaving
    ) {
      return;
    }

    const api = readEnvironmentApi(props.environmentId);
    if (!api) {
      setSaveError(props.threadKey, props.activeFilePath, "Workspace API unavailable.");
      return;
    }

    const contentsToSave = monacoEditorRef.current?.getValue() ?? activeTextBuffer.draftContents;
    if (contentsToSave !== activeTextBuffer.draftContents) {
      updateDraft(props.threadKey, props.activeFilePath, contentsToSave);
    }

    setSaving(props.threadKey, props.activeFilePath, true);
    try {
      await api.projects.writeFile({
        cwd: props.cwd,
        relativePath: props.activeFilePath,
        contents: contentsToSave,
      });
      commitSavedDraft(props.threadKey, props.activeFilePath);
      await queryClient.invalidateQueries({
        queryKey: ["thread-workspace-file", props.environmentId, props.cwd, props.activeFilePath],
        exact: true,
      });
    } catch (error) {
      setSaveError(
        props.threadKey,
        props.activeFilePath,
        error instanceof Error ? error.message : "Failed to save workspace file.",
      );
    }
  }, [
    activeTextBuffer,
    commitSavedDraft,
    props.activeFilePath,
    props.cwd,
    props.environmentId,
    props.threadKey,
    queryClient,
    setSaveError,
    setSaving,
    updateDraft,
  ]);
  const saveCurrentFileRef = useRef(saveCurrentFile);
  useEffect(() => {
    saveCurrentFileRef.current = saveCurrentFile;
  }, [saveCurrentFile]);
  const handleEditorBeforeMount = useCallback(
    (monaco: Parameters<OnMount>[1]) => {
      configureMonacoDiagnostics(monaco, {
        mode: monacoDiagnosticsMode,
        profile: monacoProjectProfile,
      });
    },
    [monacoDiagnosticsMode, monacoProjectProfile],
  );
  const handleEditorMount = useCallback<OnMount>(
    (editor, monaco) => {
      monacoEditorRef.current = editor;
      monacoRef.current = monaco;
      for (const disposable of monacoEditorDisposablesRef.current) {
        disposable.dispose();
      }
      monacoEditorDisposablesRef.current = [registerMonacoAutoCloseTags(editor, monaco)];
      if (monacoLspDisposablesRef.current.length === 0) {
        monacoLspDisposablesRef.current = [
          ...registerMonacoLanguageServerProviders(monaco, () => lspFeatureContextRef.current),
          registerMonacoJsxTagCompletions(monaco),
        ];
      }
      const model = editor.getModel();
      if (model && activeTextBuffer && !isActiveTextBufferDirty && diagnosticsQuery.data) {
        monaco.editor.setModelMarkers(
          model,
          "project-diagnostics",
          diagnosticsQuery.data.diagnostics.map((diagnostic) => ({
            startLineNumber: diagnostic.line,
            startColumn: diagnostic.column,
            endLineNumber: diagnostic.endLine ?? diagnostic.line,
            endColumn: diagnostic.endColumn ?? diagnostic.column + 1,
            message: diagnostic.message,
            severity:
              diagnostic.severity === "error"
                ? monaco.MarkerSeverity.Error
                : diagnostic.severity === "warning"
                  ? monaco.MarkerSeverity.Warning
                  : diagnostic.severity === "hint"
                    ? monaco.MarkerSeverity.Hint
                    : monaco.MarkerSeverity.Info,
            source: diagnostic.source,
            ...(diagnostic.code ? { code: diagnostic.code } : {}),
          })),
        );
      }
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void saveCurrentFileRef.current();
      });
      editor.addAction({
        id: "t3delta.languageServer.references",
        label: "Find all references",
        keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F12],
        run: () => {
          editor.trigger("t3delta", "editor.action.referenceSearch.trigger", {});
        },
      });
      editor.focus();
    },
    [activeTextBuffer, diagnosticsQuery.data, isActiveTextBufferDirty],
  );

  useEffect(() => {
    if (!activeTextBuffer) {
      setEditorProblems([]);
      setActiveLspDiagnosticKeys([]);
    }
  }, [activeTextBuffer]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = monacoEditorRef.current;
    const model = editor?.getModel();

    if (!monaco || !model) {
      return;
    }

    if (
      !activeTextBuffer ||
      !enableProjectDiagnostics ||
      isActiveTextBufferDirty ||
      textFileLanguage === "plaintext" ||
      !diagnosticsQuery.data
    ) {
      monaco.editor.setModelMarkers(model, "project-diagnostics", []);
      return;
    }

    const projectDiagnosticsNeedDedupe =
      (textFileLanguage === "rust" && activeLanguageServerId === "rust-analyzer") ||
      (textFileLanguage === "python" && activeLanguageServerId === "pyright-langserver") ||
      (textFileLanguage === "solidity" && activeLanguageServerId === "solidity-language-server");
    const filteredDiagnostics = projectDiagnosticsNeedDedupe
      ? diagnosticsQuery.data.diagnostics.filter((diagnostic) => {
          const key = [
            diagnostic.line,
            diagnostic.column,
            diagnostic.endLine ?? diagnostic.line,
            diagnostic.endColumn ?? diagnostic.column + 1,
            diagnostic.severity,
            diagnostic.code ?? "",
            diagnostic.message,
          ].join(":");
          return !activeLspDiagnosticKeys.includes(key);
        })
      : diagnosticsQuery.data.diagnostics;

    const markers = filteredDiagnostics.map((diagnostic) => ({
      startLineNumber: diagnostic.line,
      startColumn: diagnostic.column,
      endLineNumber: diagnostic.endLine ?? diagnostic.line,
      endColumn: diagnostic.endColumn ?? diagnostic.column + 1,
      message: diagnostic.message,
      severity:
        diagnostic.severity === "error"
          ? monaco.MarkerSeverity.Error
          : diagnostic.severity === "warning"
            ? monaco.MarkerSeverity.Warning
            : diagnostic.severity === "hint"
              ? monaco.MarkerSeverity.Hint
              : monaco.MarkerSeverity.Info,
      source: diagnostic.source,
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
    }));

    monaco.editor.setModelMarkers(model, "project-diagnostics", markers);

    return () => {
      monaco.editor.setModelMarkers(model, "project-diagnostics", []);
    };
  }, [
    activeLanguageServerId,
    activeLspDiagnosticKeys,
    activeTextBuffer,
    diagnosticsQuery.data,
    enableProjectDiagnostics,
    isActiveTextBufferDirty,
    textFileLanguage,
  ]);

  useEffect(() => {
    const monaco = monacoRef.current;
    const editor = monacoEditorRef.current;
    const model = editor?.getModel();

    if (!monaco || !model || !props.cwd || !activeTextBuffer || !activeLanguageServerId) {
      if (monaco && model) {
        monaco.editor.setModelMarkers(model, "lsp-diagnostics", []);
      }
      setActiveLspDiagnosticKeys([]);
      return;
    }

    const unsubscribe = requireEnvironmentConnection(
      props.environmentId,
    ).client.projects.onLanguageServerEvent(
      {
        cwd: props.cwd,
        serverId: activeLanguageServerId,
      },
      (event: ProjectLanguageServerStreamEvent) => {
        if (event.type === "session") {
          if (event.status === "missingBinary" || event.status === "failed") {
            console.warn(
              `[lsp] ${event.session.serverId} ${event.detail ?? event.status} (${event.session.cwd})`,
            );
          }
          return;
        }

        if (event.relativePath !== activeTextBuffer.relativePath) {
          return;
        }

        const diagnosticKeys = event.diagnostics.map((diagnostic) =>
          [
            diagnostic.line,
            diagnostic.column,
            diagnostic.endLine ?? diagnostic.line,
            diagnostic.endColumn ?? diagnostic.column + 1,
            diagnostic.severity,
            diagnostic.code ?? "",
            diagnostic.message,
          ].join(":"),
        );
        setActiveLspDiagnosticKeys(diagnosticKeys);

        const markers = event.diagnostics.map((diagnostic) => ({
          startLineNumber: diagnostic.line,
          startColumn: diagnostic.column,
          endLineNumber: diagnostic.endLine ?? diagnostic.line,
          endColumn: diagnostic.endColumn ?? diagnostic.column + 1,
          message: diagnostic.message,
          severity:
            diagnostic.severity === "error"
              ? monaco.MarkerSeverity.Error
              : diagnostic.severity === "warning"
                ? monaco.MarkerSeverity.Warning
                : diagnostic.severity === "hint"
                  ? monaco.MarkerSeverity.Hint
                  : monaco.MarkerSeverity.Info,
          source: diagnostic.source,
          ...(diagnostic.code ? { code: diagnostic.code } : {}),
        }));

        monaco.editor.setModelMarkers(model, "lsp-diagnostics", markers);
      },
    );

    return () => {
      unsubscribe();
      setActiveLspDiagnosticKeys([]);
      monaco.editor.setModelMarkers(model, "lsp-diagnostics", []);
    };
  }, [activeLanguageServerId, activeTextBuffer?.relativePath, props.cwd, props.environmentId]);

  useEffect(() => {
    const currentSync = lspDocumentSyncRef.current;
    const closeCurrent = () => {
      if (!currentSync) {
        return;
      }
      void requireEnvironmentConnection(
        props.environmentId,
      ).client.projects.syncLanguageServerDocument({
        cwd: currentSync.cwd,
        serverId: currentSync.serverId,
        relativePath: currentSync.relativePath,
        languageId: currentSync.languageId,
        version: currentSync.version,
        action: "close",
      });
      lspDocumentSyncRef.current = null;
    };

    if (
      !props.cwd ||
      !activeTextBuffer ||
      !textFileLanguage ||
      textFileLanguage === "plaintext" ||
      !activeLanguageServerId
    ) {
      closeCurrent();
      return;
    }

    const existing = lspDocumentSyncRef.current;
    const client = requireEnvironmentConnection(props.environmentId).client.projects;

    if (
      !existing ||
      existing.cwd !== props.cwd ||
      existing.serverId !== activeLanguageServerId ||
      existing.relativePath !== activeTextBuffer.relativePath ||
      existing.languageId !== textFileLanguage
    ) {
      if (existing) {
        void client.syncLanguageServerDocument({
          cwd: existing.cwd,
          serverId: existing.serverId,
          relativePath: existing.relativePath,
          languageId: existing.languageId,
          version: existing.version,
          action: "close",
        });
      }

      lspDocumentSyncRef.current = {
        cwd: props.cwd,
        serverId: activeLanguageServerId,
        relativePath: activeTextBuffer.relativePath,
        languageId: textFileLanguage,
        version: 1,
        lastText: activeTextBuffer.draftContents,
        saveSignature: isActiveTextBufferDirty ? null : `${activeTextBuffer.modifiedAt}:1`,
      };

      void client.syncLanguageServerDocument({
        cwd: props.cwd,
        serverId: activeLanguageServerId,
        relativePath: activeTextBuffer.relativePath,
        languageId: textFileLanguage,
        version: 1,
        action: "open",
        text: activeTextBuffer.draftContents,
      });
      return;
    }

    if (existing.lastText !== activeTextBuffer.draftContents) {
      const nextVersion = existing.version + 1;
      lspDocumentSyncRef.current = {
        ...existing,
        version: nextVersion,
        lastText: activeTextBuffer.draftContents,
      };

      void client.syncLanguageServerDocument({
        cwd: props.cwd,
        serverId: activeLanguageServerId,
        relativePath: activeTextBuffer.relativePath,
        languageId: textFileLanguage,
        version: nextVersion,
        action: "change",
        text: activeTextBuffer.draftContents,
      });
      return;
    }

    const saveSignature = isActiveTextBufferDirty
      ? null
      : `${activeTextBuffer.modifiedAt}:${existing.version}`;
    if (saveSignature && existing.saveSignature !== saveSignature) {
      lspDocumentSyncRef.current = {
        ...existing,
        saveSignature,
      };

      void client.syncLanguageServerDocument({
        cwd: props.cwd,
        serverId: activeLanguageServerId,
        relativePath: activeTextBuffer.relativePath,
        languageId: textFileLanguage,
        version: existing.version,
        action: "save",
        text: activeTextBuffer.draftContents,
      });
    }
  }, [
    activeLanguageServerId,
    activeTextBuffer,
    isActiveTextBufferDirty,
    props.cwd,
    props.environmentId,
    textFileLanguage,
  ]);

  useEffect(() => {
    return () => {
      for (const disposable of monacoEditorDisposablesRef.current) {
        disposable.dispose();
      }
      monacoEditorDisposablesRef.current = [];
      for (const disposable of monacoLspDisposablesRef.current) {
        disposable.dispose();
      }
      monacoLspDisposablesRef.current = [];
      const currentSync = lspDocumentSyncRef.current;
      if (!currentSync) {
        return;
      }
      void requireEnvironmentConnection(
        props.environmentId,
      ).client.projects.syncLanguageServerDocument({
        cwd: currentSync.cwd,
        serverId: currentSync.serverId,
        relativePath: currentSync.relativePath,
        languageId: currentSync.languageId,
        version: currentSync.version,
        action: "close",
      });
      lspDocumentSyncRef.current = null;
    };
  }, [props.environmentId]);

  const combinedDiagnosticCounts = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    for (const problem of editorProblems) {
      if (problem.severity === "error") {
        errors += 1;
      } else if (problem.severity === "warning") {
        warnings += 1;
      }
    }
    return { errors, warnings };
  }, [editorProblems]);

  useEffect(() => {
    if (!props.threadKey || !activeTextBuffer) {
      return;
    }
    setEditorDiagnosticCounts(
      props.threadKey,
      activeTextBuffer.relativePath,
      combinedDiagnosticCounts,
    );
  }, [activeTextBuffer, combinedDiagnosticCounts, props.threadKey, setEditorDiagnosticCounts]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        {props.activeFilePath === null ? (
          <WorkspaceNotice
            icon={<FileCode2Icon className="size-6 text-muted-foreground" />}
            title="Editor ready"
            description="The center pane is in editor mode. Use the explorer to open a file, keep the right-side tools visible, and bring the agent back when you want to continue the thread."
            actions={
              <>
                <WorkspaceActionButton onClick={props.onOpenExplorer}>
                  Show file explorer
                </WorkspaceActionButton>
                <WorkspaceActionButton onClick={props.onToggleTerminal}>
                  {props.terminalOpen ? "Hide terminal" : "Show terminal"}
                </WorkspaceActionButton>
                <WorkspaceActionButton onClick={props.onSwitchToAgent}>
                  Return to agent
                </WorkspaceActionButton>
              </>
            }
          />
        ) : props.cwd === null ? (
          <WorkspaceNotice
            icon={<AlertCircleIcon className="size-6 text-destructive/80" />}
            title="Workspace unavailable"
            description="This thread does not have an active project root to read files from."
            destructive
            actions={
              <WorkspaceActionButton onClick={props.onSwitchToAgent}>
                Return to agent
              </WorkspaceActionButton>
            }
          />
        ) : activeEditorBuffer?.kind === "loading" ||
          (fileQuery.isPending && activeEditorBuffer === null) ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <WorkspaceFileBreadcrumb
              cwd={props.cwd}
              filePath={props.activeFilePath}
              resolvedTheme={props.resolvedTheme}
              rightSlot={
                <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              }
            />
            <div className="flex flex-1 items-start justify-center px-6 py-8">
              <div className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2Icon className="size-3.5 animate-spin" />
                Opening file preview...
              </div>
            </div>
          </div>
        ) : activeEditorBuffer?.kind === "error" ? (
          <WorkspaceNotice
            icon={<AlertCircleIcon className="size-6 text-destructive/80" />}
            title="Unable to load file"
            description={activeEditorBuffer.error}
            destructive
            actions={
              <>
                <WorkspaceActionButton onClick={() => void fileQuery.refetch()}>
                  Retry
                </WorkspaceActionButton>
                <WorkspaceActionButton onClick={props.onOpenExplorer}>
                  Show file explorer
                </WorkspaceActionButton>
              </>
            }
          />
        ) : activeImagePreviewBuffer ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <WorkspaceFileBreadcrumb
              cwd={props.cwd}
              filePath={activeImagePreviewBuffer.relativePath}
              resolvedTheme={props.resolvedTheme}
              rightSlot={
                <span className="rounded-full border border-border/70 bg-muted/35 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {activeImagePreviewBuffer.mediaType}
                </span>
              }
            />
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/10 p-6">
              <div className="flex min-h-0 max-h-full max-w-full flex-col items-center gap-4">
                <div className="flex min-h-0 max-h-full max-w-full items-center justify-center rounded-lg border border-border/70 bg-background/80 p-4">
                  <img
                    src={activeImagePreviewBuffer.dataUrl}
                    alt={basenameOfPath(activeImagePreviewBuffer.relativePath)}
                    className="max-h-[70vh] max-w-full object-contain"
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ImageIcon className="size-3.5" />
                  {activeImagePreviewBuffer.byteLength.toLocaleString()} bytes
                </div>
              </div>
            </div>
          </div>
        ) : activeTextBuffer ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <WorkspaceFileBreadcrumb
              cwd={props.cwd}
              filePath={activeTextBuffer.relativePath}
              resolvedTheme={props.resolvedTheme}
            />
            <div className="thread-workspace-syntax min-h-0 flex-1 overflow-hidden">
              <Editor
                key={`${activeTextBuffer.relativePath}:monaco-${monacoProjectProfile}-${monacoDiagnosticsMode}`}
                path={activeTextBuffer.relativePath}
                beforeMount={handleEditorBeforeMount}
                language={textFileLanguage ?? "plaintext"}
                theme={props.resolvedTheme === "dark" ? "vs-dark" : "vs"}
                height="100%"
                width="100%"
                value={activeTextBuffer.draftContents}
                onMount={handleEditorMount}
                onValidate={(markers) => {
                  const seen = new Set<string>();
                  const nextProblems: WorkspaceProblemItem[] = [];
                  for (const marker of markers) {
                    const severity = severityFromMarker(marker.severity);
                    const key = [
                      marker.startLineNumber,
                      marker.startColumn,
                      marker.endLineNumber,
                      marker.endColumn,
                      severity,
                      marker.code ? String(marker.code) : "",
                      marker.source ?? "",
                      marker.message,
                    ].join(":");
                    if (seen.has(key)) {
                      continue;
                    }
                    seen.add(key);
                    nextProblems.push({
                      key,
                      line: marker.startLineNumber,
                      column: marker.startColumn,
                      endLine: marker.endLineNumber,
                      endColumn: marker.endColumn,
                      severity,
                      message: marker.message,
                      source: marker.source ?? "editor",
                      ...(marker.code ? { code: String(marker.code) } : {}),
                    });
                  }
                  setEditorProblems(nextProblems);
                }}
                onChange={(nextValue) => {
                  if (!props.threadKey || !props.activeFilePath) {
                    return;
                  }
                  updateDraft(props.threadKey, props.activeFilePath, nextValue ?? "");
                }}
                options={{
                  automaticLayout: true,
                  fontSize: 13,
                  fontLigatures: true,
                  lineNumbers: "on",
                  lineNumbersMinChars: 3,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  wordWrap: "off",
                  renderWhitespace: "selection",
                  bracketPairColorization: { enabled: true },
                  acceptSuggestionOnEnter: "on",
                  glyphMargin: true,
                  guides: {
                    bracketPairs: true,
                    indentation: true,
                  },
                  matchBrackets: "always",
                  snippetSuggestions: "top",
                  tabSize: 2,
                  tabCompletion: "on",
                  insertSpaces: true,
                  stickyScroll: { enabled: false },
                  padding: { top: 12, bottom: 12 },
                  renderValidationDecorations: "on",
                }}
              />
            </div>
          </div>
        ) : activeBinaryBuffer ? (
          <WorkspaceNotice
            icon={<FileWarningIcon className="size-6 text-amber-400" />}
            title="Binary file cannot be edited inline"
            description={`${activeBinaryBuffer.relativePath} contains binary data, so T3 Delta is not rendering it as a text editor.`}
            actions={
              <WorkspaceActionButton onClick={props.onOpenExplorer}>
                Show file explorer
              </WorkspaceActionButton>
            }
          />
        ) : activeTooLargeBuffer ? (
          <WorkspaceNotice
            icon={<FileWarningIcon className="size-6 text-amber-400" />}
            title="File too large to preview"
            description={`${activeTooLargeBuffer.relativePath} is ${activeTooLargeBuffer.byteLength.toLocaleString()} bytes. Inline editing is capped for now to keep the center pane responsive.`}
            actions={
              <WorkspaceActionButton onClick={props.onOpenExplorer}>
                Show file explorer
              </WorkspaceActionButton>
            }
          />
        ) : (
          <WorkspaceNotice
            icon={<FileWarningIcon className="size-6 text-amber-400" />}
            title="Unsupported file encoding"
            description={`${activeEditorBuffer?.relativePath ?? props.activeFilePath} is not UTF-8 text, so it cannot be edited inline yet.`}
            actions={
              <WorkspaceActionButton onClick={props.onOpenExplorer}>
                Show file explorer
              </WorkspaceActionButton>
            }
          />
        )}
      </div>
    </div>
  );
}

function workspaceRootLabel(cwd: string): string {
  const trimmedCwd = cwd.replace(/[\\/]+$/, "");
  return basenameOfPath(trimmedCwd) || trimmedCwd || "workspace";
}

function filePathBreadcrumbSegments(cwd: string, filePath: string): string[] {
  const rootLabel = workspaceRootLabel(cwd);
  const pathSegments = filePath
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .split("/")
    .filter(Boolean);
  const visiblePathSegments =
    pathSegments[0]?.toLowerCase() === rootLabel.toLowerCase()
      ? pathSegments.slice(1)
      : pathSegments;
  return [rootLabel, ...visiblePathSegments];
}

function WorkspaceFileBreadcrumb(props: {
  cwd: string;
  filePath: string;
  resolvedTheme: "light" | "dark";
  rightSlot?: ReactNode;
}) {
  const segments = filePathBreadcrumbSegments(props.cwd, props.filePath);
  const title = segments.join("/");
  const fileSegmentIndex = segments.length - 1;

  return (
    <div className="border-b border-border/70 bg-muted/15 px-3 py-1.5 sm:px-5">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <nav
          aria-label="Current file"
          className="flex min-w-0 items-center overflow-hidden font-mono text-[11px] leading-5"
          title={title}
        >
          {segments.map((segment, index) => {
            const isRoot = index === 0;
            const isFile = index === fileSegmentIndex;

            return (
              <div key={`${index}:${segment}`} className="flex min-w-0 items-center">
                {index > 0 ? (
                  <ChevronRightIcon className="mx-1 size-3 shrink-0 text-muted-foreground/45" />
                ) : null}
                <span
                  className={cn(
                    "min-w-0 truncate",
                    isRoot ? "shrink-0 text-muted-foreground" : "text-muted-foreground/85",
                    isFile ? "font-medium text-foreground" : "",
                  )}
                  aria-current={isFile ? "page" : undefined}
                >
                  {isFile ? (
                    <span className="inline-flex min-w-0 items-center gap-1.5 align-bottom">
                      <VscodeEntryIcon
                        pathValue={props.filePath}
                        kind="file"
                        theme={props.resolvedTheme}
                        className="size-3.5 shrink-0"
                      />
                      <span className="min-w-0 truncate">{segment}</span>
                    </span>
                  ) : (
                    segment
                  )}
                </span>
              </div>
            );
          })}
        </nav>
        {props.rightSlot ? <div className="shrink-0">{props.rightSlot}</div> : null}
      </div>
    </div>
  );
}

function WorkspaceNotice(props: {
  icon: ReactNode;
  title: string;
  description: string;
  destructive?: boolean;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center px-6 py-8">
      <div
        className={cn(
          "flex w-full max-w-2xl flex-col items-center gap-4 rounded-2xl border px-6 py-8 text-center shadow-sm",
          props.destructive
            ? "border-destructive/30 bg-destructive/5"
            : "border-border/70 bg-card/40",
        )}
      >
        <div className="flex size-12 items-center justify-center rounded-xl border border-border/70 bg-background/75">
          {props.icon}
        </div>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{props.title}</p>
          <p className="max-w-xl text-sm text-muted-foreground">{props.description}</p>
        </div>
        {props.actions ? (
          <div className="flex flex-wrap items-center justify-center gap-2">{props.actions}</div>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceActionButton(props: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-background/70 px-3 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-background"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
