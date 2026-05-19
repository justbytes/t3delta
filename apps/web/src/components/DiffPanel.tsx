import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3delta/client-runtime";
import type { EnvironmentId, TurnId } from "@t3delta/contracts";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Columns2Icon,
  GitBranchIcon,
  Rows3Icon,
  TextWrapIcon,
} from "lucide-react";
import {
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInPreferredEditor } from "../editorPreferences";
import { gitWorkingTreeDiffQueryOptions } from "~/lib/gitReactQuery";
import { useGitStatus } from "~/lib/gitStatusState";
import { checkpointDiffQueryOptions } from "~/lib/providerReactQuery";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../localApi";
import { resolvePathLinkTarget } from "../terminal-links";
import { parseDiffRouteSearch, stripDiffSearchParams } from "../diffRouteSearch";
import { useTheme } from "../hooks/useTheme";
import { buildPatchCacheKey } from "../lib/diffRendering";
import { resolveDiffThemeName } from "../lib/diffRendering";
import { useTurnDiffSummaries } from "../hooks/useTurnDiffSummaries";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteRef,
} from "../threadRoutes";
import { useSettings } from "../hooks/useSettings";
import type { DraftId } from "../composerDraftStore";
import { formatShortTimestamp } from "../timestampFormat";
import { basenameOfPath } from "../vscode-icons";
import {
  WorkspaceSidecarLoadingState,
  WorkspaceSidecarShell,
  type WorkspaceSidecarLayoutMode,
  type WorkspaceSidecarMode,
} from "./WorkspaceSidecarShell";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { ToggleGroup, Toggle } from "./ui/toggle-group";
import GitActionsControl from "./GitActionsControl";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";

function resolveDiffStyle(mode: DiffRenderMode): "unified" | "split" {
  return mode === "split" ? "split" : "unified";
}

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;

  --diffs-bg-context-override: color-mix(in srgb, var(--background) 97%, var(--foreground));
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground));
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground));
  --diffs-bg-buffer-override: color-mix(in srgb, var(--background) 90%, var(--foreground));

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 92%, var(--success));
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 88%, var(--success));
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 85%, var(--success));
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 80%, var(--success));

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 92%, var(--destructive));
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 88%, var(--destructive));
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 85%, var(--destructive));
  --diffs-bg-deletion-emphasis-override: color-mix(
    in srgb,
    var(--background) 80%,
    var(--destructive)
  );

  background-color: var(--diffs-bg) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-block-color: var(--border) !important;
  color: var(--foreground) !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--card) 94%, var(--foreground)) !important;
  border-bottom: 1px solid var(--border) !important;
}

[data-title] {
  cursor: pointer;
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: color-mix(in srgb, var(--foreground) 84%, var(--primary)) !important;
  text-decoration-color: currentColor;
}
`;

type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
      notice?: string;
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

const PATCH_TRUNCATED_MARKER = "[truncated]";

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;
  const isTruncated = normalizedPatch.endsWith(PATCH_TRUNCATED_MARKER);
  const parserPatch = isTruncated
    ? normalizedPatch.slice(0, -PATCH_TRUNCATED_MARKER.length).trimEnd()
    : normalizedPatch;
  if (parserPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(parserPatch, buildPatchCacheKey(parserPatch, cacheScope));
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return {
        kind: "files",
        files,
        ...(isTruncated
          ? { notice: "Patch output was truncated. Showing renderable portion." }
          : {}),
      };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: isTruncated
        ? "Patch output was truncated. Showing raw patch."
        : "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: isTruncated
        ? "Patch output was truncated before it could be rendered. Showing raw patch."
        : "Failed to parse patch. Showing raw patch.",
    };
  }
}

function getRawDiffLineClassName(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-emerald-500/10 text-emerald-300";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-rose-500/10 text-rose-300";
  }
  if (line.startsWith("@@")) {
    return "bg-sky-500/10 text-sky-300";
  }
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("+++") ||
    line.startsWith("---")
  ) {
    return "text-foreground/85";
  }
  return "text-muted-foreground/90";
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

interface DiffPanelProps {
  mode?: WorkspaceSidecarLayoutMode;
  openSidecars?: ReadonlyArray<WorkspaceSidecarMode>;
  availableSidecars?: ReadonlyArray<WorkspaceSidecarMode>;
  onSelectSidecar?: (sidecar: WorkspaceSidecarMode) => void;
  onAddSidecar?: (sidecar: WorkspaceSidecarMode) => void;
  onCloseSidecarTab?: (sidecar: WorkspaceSidecarMode) => void;
  draftContext?: {
    environmentId: EnvironmentId;
    cwd: string | null;
    draftId: DraftId;
  };
}

export { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

export default function DiffPanel({
  mode = "inline",
  openSidecars,
  availableSidecars,
  onSelectSidecar,
  onAddSidecar,
  onCloseSidecarTab,
  draftContext,
}: DiffPanelProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("stacked");
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const turnStripRef = useRef<HTMLDivElement>(null);
  const previousDiffOpenRef = useRef(false);
  const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false);
  const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeDraftId = useParams({
    strict: false,
    select: (params) => (typeof params.draftId === "string" ? (params.draftId as DraftId) : null),
  });
  const diffSearch = useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search) });
  const diffOpen = diffSearch.diff === "1";
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeThreadRef = activeThread
    ? scopeThreadRef(activeThread.environmentId, activeThread.id)
    : null;
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const activeEnvironmentId = activeThread?.environmentId ?? draftContext?.environmentId ?? null;
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? draftContext?.cwd;
  const gitStatusQuery = useGitStatus({
    environmentId: activeEnvironmentId,
    cwd: activeCwd ?? null,
  });
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  const selectedTurnId = diffSearch.diffTurnId ?? null;
  const diffTarget = draftContext
    ? "workingTree"
    : selectedTurnId !== null
      ? "turn"
      : diffSearch.diffTarget === "conversation"
        ? "conversation"
        : "workingTree";
  const selectedFilePath = diffSearch.diffFilePath ?? null;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      diffTarget === "conversation" &&
      !selectedTurn &&
      typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, diffTarget, selectedTurn],
  );
  const activeCheckpointRange =
    diffTarget === "workingTree"
      ? null
      : selectedTurn
        ? selectedCheckpointRange
        : conversationCheckpointRange;
  const conversationCacheScope = useMemo(() => {
    if (selectedTurn || diffTarget !== "conversation" || orderedTurnDiffSummaries.length === 0) {
      return null;
    }
    return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
  }, [diffTarget, orderedTurnDiffSummaries, selectedTurn]);
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled: isGitRepo && diffTarget !== "workingTree",
    }),
  );
  const workingTreeDiffQuery = useQuery(
    gitWorkingTreeDiffQueryOptions({
      environmentId: activeEnvironmentId,
      cwd: activeCwd ?? null,
      enabled: isGitRepo && diffTarget === "workingTree",
    }),
  );
  const selectedTurnCheckpointDiff = selectedTurn
    ? activeCheckpointDiffQuery.data?.diff
    : undefined;
  const conversationCheckpointDiff =
    selectedTurn || diffTarget !== "conversation"
      ? undefined
      : activeCheckpointDiffQuery.data?.diff;
  const workingTreeDiff =
    diffTarget === "workingTree" ? workingTreeDiffQuery.data?.diff : undefined;
  const isLoadingDiff =
    diffTarget === "workingTree"
      ? workingTreeDiffQuery.isLoading
      : activeCheckpointDiffQuery.isLoading;
  const diffError =
    diffTarget === "workingTree"
      ? workingTreeDiffQuery.error instanceof Error
        ? workingTreeDiffQuery.error.message
        : workingTreeDiffQuery.error
          ? "Failed to load working tree diff."
          : null
      : activeCheckpointDiffQuery.error instanceof Error
        ? activeCheckpointDiffQuery.error.message
        : activeCheckpointDiffQuery.error
          ? "Failed to load checkpoint diff."
          : null;
  const workingTreeFiles = gitStatusQuery.data?.workingTree.files ?? [];
  const workingTreeSummary = gitStatusQuery.data?.workingTree ?? {
    files: [],
    insertions: 0,
    deletions: 0,
  };
  const gitInsertions = workingTreeSummary.insertions;
  const gitDeletions = workingTreeSummary.deletions;
  const activeBranchLabel = gitStatusQuery.data?.branch ?? "Detached HEAD";

  const selectedPatch =
    diffTarget === "workingTree"
      ? workingTreeDiff
      : selectedTurn
        ? selectedTurnCheckpointDiff
        : conversationCheckpointDiff;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const shouldShowWorkingTreeEmptyHint =
    diffTarget === "workingTree" && workingTreeFiles.length > 0 && hasNoNetChanges;
  const renderablePatch = useMemo(
    () => getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`),
    [resolvedTheme, selectedPatch],
  );
  const iconTheme = resolvedTheme === "light" ? "light" : "dark";
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const workingTreeStatusByPath = useMemo(
    () => new Map(workingTreeFiles.map((file) => [file.path, file])),
    [workingTreeFiles],
  );
  const workingTreePreviewFiles = useMemo(
    () => (diffTarget === "workingTree" ? renderableFiles : []),
    [diffTarget, renderableFiles],
  );
  const workingTreeDisplayFileCount =
    workingTreePreviewFiles.length > 0 ? workingTreePreviewFiles.length : workingTreeFiles.length;

  useEffect(() => {
    if (diffOpen && !previousDiffOpenRef.current) {
      setDiffWordWrap(settings.diffWordWrap);
    }
    previousDiffOpenRef.current = diffOpen;
  }, [diffOpen, settings.diffWordWrap]);

  useEffect(() => {
    if (!selectedFilePath || !patchViewportRef.current) {
      return;
    }
    const target = Array.from(
      patchViewportRef.current.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
    ).find((element) => element.dataset.diffFilePath === selectedFilePath);
    target?.scrollIntoView({ block: "nearest" });
  }, [selectedFilePath, renderableFiles]);

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readLocalApi();
      if (!api) return;
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath;
      void openInPreferredEditor(api, targetPath).catch((error) => {
        console.warn("Failed to open diff file in editor.", error);
      });
    },
    [activeCwd],
  );

  const navigateDiffSearch = (
    updateSearch: (previous: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    if (activeThread) {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
        search: updateSearch,
      });
      return;
    }

    const draftIdForRoute = draftContext?.draftId ?? routeDraftId;
    if (!draftIdForRoute) return;
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(draftIdForRoute),
      search: updateSearch,
    });
  };

  const selectTurn = (turnId: TurnId) => {
    if (!activeThread) return;
    navigateDiffSearch((previous) => {
      const rest = stripDiffSearchParams(previous);
      return { ...rest, diff: "1", diffTurnId: turnId };
    });
  };
  const selectWorkingTree = () => {
    navigateDiffSearch((previous) => {
      const rest = stripDiffSearchParams(previous);
      return { ...rest, diff: "1" };
    });
  };
  const toggleWorkingTreeFile = (filePath: string) => {
    navigateDiffSearch((previous) => {
      const rest = stripDiffSearchParams(previous);
      if (selectedFilePath === filePath) {
        return { ...rest, diff: "1" };
      }
      return { ...rest, diff: "1", diffFilePath: filePath };
    });
  };
  const selectWholeConversation = () => {
    if (!activeThread) return;
    navigateDiffSearch((previous) => {
      const rest = stripDiffSearchParams(previous);
      return { ...rest, diff: "1", diffTarget: "conversation" };
    });
  };
  const updateTurnStripScrollState = useCallback(() => {
    const element = turnStripRef.current;
    if (!element) {
      setCanScrollTurnStripLeft(false);
      setCanScrollTurnStripRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollTurnStripLeft(element.scrollLeft > 4);
    setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4);
  }, []);
  const scrollTurnStripBy = useCallback((offset: number) => {
    const element = turnStripRef.current;
    if (!element) return;
    element.scrollBy({ left: offset, behavior: "smooth" });
  }, []);
  const onTurnStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current;
    if (!element) return;
    if (element.scrollWidth <= element.clientWidth + 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, []);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    const onScroll = () => updateTurnStripScrollState();

    element.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateTurnStripScrollState());
    resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frameId);
      element.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [updateTurnStripScrollState]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [orderedTurnDiffSummaries, selectedTurnId, updateTurnStripScrollState]);

  useEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const selectedChip = element.querySelector<HTMLElement>("[data-turn-chip-selected='true']");
    selectedChip?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedTurn?.turnId, selectedTurnId]);

  const headerRow = (
    <div className="flex min-w-0 items-center gap-2 px-2 py-2">
      <div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
        <button
          type="button"
          className={cn(
            "absolute left-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripLeft
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(-180)}
          disabled={!canScrollTurnStripLeft}
          aria-label="Scroll turn list left"
        >
          <ChevronLeftIcon className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "absolute right-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripRight
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(180)}
          disabled={!canScrollTurnStripRight}
          aria-label="Scroll turn list right"
        >
          <ChevronRightIcon className="size-3.5" />
        </button>
        <div
          ref={turnStripRef}
          className="turn-chip-strip flex gap-1 overflow-x-auto px-8 py-0.5"
          style={
            canScrollTurnStripLeft || canScrollTurnStripRight
              ? {
                  maskImage: `linear-gradient(to right, ${canScrollTurnStripLeft ? "transparent 24px, black 72px" : "black"}, ${canScrollTurnStripRight ? "black calc(100% - 72px), transparent calc(100% - 24px)" : "black"})`,
                }
              : undefined
          }
          onWheel={onTurnStripWheel}
        >
          <ToggleGroup
            className="shrink-0"
            variant="outline"
            size="xs"
            value={[diffRenderMode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "stacked" || next === "split") {
                setDiffRenderMode(next);
              }
            }}
          >
            <Toggle aria-label="Unified diff view" title="Unified diff view" value="stacked">
              <Rows3Icon className="size-3" />
            </Toggle>
            <Toggle
              aria-label="Side-by-side diff view"
              title="Side-by-side diff view"
              value="split"
            >
              <Columns2Icon className="size-3" />
            </Toggle>
          </ToggleGroup>
          <Toggle
            className="shrink-0"
            aria-label={diffWordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
            title={diffWordWrap ? "Disable line wrapping" : "Enable line wrapping"}
            variant="outline"
            size="xs"
            pressed={diffWordWrap}
            onPressedChange={(pressed) => {
              setDiffWordWrap(Boolean(pressed));
            }}
          >
            <TextWrapIcon className="size-3" />
          </Toggle>
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={selectWorkingTree}
            data-turn-chip-selected={diffTarget === "workingTree"}
          >
            <div
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-left transition-colors",
                diffTarget === "workingTree"
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="flex items-center gap-2 text-[10px] leading-tight font-medium">
                <GitBranchIcon className="size-3.5 shrink-0 opacity-75" />
                <span>{activeBranchLabel}</span>
                <span className="opacity-70">
                  {workingTreeDisplayFileCount} file
                  {workingTreeDisplayFileCount === 1 ? "" : "s"} changed
                </span>
              </div>
            </div>
          </button>
          <button
            type="button"
            className="shrink-0 rounded-md"
            onClick={selectWholeConversation}
            data-turn-chip-selected={diffTarget === "conversation" && selectedTurnId === null}
          >
            <div
              className={cn(
                "rounded-md border px-2 py-1 text-left transition-colors",
                diffTarget === "conversation" && selectedTurnId === null
                  ? "border-border bg-accent text-accent-foreground"
                  : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
              )}
            >
              <div className="text-[10px] leading-tight font-medium">All turns</div>
            </div>
          </button>
          {orderedTurnDiffSummaries.map((summary) => (
            <button
              key={summary.turnId}
              type="button"
              className="shrink-0 rounded-md"
              onClick={() => selectTurn(summary.turnId)}
              title={summary.turnId}
              data-turn-chip-selected={summary.turnId === selectedTurn?.turnId}
            >
              <div
                className={cn(
                  "rounded-md border px-2 py-1 text-left transition-colors",
                  summary.turnId === selectedTurn?.turnId
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
                )}
              >
                <div className="flex items-center gap-1">
                  <span className="text-[10px] leading-tight font-medium">
                    Turn{" "}
                    {summary.checkpointTurnCount ??
                      inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                      "?"}
                  </span>
                  <span className="text-[9px] leading-tight opacity-70">
                    {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {isGitRepo ? (
        <div className="flex shrink-0 items-center gap-2">
          {activeThreadRef ? (
            <GitActionsControl gitCwd={activeCwd ?? null} activeThreadRef={activeThreadRef} />
          ) : null}
          {gitInsertions > 0 || gitDeletions > 0 ? (
            <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium">
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-400">
                +{gitInsertions.toLocaleString()}
              </span>
              <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-400">
                -{gitDeletions.toLocaleString()}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <WorkspaceSidecarShell
      mode={mode}
      sidecar="diff"
      header={headerRow}
      {...(openSidecars ? { openSidecars } : {})}
      {...(availableSidecars ? { availableSidecars } : {})}
      {...(onSelectSidecar ? { onSelectSidecar } : {})}
      {...(onAddSidecar ? { onAddSidecar } : {})}
      {...(onCloseSidecarTab ? { onCloseSidecarTab } : {})}
    >
      {!activeThread && !draftContext ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : diffTarget === "conversation" && orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet. Use the branch summary to inspect the active working tree.
        </div>
      ) : diffTarget === "workingTree" && workingTreePreviewFiles.length > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="space-y-1.5 px-3 py-3">
            {selectedFilePath ? (
              <button
                type="button"
                className="mb-1 inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                onClick={selectWorkingTree}
              >
                <ChevronLeftIcon className="size-3" />
                Show all files
              </button>
            ) : null}
            {workingTreePreviewFiles.map((fileDiff) => {
              const filePath = resolveFileDiffPath(fileDiff);
              const themedFileKey = `${buildFileDiffRenderKey(fileDiff)}:${resolvedTheme}:${diffRenderMode}`;
              const fileSummary = workingTreeStatusByPath.get(filePath);
              const isExpanded = selectedFilePath === filePath;

              return (
                <div
                  key={themedFileKey}
                  data-diff-file-path={filePath}
                  className="overflow-hidden rounded-lg border border-border/70 bg-background/60"
                >
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-[10px] transition-colors",
                      isExpanded
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-background/80 text-muted-foreground/85 hover:text-foreground/90",
                    )}
                    onClick={() => toggleWorkingTreeFile(filePath)}
                    title={filePath}
                  >
                    <VscodeEntryIcon
                      pathValue={filePath}
                      kind="file"
                      theme={iconTheme}
                      className="size-3.5"
                    />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate font-medium">{basenameOfPath(filePath)}</div>
                      <div className="truncate opacity-65">{filePath}</div>
                    </div>
                    {fileSummary ? (
                      <span className="shrink-0 rounded-full border border-border/60 bg-background/60 px-1.5 py-0.5 opacity-80">
                        +{fileSummary.insertions} -{fileSummary.deletions}
                      </span>
                    ) : null}
                  </button>
                  {isExpanded ? (
                    <div className="border-t border-border/70 bg-card/35 p-2">
                      <FileDiff
                        fileDiff={fileDiff}
                        options={{
                          diffStyle: resolveDiffStyle(diffRenderMode),
                          lineDiffType: "none",
                          overflow: diffWordWrap ? "wrap" : "scroll",
                          theme: resolveDiffThemeName(resolvedTheme),
                          themeType: resolvedTheme as DiffThemeType,
                          unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <div
            ref={patchViewportRef}
            className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {diffError && !renderablePatch && (
              <div className="px-3">
                <p className="mb-2 text-[11px] text-red-500/80">{diffError}</p>
              </div>
            )}
            {!renderablePatch ? (
              isLoadingDiff ? (
                <WorkspaceSidecarLoadingState
                  label={
                    diffTarget === "workingTree"
                      ? "Loading current branch diff..."
                      : "Loading checkpoint diff..."
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                  <p>
                    {diffTarget === "workingTree" && workingTreeFiles.length === 0
                      ? "Working tree is clean."
                      : shouldShowWorkingTreeEmptyHint
                        ? "Changed files are present, but Git returned no renderable patch text."
                        : hasNoNetChanges
                          ? "No net changes in this selection."
                          : "No patch available for this selection."}
                  </p>
                </div>
              )
            ) : renderablePatch.kind === "files" ? (
              <Virtualizer
                className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
                config={{
                  overscrollSize: 600,
                  intersectionObserverMargin: 1200,
                }}
              >
                {renderablePatch.notice ? (
                  <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                    {renderablePatch.notice}
                  </div>
                ) : null}
                {renderableFiles.map((fileDiff) => {
                  const filePath = resolveFileDiffPath(fileDiff);
                  const fileKey = buildFileDiffRenderKey(fileDiff);
                  const themedFileKey = `${fileKey}:${resolvedTheme}:${diffRenderMode}`;
                  return (
                    <div
                      key={themedFileKey}
                      data-diff-file-path={filePath}
                      className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
                      onClickCapture={(event) => {
                        const nativeEvent = event.nativeEvent as MouseEvent;
                        const composedPath = nativeEvent.composedPath?.() ?? [];
                        const clickedHeader = composedPath.some((node) => {
                          if (!(node instanceof Element)) return false;
                          return node.hasAttribute("data-title");
                        });
                        if (!clickedHeader) return;
                        openDiffFileInEditor(filePath);
                      }}
                    >
                      <FileDiff
                        fileDiff={fileDiff}
                        options={{
                          diffStyle: resolveDiffStyle(diffRenderMode),
                          lineDiffType: "none",
                          overflow: diffWordWrap ? "wrap" : "scroll",
                          theme: resolveDiffThemeName(resolvedTheme),
                          themeType: resolvedTheme as DiffThemeType,
                          unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                        }}
                      />
                    </div>
                  );
                })}
              </Virtualizer>
            ) : (
              <div className="h-full overflow-auto p-2">
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground/75">{renderablePatch.reason}</p>
                  <div
                    className={cn(
                      "max-h-[72vh] overflow-auto rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed",
                      diffWordWrap ? "whitespace-pre-wrap wrap-break-word" : "whitespace-pre",
                    )}
                  >
                    {renderablePatch.text.split(/\r?\n/g).map((line, index) => (
                      <div
                        key={`${index}:${line}`}
                        className={cn("-mx-3 px-3", getRawDiffLineClassName(line))}
                      >
                        {line || " "}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </WorkspaceSidecarShell>
  );
}
