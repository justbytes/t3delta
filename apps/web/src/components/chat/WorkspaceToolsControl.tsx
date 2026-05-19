import { PanelRightIcon } from "lucide-react";

import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface WorkspaceToolsControlProps {
  canShowDiff: boolean;
  canShowExplorer: boolean;
  currentMode: "diff" | "explorer";
  workspaceToolOpen: boolean;
  diffToggleShortcutLabel: string | null;
  onToggleCurrentTool: () => void;
}

export function WorkspaceToolsControl({
  canShowDiff,
  canShowExplorer,
  currentMode,
  workspaceToolOpen,
  diffToggleShortcutLabel,
  onToggleCurrentTool,
}: WorkspaceToolsControlProps) {
  const hasAvailableTool = canShowDiff || canShowExplorer;
  const tooltipLabel = !hasAvailableTool
    ? "Workspace sidebar is unavailable until this thread has an active project."
    : currentMode === "diff" && diffToggleShortcutLabel
      ? `Toggle workspace sidebar (${diffToggleShortcutLabel})`
      : "Toggle workspace sidebar";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0"
            pressed={workspaceToolOpen}
            onPressedChange={() => onToggleCurrentTool()}
            aria-label="Toggle workspace sidebar"
            variant="outline"
            size="xs"
            disabled={!hasAvailableTool && !workspaceToolOpen}
          >
            <PanelRightIcon className="size-3" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{tooltipLabel}</TooltipPopup>
    </Tooltip>
  );
}
