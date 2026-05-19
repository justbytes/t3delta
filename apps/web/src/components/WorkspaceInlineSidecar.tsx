import { useCallback, type CSSProperties, type ReactNode } from "react";

import { Sidebar, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";

export const WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY = "chat_workspace_sidecar_width";
export const WORKSPACE_SIDECAR_INLINE_INSET_CSS_VAR = "--chat-workspace-sidecar-inset";
export const WORKSPACE_SIDECAR_INLINE_DEFAULT_MIN_WIDTH = 28 * 16;
export const WORKSPACE_SIDECAR_INLINE_DEFAULT_MAX_WIDTH = 44 * 16;
export const WORKSPACE_SIDECAR_INLINE_MIN_WIDTH = 26 * 16;
export const WORKSPACE_SIDECAR_INLINE_EXPLORER_MIN_WIDTH = 18 * 16;
export const WORKSPACE_SIDECAR_INLINE_EXPLORER_AUTO_CLOSE_WIDTH = 12 * 16;
export const WORKSPACE_SIDECAR_INLINE_MIN_CONTENT_WIDTH = 32 * 16;
export const WORKSPACE_SIDECAR_DESKTOP_SHEET_MEDIA_QUERY = "(max-width: 920px)";

const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

export function resolveMaxInlineSidecarWidthPx() {
  if (typeof window === "undefined") {
    return WORKSPACE_SIDECAR_INLINE_DEFAULT_MAX_WIDTH;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  return Math.max(
    WORKSPACE_SIDECAR_INLINE_MIN_WIDTH,
    Math.min(
      WORKSPACE_SIDECAR_INLINE_DEFAULT_MAX_WIDTH,
      viewportWidth - WORKSPACE_SIDECAR_INLINE_MIN_CONTENT_WIDTH,
    ),
  );
}

export function resolveDefaultInlineSidecarWidthPx() {
  if (typeof window === "undefined") {
    return WORKSPACE_SIDECAR_INLINE_DEFAULT_MAX_WIDTH;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  return Math.min(
    resolveMaxInlineSidecarWidthPx(),
    Math.max(WORKSPACE_SIDECAR_INLINE_DEFAULT_MIN_WIDTH, Math.round(viewportWidth * 0.48)),
  );
}

export function resolveInitialInlineSidecarWidthPx() {
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
    return Math.min(
      resolveMaxInlineSidecarWidthPx(),
      Math.max(WORKSPACE_SIDECAR_INLINE_MIN_WIDTH, storedWidth),
    );
  }

  return resolveDefaultInlineSidecarWidthPx();
}

export function WorkspaceInlineSidecar(props: {
  children: ReactNode;
  sidecarOpen: boolean;
  onCloseSidecar: () => void;
  onOpenSidecar: () => void;
  renderSidecarContent: boolean;
  width: number;
  minWidth: number;
  onWidthChange: (width: number) => void;
  onWidthChangeEnd: (width: number) => void;
  onCollapsedByResize?: () => void;
}) {
  const {
    children,
    sidecarOpen,
    onCloseSidecar,
    onOpenSidecar,
    renderSidecarContent,
    width,
    minWidth,
    onWidthChange,
    onWidthChangeEnd,
    onCollapsedByResize,
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

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
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
        className="pointer-events-auto inset-y-0 h-dvh bg-[var(--panel-glass)] text-foreground shadow-lg/10 backdrop-blur-xl backdrop-saturate-150"
        resizable={{
          minWidth,
          maxWidth: resolveMaxInlineSidecarWidthPx(),
          onResize: onWidthChange,
          onResizeEnd: (finalWidth) => {
            onWidthChangeEnd(finalWidth);
            if (
              finalWidth <= WORKSPACE_SIDECAR_INLINE_EXPLORER_AUTO_CLOSE_WIDTH &&
              onCollapsedByResize
            ) {
              onCollapsedByResize();
            }
          },
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: WORKSPACE_SIDECAR_INLINE_WIDTH_STORAGE_KEY,
        }}
      >
        {renderSidecarContent ? children : null}
        <SidebarRail allowCollapsedInteractions />
      </Sidebar>
    </SidebarProvider>
  );
}
