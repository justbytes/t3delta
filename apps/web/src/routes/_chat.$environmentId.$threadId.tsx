import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  resolveDefaultInlineSidecarWidthPx,
  resolveInitialInlineSidecarWidthPx,
  resolveMaxInlineSidecarWidthPx,
  WorkspaceInlineSidecar,
  WORKSPACE_SIDECAR_DESKTOP_SHEET_MEDIA_QUERY,
  WORKSPACE_SIDECAR_INLINE_EXPLORER_AUTO_CLOSE_WIDTH,
  WORKSPACE_SIDECAR_INLINE_EXPLORER_MIN_WIDTH,
  WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR,
  WORKSPACE_SIDECAR_INLINE_MIN_WIDTH,
  WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY,
} from "../components/WorkspaceInlineSidecar";
import {
  WorkspaceSidecarHeaderSkeleton,
  WorkspaceSidecarLoadingState,
  WorkspaceSidecarShell,
  type WorkspaceSidecarLayoutMode,
  type WorkspaceSidecarMode,
} from "../components/WorkspaceSidecarShell";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { isElectron } from "../env";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { SidebarInset } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const ProjectExplorerPanel = lazy(() => import("../components/ProjectExplorerPanel"));
const EMPTY_WORKSPACE_SIDECARS: ReadonlyArray<WorkspaceSidecarMode> = [];

const SidecarLoadingFallback = (props: {
  mode: WorkspaceSidecarLayoutMode;
  sidecar: WorkspaceSidecarMode;
  openSidecars: ReadonlyArray<WorkspaceSidecarMode>;
  availableSidecars: ReadonlyArray<WorkspaceSidecarMode>;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
  onAddSidecar: (sidecar: WorkspaceSidecarMode) => void;
  onCloseSidecarTab: (sidecar: WorkspaceSidecarMode) => void;
  label: string;
}) => {
  return (
    <WorkspaceSidecarShell
      mode={props.mode}
      sidecar={props.sidecar}
      openSidecars={props.openSidecars}
      availableSidecars={props.availableSidecars}
      onSelectSidecar={props.onSelectSidecar}
      onAddSidecar={props.onAddSidecar}
      onCloseSidecarTab={props.onCloseSidecarTab}
      header={<WorkspaceSidecarHeaderSkeleton />}
    >
      <WorkspaceSidecarLoadingState label={props.label} />
    </WorkspaceSidecarShell>
  );
};

const LazyDiffPanel = (props: {
  mode: WorkspaceSidecarLayoutMode;
  openSidecars: ReadonlyArray<WorkspaceSidecarMode>;
  availableSidecars: ReadonlyArray<WorkspaceSidecarMode>;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
  onAddSidecar: (sidecar: WorkspaceSidecarMode) => void;
  onCloseSidecarTab: (sidecar: WorkspaceSidecarMode) => void;
}) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense
        fallback={
          <SidecarLoadingFallback
            mode={props.mode}
            sidecar="diff"
            openSidecars={props.openSidecars}
            availableSidecars={props.availableSidecars}
            onSelectSidecar={props.onSelectSidecar}
            onAddSidecar={props.onAddSidecar}
            onCloseSidecarTab={props.onCloseSidecarTab}
            label="Loading diff viewer..."
          />
        }
      >
        <DiffPanel
          mode={props.mode}
          openSidecars={props.openSidecars}
          availableSidecars={props.availableSidecars}
          onSelectSidecar={props.onSelectSidecar}
          onAddSidecar={props.onAddSidecar}
          onCloseSidecarTab={props.onCloseSidecarTab}
        />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const LazyProjectExplorerPanel = (props: {
  mode: WorkspaceSidecarLayoutMode;
  openSidecars: ReadonlyArray<WorkspaceSidecarMode>;
  availableSidecars: ReadonlyArray<WorkspaceSidecarMode>;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
  onAddSidecar: (sidecar: WorkspaceSidecarMode) => void;
  onCloseSidecarTab: (sidecar: WorkspaceSidecarMode) => void;
}) => {
  return (
    <Suspense
      fallback={
        <SidecarLoadingFallback
          mode={props.mode}
          sidecar="explorer"
          openSidecars={props.openSidecars}
          availableSidecars={props.availableSidecars}
          onSelectSidecar={props.onSelectSidecar}
          onAddSidecar={props.onAddSidecar}
          onCloseSidecarTab={props.onCloseSidecarTab}
          label="Loading file explorer..."
        />
      }
    >
      <ProjectExplorerPanel
        mode={props.mode}
        openSidecars={props.openSidecars}
        availableSidecars={props.availableSidecars}
        onSelectSidecar={props.onSelectSidecar}
        onAddSidecar={props.onAddSidecar}
        onCloseSidecarTab={props.onCloseSidecarTab}
      />
    </Suspense>
  );
};

const LazyRightPanel = (props: {
  mode: WorkspaceSidecarLayoutMode;
  sidecar: WorkspaceSidecarMode;
  openSidecars: ReadonlyArray<WorkspaceSidecarMode>;
  availableSidecars: ReadonlyArray<WorkspaceSidecarMode>;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
  onAddSidecar: (sidecar: WorkspaceSidecarMode) => void;
  onCloseSidecarTab: (sidecar: WorkspaceSidecarMode) => void;
}) => {
  return props.sidecar === "explorer" ? (
    <LazyProjectExplorerPanel
      mode={props.mode}
      openSidecars={props.openSidecars}
      availableSidecars={props.availableSidecars}
      onSelectSidecar={props.onSelectSidecar}
      onAddSidecar={props.onAddSidecar}
      onCloseSidecarTab={props.onCloseSidecarTab}
    />
  ) : (
    <LazyDiffPanel
      mode={props.mode}
      openSidecars={props.openSidecars}
      availableSidecars={props.availableSidecars}
      onSelectSidecar={props.onSelectSidecar}
      onAddSidecar={props.onAddSidecar}
      onCloseSidecarTab={props.onCloseSidecarTab}
    />
  );
};

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const sidecarOpen = search.diff === "1";
  const sidecarMode: WorkspaceSidecarMode = search.sidecar === "explorer" ? "explorer" : "diff";
  const workspaceSidecarSheetMediaQuery = isElectron
    ? WORKSPACE_SIDECAR_DESKTOP_SHEET_MEDIA_QUERY
    : RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY;
  const shouldUseSidecarSheet = useMediaQuery(workspaceSidecarSheetMediaQuery);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const [inlineSidecarWidth, setInlineSidecarWidth] = useState(() =>
    resolveInitialInlineSidecarWidthPx(),
  );
  const [sidecarMountState, setSidecarMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedSidecar: sidecarOpen,
  }));
  const availableSidecars = useMemo<ReadonlyArray<WorkspaceSidecarMode>>(
    () => ["diff", "explorer"],
    [],
  );
  const [sidecarTabsState, setSidecarTabsState] = useState<{
    threadKey: string | null;
    openSidecars: WorkspaceSidecarMode[];
  }>(() => ({
    threadKey: currentThreadKey,
    openSidecars: sidecarOpen ? [sidecarMode] : [],
  }));
  const openSidecars =
    sidecarTabsState.threadKey === currentThreadKey
      ? sidecarTabsState.openSidecars
      : EMPTY_WORKSPACE_SIDECARS;
  const hasOpenedSidecar =
    sidecarMountState.threadKey === currentThreadKey
      ? sidecarMountState.hasOpenedSidecar
      : sidecarOpen;
  const updateOpenSidecars = useCallback(
    (updater: (previous: WorkspaceSidecarMode[]) => WorkspaceSidecarMode[]) => {
      setSidecarTabsState((previous) => {
        const currentTabs = previous.threadKey === currentThreadKey ? previous.openSidecars : [];
        return {
          threadKey: currentThreadKey,
          openSidecars: updater(currentTabs),
        };
      });
    },
    [currentThreadKey],
  );
  const markSidecarOpened = useCallback(() => {
    setSidecarMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedSidecar) {
        return previous;
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedSidecar: true,
      };
    });
  }, [currentThreadKey]);
  const closeSidecar = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return {
          ...rest,
          diff: undefined,
          ...(previous.sidecar ? { sidecar: previous.sidecar } : {}),
        };
      },
    });
  }, [navigate, threadRef]);
  const applyInlineSidecarInset = useCallback((width: number) => {
    const threadShell = document.querySelector<HTMLElement>("[data-chat-thread-shell='true']");
    threadShell?.style.setProperty(WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR, `${width}px`);
  }, []);
  const openDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markSidecarOpened();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", sidecar: "diff" };
      },
    });
  }, [markSidecarOpened, navigate, threadRef]);
  const openExplorer = useCallback(() => {
    if (!threadRef) {
      return;
    }
    if (inlineSidecarWidth <= WORKSPACE_SIDECAR_INLINE_EXPLORER_AUTO_CLOSE_WIDTH) {
      const fallbackWidth = resolveDefaultInlineSidecarWidthPx();
      setInlineSidecarWidth(fallbackWidth);
      applyInlineSidecarInset(fallbackWidth);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY,
          String(fallbackWidth),
        );
      }
    }
    markSidecarOpened();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", sidecar: "explorer" };
      },
    });
  }, [applyInlineSidecarInset, inlineSidecarWidth, markSidecarOpened, navigate, threadRef]);
  const selectSidecar = useCallback(
    (nextSidecar: WorkspaceSidecarMode) => {
      if (nextSidecar === "explorer") {
        openExplorer();
        return;
      }
      openDiff();
    },
    [openDiff, openExplorer],
  );
  useEffect(() => {
    if (!sidecarOpen) {
      return;
    }
    updateOpenSidecars((previous) =>
      previous.includes(sidecarMode) ? previous : [...previous, sidecarMode],
    );
  }, [sidecarMode, sidecarOpen, updateOpenSidecars]);
  const addSidecarTab = useCallback(
    (nextSidecar: WorkspaceSidecarMode) => {
      updateOpenSidecars((previous) =>
        previous.includes(nextSidecar) ? previous : [...previous, nextSidecar],
      );
      selectSidecar(nextSidecar);
    },
    [selectSidecar, updateOpenSidecars],
  );
  const closeSidecarTab = useCallback(
    (sidecarToClose: WorkspaceSidecarMode) => {
      const nextOpenSidecars = openSidecars.filter((sidecar) => sidecar !== sidecarToClose);
      updateOpenSidecars(() => nextOpenSidecars);
      if (sidecarToClose !== sidecarMode) {
        return;
      }
      const nextActiveSidecar = nextOpenSidecars[0];
      if (nextActiveSidecar) {
        selectSidecar(nextActiveSidecar);
        return;
      }
      closeSidecar();
    },
    [closeSidecar, openSidecars, selectSidecar, sidecarMode, updateOpenSidecars],
  );

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    const threadShell = document.querySelector<HTMLElement>("[data-chat-thread-shell='true']");
    if (!threadShell) {
      return;
    }

    if (sidecarOpen && !shouldUseSidecarSheet) {
      threadShell.style.setProperty(
        WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR,
        `${inlineSidecarWidth}px`,
      );
      return;
    }

    threadShell.style.setProperty(WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR, "0px");
  }, [inlineSidecarWidth, sidecarOpen, shouldUseSidecarSheet]);

  useEffect(() => {
    if (!sidecarOpen || shouldUseSidecarSheet) {
      return;
    }

    const clampInlineSidecarWidth = () => {
      const maxWidth = resolveMaxInlineSidecarWidthPx();
      setInlineSidecarWidth((currentWidth) => {
        const nextWidth = Math.min(
          maxWidth,
          Math.max(WORKSPACE_SIDECAR_INLINE_MIN_WIDTH, currentWidth),
        );
        if (nextWidth === currentWidth) {
          return currentWidth;
        }
        applyInlineSidecarInset(nextWidth);
        window.localStorage.setItem(WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY, String(nextWidth));
        return nextWidth;
      });
    };

    clampInlineSidecarWidth();
    window.addEventListener("resize", clampInlineSidecarWidth);
    return () => {
      window.removeEventListener("resize", clampInlineSidecarWidth);
    };
  }, [applyInlineSidecarInset, sidecarOpen, shouldUseSidecarSheet]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderSidecarContent = sidecarOpen || hasOpenedSidecar;
  const renderedOpenSidecars = openSidecars.includes(sidecarMode)
    ? openSidecars
    : [...openSidecars, sidecarMode];
  const inlineSidecarInset =
    sidecarOpen && !shouldUseSidecarSheet
      ? `var(${WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR}, 0px)`
      : undefined;

  if (!shouldUseSidecarSheet) {
    return (
      <div
        data-chat-thread-shell="true"
        className="relative flex h-dvh min-h-0 min-w-0 flex-1 overflow-hidden text-foreground"
      >
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none text-foreground">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={markSidecarOpened}
            reserveTitleBarControlInset={!sidecarOpen}
            routeKind="server"
            {...(inlineSidecarInset ? { workspaceSidecarInset: inlineSidecarInset } : {})}
          />
        </SidebarInset>
        <WorkspaceInlineSidecar
          minWidth={
            sidecarMode === "explorer"
              ? WORKSPACE_SIDECAR_INLINE_EXPLORER_MIN_WIDTH
              : WORKSPACE_SIDECAR_INLINE_MIN_WIDTH
          }
          sidecarOpen={sidecarOpen}
          onCloseSidecar={closeSidecar}
          onOpenSidecar={sidecarMode === "explorer" ? openExplorer : openDiff}
          renderSidecarContent={shouldRenderSidecarContent}
          width={inlineSidecarWidth}
          onWidthChange={applyInlineSidecarInset}
          onWidthChangeEnd={setInlineSidecarWidth}
          {...(sidecarMode === "explorer" ? { onCollapsedByResize: closeSidecar } : {})}
        >
          <LazyRightPanel
            mode="sidebar"
            sidecar={sidecarMode}
            openSidecars={renderedOpenSidecars}
            availableSidecars={availableSidecars}
            onSelectSidecar={selectSidecar}
            onAddSidecar={addSidecarTab}
            onCloseSidecarTab={closeSidecarTab}
          />
        </WorkspaceInlineSidecar>
      </div>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none text-foreground">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markSidecarOpened}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={sidecarOpen} onClose={closeSidecar}>
        {shouldRenderSidecarContent ? (
          <LazyRightPanel
            mode="sheet"
            sidecar={sidecarMode}
            openSidecars={renderedOpenSidecars}
            availableSidecars={availableSidecars}
            onSelectSidecar={selectSidecar}
            onAddSidecar={addSidecarTab}
            onCloseSidecarTab={closeSidecarTab}
          />
        ) : null}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff", "sidecar"])],
  },
  component: ChatThreadRouteView,
});
