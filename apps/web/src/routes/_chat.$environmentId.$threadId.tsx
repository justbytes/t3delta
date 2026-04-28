import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
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
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const ProjectExplorerPanel = lazy(() => import("../components/ProjectExplorerPanel"));
const WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY = "chat_workspace_sidecar_width";
const WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR = "--chat-workspace-sidecar-inset";
const WORKSPACE_SIDECAR_INLINE_DEFAULT_MIN_WIDTH = 28 * 16;
const WORKSPACE_SIDECAR_INLINE_DEFAULT_MAX_WIDTH = 44 * 16;
const WORKSPACE_SIDECAR_INLINE_MIN_WIDTH = 26 * 16;
const WORKSPACE_SIDECAR_INLINE_EXPLORER_MIN_WIDTH = 0;
const WORKSPACE_SIDECAR_INLINE_EXPLORER_AUTO_CLOSE_WIDTH = 12 * 16;
const WORKSPACE_SIDECAR_INLINE_MIN_CONTENT_WIDTH = 32 * 16;
const WORKSPACE_SIDECAR_DESKTOP_SHEET_MEDIA_QUERY = "(max-width: 920px)";
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

function resolveDefaultInlineSidecarWidthPx() {
  if (typeof window === "undefined") {
    return WORKSPACE_SIDECAR_INLINE_DEFAULT_MAX_WIDTH;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  return Math.min(
    WORKSPACE_SIDECAR_INLINE_DEFAULT_MAX_WIDTH,
    Math.max(WORKSPACE_SIDECAR_INLINE_DEFAULT_MIN_WIDTH, Math.round(viewportWidth * 0.48)),
  );
}

function resolveInitialInlineSidecarWidthPx() {
  if (typeof window === "undefined") {
    return resolveDefaultInlineSidecarWidthPx();
  }

  const storedWidth = Number.parseFloat(
    window.localStorage.getItem(WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY) ?? "",
  );
  if (Number.isFinite(storedWidth)) {
    if (storedWidth <= WORKSPACE_SIDECAR_INLINE_EXPLORER_AUTO_CLOSE_WIDTH) {
      const fallbackWidth = resolveDefaultInlineSidecarWidthPx();
      window.localStorage.setItem(
        WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY,
        String(fallbackWidth),
      );
      return fallbackWidth;
    }
    return Math.max(WORKSPACE_SIDECAR_INLINE_MIN_WIDTH, storedWidth);
  }

  return resolveDefaultInlineSidecarWidthPx();
}

const SidecarLoadingFallback = (props: {
  mode: WorkspaceSidecarLayoutMode;
  sidecar: WorkspaceSidecarMode;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
  label: string;
}) => {
  return (
    <WorkspaceSidecarShell
      mode={props.mode}
      sidecar={props.sidecar}
      onSelectSidecar={props.onSelectSidecar}
      header={<WorkspaceSidecarHeaderSkeleton />}
    >
      <WorkspaceSidecarLoadingState label={props.label} />
    </WorkspaceSidecarShell>
  );
};

const LazyDiffPanel = (props: {
  mode: WorkspaceSidecarLayoutMode;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
}) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense
        fallback={
          <SidecarLoadingFallback
            mode={props.mode}
            sidecar="diff"
            onSelectSidecar={props.onSelectSidecar}
            label="Loading diff viewer..."
          />
        }
      >
        <DiffPanel mode={props.mode} onSelectSidecar={props.onSelectSidecar} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const LazyProjectExplorerPanel = (props: {
  mode: WorkspaceSidecarLayoutMode;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
}) => {
  return (
    <Suspense
      fallback={
        <SidecarLoadingFallback
          mode={props.mode}
          sidecar="explorer"
          onSelectSidecar={props.onSelectSidecar}
          label="Loading file explorer..."
        />
      }
    >
      <ProjectExplorerPanel mode={props.mode} onSelectSidecar={props.onSelectSidecar} />
    </Suspense>
  );
};

const LazyRightPanel = (props: {
  mode: WorkspaceSidecarLayoutMode;
  sidecar: WorkspaceSidecarMode;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
}) => {
  return props.sidecar === "explorer" ? (
    <LazyProjectExplorerPanel mode={props.mode} onSelectSidecar={props.onSelectSidecar} />
  ) : (
    <LazyDiffPanel mode={props.mode} onSelectSidecar={props.onSelectSidecar} />
  );
};

const RightPanelInlineSidebar = (props: {
  sidecarOpen: boolean;
  onCloseSidecar: () => void;
  onOpenSidecar: () => void;
  renderSidecarContent: boolean;
  sidecar: WorkspaceSidecarMode;
  width: number;
  onWidthChange: (width: number) => void;
  onWidthChangeEnd: (width: number) => void;
  onSelectSidecar: (sidecar: WorkspaceSidecarMode) => void;
}) => {
  const {
    sidecarOpen,
    onCloseSidecar,
    onOpenSidecar,
    renderSidecarContent,
    sidecar,
    width,
    onWidthChange,
    onWidthChangeEnd,
    onSelectSidecar,
  } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenSidecar();
        return;
      }
      onCloseSidecar();
    },
    [onCloseSidecar, onOpenSidecar],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const threadShell = document.querySelector<HTMLElement>("[data-chat-thread-shell='true']");
      if (threadShell) {
        const threadShellWidth = threadShell.getBoundingClientRect().width;
        if (threadShellWidth - nextWidth < WORKSPACE_SIDECAR_INLINE_MIN_CONTENT_WIDTH) {
          return false;
        }
      }

      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) {
        return true;
      }
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) {
        return true;
      }
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      const accepted = !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
      return accepted;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={sidecarOpen}
      onOpenChange={onOpenChange}
      className="pointer-events-none absolute inset-y-0 right-0 z-30 w-auto min-h-0 bg-transparent"
      style={{ "--sidebar-width": `${width}px` } as CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        containerPosition="absolute"
        className="pointer-events-auto top-[52px] h-[calc(100dvh-52px)] border-l border-border bg-card text-foreground"
        resizable={{
          minWidth:
            sidecar === "explorer"
              ? WORKSPACE_SIDECAR_INLINE_EXPLORER_MIN_WIDTH
              : WORKSPACE_SIDECAR_INLINE_MIN_WIDTH,
          onResize: onWidthChange,
          onResizeEnd: (finalWidth) => {
            onWidthChangeEnd(finalWidth);
            if (
              sidecar === "explorer" &&
              finalWidth <= WORKSPACE_SIDECAR_INLINE_EXPLORER_AUTO_CLOSE_WIDTH
            ) {
              onCloseSidecar();
            }
          },
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY,
        }}
      >
        {renderSidecarContent ? (
          <LazyRightPanel mode="sidebar" sidecar={sidecar} onSelectSidecar={onSelectSidecar} />
        ) : null}
        <SidebarRail allowCollapsedInteractions />
      </Sidebar>
    </SidebarProvider>
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
  const hasOpenedSidecar =
    sidecarMountState.threadKey === currentThreadKey
      ? sidecarMountState.hasOpenedSidecar
      : sidecarOpen;
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
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderSidecarContent = sidecarOpen || hasOpenedSidecar;
  const inlineSidecarInset =
    sidecarOpen && !shouldUseSidecarSheet
      ? `var(${WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR}, 0px)`
      : undefined;

  if (!shouldUseSidecarSheet) {
    return (
      <div
        data-chat-thread-shell="true"
        className="relative flex h-dvh min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground"
      >
        <SidebarInset className="h-dvh  min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={markSidecarOpened}
            reserveTitleBarControlInset={!sidecarOpen}
            routeKind="server"
            {...(inlineSidecarInset ? { workspaceSidecarInset: inlineSidecarInset } : {})}
          />
        </SidebarInset>
        <RightPanelInlineSidebar
          sidecarOpen={sidecarOpen}
          onCloseSidecar={closeSidecar}
          onOpenSidecar={sidecarMode === "explorer" ? openExplorer : openDiff}
          renderSidecarContent={shouldRenderSidecarContent}
          sidecar={sidecarMode}
          width={inlineSidecarWidth}
          onWidthChange={applyInlineSidecarInset}
          onWidthChangeEnd={setInlineSidecarWidth}
          onSelectSidecar={selectSidecar}
        />
      </div>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markSidecarOpened}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={sidecarOpen} onClose={closeSidecar}>
        {shouldRenderSidecarContent ? (
          <LazyRightPanel mode="sheet" sidecar={sidecarMode} onSelectSidecar={selectSidecar} />
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
