import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { useComposerDraftStore, DraftId } from "../composerDraftStore";
import { SidebarInset } from "../components/ui/sidebar";
import { createThreadSelectorAcrossEnvironments } from "../storeSelectors";
import { useStore } from "../store";
import { buildDraftThreadRouteParams, buildThreadRouteParams } from "../threadRoutes";
import {
  parseDiffRouteSearch,
  stripDiffSearchParams,
  type DiffRouteSearch,
} from "../diffRouteSearch";
import { isElectron } from "../env";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { WorkspaceSidecarLoadingState } from "../components/WorkspaceSidecarShell";
import {
  resolveDefaultInlineSidecarWidthPx,
  resolveInitialInlineSidecarWidthPx,
  resolveMaxInlineSidecarWidthPx,
  WorkspaceInlineSidecar,
  WORKSPACE_SIDECAR_DESKTOP_SHEET_MEDIA_QUERY,
  WORKSPACE_SIDECAR_INLINE_EXPLORER_AUTO_CLOSE_WIDTH,
  WORKSPACE_SIDECAR_INLINE_EXPLORER_MIN_WIDTH,
  WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR,
  WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY,
} from "../components/WorkspaceInlineSidecar";

const ProjectExplorerPanel = lazy(() => import("../components/ProjectExplorerPanel"));

function DraftChatThreadRouteView() {
  const navigate = useNavigate();
  const { draftId: rawDraftId } = Route.useParams();
  const search = Route.useSearch();
  const draftId = DraftId.make(rawDraftId);
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const serverThread = useStore(
    useMemo(
      () => createThreadSelectorAcrossEnvironments(draftSession?.threadId ?? null),
      [draftSession?.threadId],
    ),
  );
  const serverThreadStarted = threadHasStarted(serverThread);
  const canonicalThreadRef = useMemo(
    () =>
      draftSession?.promotedTo
        ? serverThreadStarted
          ? draftSession.promotedTo
          : null
        : serverThread
          ? {
              environmentId: serverThread.environmentId,
              threadId: serverThread.id,
            }
          : null,
    [draftSession?.promotedTo, serverThread, serverThreadStarted],
  );

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(canonicalThreadRef),
      replace: true,
    });
  }, [canonicalThreadRef, navigate]);

  useEffect(() => {
    if (draftSession || canonicalThreadRef) {
      return;
    }
    void navigate({ to: "/", replace: true });
  }, [canonicalThreadRef, draftSession, navigate]);

  const sidecarOpen = search.diff === "1" && search.sidecar === "explorer";
  const shouldUseSidecarSheet = useMediaQuery(
    isElectron
      ? WORKSPACE_SIDECAR_DESKTOP_SHEET_MEDIA_QUERY
      : RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY,
  );
  const [inlineSidecarWidth, setInlineSidecarWidth] = useState(() =>
    resolveInitialInlineSidecarWidthPx(),
  );
  const [hasOpenedSidecar, setHasOpenedSidecar] = useState(sidecarOpen);
  useEffect(() => {
    if (sidecarOpen) {
      setHasOpenedSidecar(true);
    }
  }, [sidecarOpen]);
  const closeExplorer = useCallback(() => {
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(draftId),
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return {
          ...rest,
          diff: undefined,
          ...(previous.sidecar ? { sidecar: previous.sidecar } : {}),
        };
      },
    });
  }, [draftId, navigate]);
  const applyInlineSidecarInset = useCallback((width: number) => {
    const threadShell = document.querySelector<HTMLElement>("[data-chat-thread-shell='true']");
    threadShell?.style.setProperty(WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR, `${width}px`);
  }, []);
  const openExplorer = useCallback(() => {
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
    setHasOpenedSidecar(true);
    void navigate({
      to: "/draft/$draftId",
      params: buildDraftThreadRouteParams(draftId),
      replace: true,
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1", sidecar: "explorer" };
      },
    });
  }, [applyInlineSidecarInset, draftId, inlineSidecarWidth, navigate]);

  useEffect(() => {
    if (!draftSession) {
      return;
    }

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
  }, [draftSession, inlineSidecarWidth, sidecarOpen, shouldUseSidecarSheet]);

  useEffect(() => {
    if (!draftSession || !sidecarOpen || shouldUseSidecarSheet) {
      return;
    }

    const clampInlineSidecarWidth = () => {
      const maxWidth = resolveMaxInlineSidecarWidthPx();
      setInlineSidecarWidth((currentWidth) => {
        const nextWidth = Math.min(
          maxWidth,
          Math.max(WORKSPACE_SIDECAR_INLINE_EXPLORER_MIN_WIDTH, currentWidth),
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
  }, [applyInlineSidecarInset, draftSession, sidecarOpen, shouldUseSidecarSheet]);

  if (canonicalThreadRef) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          environmentId={canonicalThreadRef.environmentId}
          threadId={canonicalThreadRef.threadId}
          routeKind="server"
        />
      </SidebarInset>
    );
  }

  if (!draftSession) {
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
        <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          <ChatView
            draftId={draftId}
            environmentId={draftSession.environmentId}
            threadId={draftSession.threadId}
            reserveTitleBarControlInset={!sidecarOpen}
            routeKind="draft"
            {...(inlineSidecarInset ? { workspaceSidecarInset: inlineSidecarInset } : {})}
          />
        </SidebarInset>
        <WorkspaceInlineSidecar
          minWidth={WORKSPACE_SIDECAR_INLINE_EXPLORER_MIN_WIDTH}
          sidecarOpen={sidecarOpen}
          onCloseSidecar={closeExplorer}
          onOpenSidecar={openExplorer}
          renderSidecarContent={shouldRenderSidecarContent}
          width={inlineSidecarWidth}
          onWidthChange={applyInlineSidecarInset}
          onWidthChangeEnd={setInlineSidecarWidth}
          onCollapsedByResize={closeExplorer}
        >
          <Suspense fallback={<WorkspaceSidecarLoadingState label="Loading file explorer..." />}>
            <ProjectExplorerPanel mode="sidebar" />
          </Suspense>
        </WorkspaceInlineSidecar>
      </div>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        <ChatView
          draftId={draftId}
          environmentId={draftSession.environmentId}
          threadId={draftSession.threadId}
          routeKind="draft"
        />
      </SidebarInset>
      <RightPanelSheet open={sidecarOpen} onClose={closeExplorer}>
        {sidecarOpen ? (
          <Suspense fallback={<WorkspaceSidecarLoadingState label="Loading file explorer..." />}>
            <ProjectExplorerPanel mode="sheet" />
          </Suspense>
        ) : null}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/draft/$draftId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff", "sidecar"])],
  },
  component: DraftChatThreadRouteView,
});
