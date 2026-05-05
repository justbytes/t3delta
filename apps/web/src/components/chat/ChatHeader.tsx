import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3delta/contracts";
import { scopeThreadRef } from "@t3delta/client-runtime";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { TerminalSquareIcon } from "lucide-react";
import { useGitStatus } from "~/lib/gitStatusState";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { WorkspaceToolsControl } from "./WorkspaceToolsControl";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  centerPaneMode: "agent" | "editor";
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  workspaceToolMode: "diff" | "explorer";
  gitCwd: string | null;
  workspaceToolOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onOpenCenterPaneAgent: () => void;
  onOpenCenterPaneEditor: () => void;
  onToggleTerminal: () => void;
  onToggleWorkspaceTool: () => void;
  onOpenDiff: () => void;
  onOpenExplorer: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  centerPaneMode,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  workspaceToolMode,
  gitCwd,
  workspaceToolOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onOpenCenterPaneAgent,
  onOpenCenterPaneEditor,
  onToggleTerminal,
  onToggleWorkspaceTool,
  onOpenDiff,
  onOpenExplorer,
}: ChatHeaderProps) {
  const gitStatusQuery = useGitStatus({
    environmentId: activeThreadEnvironmentId,
    cwd: gitCwd,
  });
  const gitInsertions = gitStatusQuery.data?.workingTree.insertions ?? 0;
  const gitDeletions = gitStatusQuery.data?.workingTree.deletions ?? 0;
  const hasWorkspacePath = openInCwd !== null;

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
            workspaceMode={centerPaneMode}
            onOpenAgent={onOpenCenterPaneAgent}
            onOpenEditor={onOpenCenterPaneEditor}
          />
        )}
        {activeProjectName && isGitRepo && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label="Toggle terminal drawer"
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <TerminalSquareIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!terminalAvailable
              ? "Terminal is unavailable until this thread has an active project."
              : terminalToggleShortcutLabel
                ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                : "Toggle terminal drawer"}
          </TooltipPopup>
        </Tooltip>
        <WorkspaceToolsControl
          canShowDiff={isGitRepo}
          canShowExplorer={hasWorkspacePath}
          currentMode={workspaceToolMode}
          workspaceToolOpen={workspaceToolOpen}
          diffToggleShortcutLabel={diffToggleShortcutLabel}
          onToggleCurrentTool={onToggleWorkspaceTool}
          onOpenDiff={onOpenDiff}
          onOpenExplorer={onOpenExplorer}
        />
        {isGitRepo && (gitInsertions > 0 || gitDeletions > 0) && (
          <div className="flex shrink-0 items-center gap-1 text-[11px] font-medium">
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-emerald-400">
              +{gitInsertions.toLocaleString()}
            </span>
            <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-2 py-1 text-rose-400">
              -{gitDeletions.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
