import { ChevronDownIcon, DiffIcon, FolderIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface WorkspaceToolsControlProps {
  canShowDiff: boolean;
  canShowExplorer: boolean;
  currentMode: "diff" | "explorer";
  workspaceToolOpen: boolean;
  diffToggleShortcutLabel: string | null;
  onToggleCurrentTool: () => void;
  onOpenDiff: () => void;
  onOpenExplorer: () => void;
}

export function WorkspaceToolsControl({
  canShowDiff,
  canShowExplorer,
  currentMode,
  workspaceToolOpen,
  diffToggleShortcutLabel,
  onToggleCurrentTool,
  onOpenDiff,
  onOpenExplorer,
}: WorkspaceToolsControlProps) {
  const currentIcon =
    currentMode === "explorer" ? (
      <FolderIcon className="size-3.5" />
    ) : (
      <DiffIcon className="size-3.5" />
    );
  const currentLabel = currentMode === "explorer" ? "Explorer" : "Git diff";
  const tooltipLabel =
    currentMode === "explorer"
      ? !canShowExplorer
        ? "File explorer is unavailable until this thread has an active project."
        : "Toggle file explorer"
      : !canShowDiff
        ? "Git diff is unavailable because this project is not a git repository."
        : diffToggleShortcutLabel
          ? `Toggle git diff (${diffToggleShortcutLabel})`
          : "Toggle git diff";

  return (
    <div className="flex shrink-0 items-center rounded-md border border-border/70 bg-background/80 shadow-sm backdrop-blur-sm">
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              className="h-7 shrink-0 gap-1.5 rounded-r-none border-0 bg-transparent px-2.5 text-[11px] font-medium text-foreground hover:bg-accent/40 data-[pressed]:bg-accent/75"
              pressed={workspaceToolOpen}
              onPressedChange={() => onToggleCurrentTool()}
              aria-label={
                currentMode === "explorer" ? "Toggle file explorer panel" : "Toggle git diff panel"
              }
              variant="outline"
              size="xs"
              disabled={
                currentMode === "explorer"
                  ? !canShowExplorer && !workspaceToolOpen
                  : !canShowDiff && !workspaceToolOpen
              }
            >
              {currentIcon}
              <span className="hidden sm:inline">{currentLabel}</span>
            </Toggle>
          }
        />
        <TooltipPopup side="bottom">{tooltipLabel}</TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label="Workspace tool options"
              size="icon-xs"
              variant="outline"
              className="-ml-px h-7 rounded-l-none border-0 bg-transparent px-1.5 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            />
          }
        >
          <ChevronDownIcon aria-hidden="true" className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="end">
          <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
            Workspace sidecar
          </div>
          <MenuItem
            disabled={!canShowDiff}
            onClick={() => {
              if (canShowDiff) {
                onOpenDiff();
              }
            }}
          >
            <DiffIcon />
            Show git diff
          </MenuItem>
          <MenuItem
            disabled={!canShowExplorer}
            onClick={() => {
              if (canShowExplorer) {
                onOpenExplorer();
              }
            }}
          >
            <FolderIcon />
            Show file explorer
          </MenuItem>
          {!canShowExplorer && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground/70">
              File explorer needs an active project.
            </p>
          )}
          {canShowExplorer && !canShowDiff && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground/70">
              Git diff is unavailable because this project is not a git repository.
            </p>
          )}
        </MenuPopup>
      </Menu>
    </div>
  );
}
