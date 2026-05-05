import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { RIGHT_PANEL_SHEET_CLASS_NAME } from "../rightPanelLayout";
import { Sheet, SheetPopup } from "./ui/sheet";

const RIGHT_PANEL_SHEET_WIDTH_STORAGE_KEY = "chat_right_panel_sheet_width";
const RIGHT_PANEL_SHEET_MIN_WIDTH = 20 * 16;
const RIGHT_PANEL_SHEET_DEFAULT_WIDTH = 32 * 16;
const RIGHT_PANEL_SHEET_MAX_WIDTH = 40 * 16;
const RIGHT_PANEL_SHEET_VIEWPORT_GUTTER = 3 * 16;

function resolveMaxRightPanelSheetWidthPx() {
  if (typeof window === "undefined") {
    return RIGHT_PANEL_SHEET_MAX_WIDTH;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  return Math.max(
    RIGHT_PANEL_SHEET_MIN_WIDTH,
    Math.min(RIGHT_PANEL_SHEET_MAX_WIDTH, viewportWidth - RIGHT_PANEL_SHEET_VIEWPORT_GUTTER),
  );
}

function clampRightPanelSheetWidth(width: number) {
  return Math.max(RIGHT_PANEL_SHEET_MIN_WIDTH, Math.min(resolveMaxRightPanelSheetWidthPx(), width));
}

function resolveInitialRightPanelSheetWidthPx() {
  if (typeof window === "undefined") {
    return RIGHT_PANEL_SHEET_DEFAULT_WIDTH;
  }

  const storedWidth = Number.parseFloat(
    window.localStorage.getItem(RIGHT_PANEL_SHEET_WIDTH_STORAGE_KEY) ?? "",
  );
  if (Number.isFinite(storedWidth)) {
    return clampRightPanelSheetWidth(storedWidth);
  }

  return clampRightPanelSheetWidth(RIGHT_PANEL_SHEET_DEFAULT_WIDTH);
}

export function RightPanelSheet(props: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(resolveInitialRightPanelSheetWidthPx);
  const resizeStateRef = useRef<{
    startWidth: number;
    startX: number;
  } | null>(null);

  const updateWidth = useCallback((nextWidth: number) => {
    const clampedWidth = clampRightPanelSheetWidth(nextWidth);
    setWidth(clampedWidth);
    window.localStorage.setItem(RIGHT_PANEL_SHEET_WIDTH_STORAGE_KEY, String(clampedWidth));
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setWidth((currentWidth) => {
        const clampedWidth = clampRightPanelSheetWidth(currentWidth);
        if (clampedWidth !== currentWidth) {
          window.localStorage.setItem(RIGHT_PANEL_SHEET_WIDTH_STORAGE_KEY, String(clampedWidth));
        }
        return clampedWidth;
      });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const handleResizePointerMove = useCallback(
    (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const delta = resizeState.startX - event.clientX;
      updateWidth(resizeState.startWidth + delta);
    },
    [updateWidth],
  );

  const stopResize = useCallback(() => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) {
      return;
    }

    resizeStateRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    window.removeEventListener("pointermove", handleResizePointerMove);
    window.removeEventListener("pointerup", stopResize);
    window.removeEventListener("pointercancel", stopResize);
  }, [handleResizePointerMove]);

  useEffect(() => stopResize, [stopResize]);

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      resizeStateRef.current = {
        startWidth: width,
        startX: event.clientX,
      };
      document.body.style.setProperty("cursor", "col-resize");
      document.body.style.setProperty("user-select", "none");
      window.addEventListener("pointermove", handleResizePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [handleResizePointerMove, stopResize, width],
  );

  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton
        keepMounted
        className={RIGHT_PANEL_SHEET_CLASS_NAME}
        style={
          {
            width: `${width}px`,
            maxWidth: `${resolveMaxRightPanelSheetWidthPx()}px`,
            minWidth: `${RIGHT_PANEL_SHEET_MIN_WIDTH}px`,
          } satisfies CSSProperties
        }
      >
        <button
          aria-label="Resize panel"
          className="absolute inset-y-0 left-0 z-10 w-3 cursor-col-resize border-l border-transparent bg-transparent transition-colors hover:border-border/70 focus-visible:border-border focus-visible:outline-hidden"
          onPointerDown={handleResizePointerDown}
          type="button"
        />
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
