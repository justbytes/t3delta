import { EditorId, type ResolvedKeybindingsConfig } from "@t3delta/contracts";
import { memo, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import { BotIcon, ChevronDownIcon, FileCode2Icon, FolderClosedIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuShortcut, MenuTrigger } from "../ui/menu";
import {
  AntigravityIcon,
  CursorIcon,
  Icon,
  IntelliJIdeaIcon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "../Icons";
import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { readLocalApi } from "~/localApi";

const resolveFileManagerLabel = (platform: string) =>
  isMacPlatform(platform) ? "Finder" : isWindowsPlatform(platform) ? "Explorer" : "Files";

const resolveExternalEditorOptions = (availableEditors: ReadonlyArray<EditorId>) => {
  const baseOptions: ReadonlyArray<{ label: string; Icon: Icon; value: EditorId }> = [
    { label: "Cursor", Icon: CursorIcon, value: "cursor" },
    { label: "Trae", Icon: TraeIcon, value: "trae" },
    { label: "Kiro", Icon: KiroIcon, value: "kiro" },
    { label: "VS Code", Icon: VisualStudioCode, value: "vscode" },
    { label: "VS Code Insiders", Icon: VisualStudioCodeInsiders, value: "vscode-insiders" },
    { label: "VSCodium", Icon: VSCodium, value: "vscodium" },
    { label: "Zed", Icon: Zed, value: "zed" },
    { label: "Antigravity", Icon: AntigravityIcon, value: "antigravity" },
    { label: "IntelliJ IDEA", Icon: IntelliJIdeaIcon, value: "idea" },
  ];
  return baseOptions.filter((option) => availableEditors.includes(option.value));
};

export const OpenInPicker = memo(function OpenInPicker({
  keybindings,
  availableEditors,
  openInCwd,
  workspaceMode,
  onOpenAgent,
  onOpenEditor,
}: {
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  workspaceMode: "agent" | "editor";
  onOpenAgent: () => void;
  onOpenEditor: () => void;
}) {
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(availableEditors);
  const externalEditorOptions = useMemo(
    () => resolveExternalEditorOptions(availableEditors),
    [availableEditors],
  );
  const primaryWorkspaceLabel = workspaceMode === "editor" ? "Editor" : "Agent";
  const PrimaryWorkspaceIcon = workspaceMode === "editor" ? FileCode2Icon : BotIcon;
  const fileManagerLabel = useMemo(() => resolveFileManagerLabel(navigator.platform), []);

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      const api = readLocalApi();
      if (!api || !openInCwd) return;
      const editor = editorId ?? preferredEditor;
      if (!editor) return;
      void api.shell.openInEditor(openInCwd, editor);
      setPreferredEditor(editor);
    },
    [openInCwd, preferredEditor, setPreferredEditor],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const api = readLocalApi();
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!api || !openInCwd) return;
      if (!preferredEditor) return;

      e.preventDefault();
      void api.shell.openInEditor(openInCwd, preferredEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preferredEditor, keybindings, openInCwd]);

  return (
    <Group aria-label="Workspace open actions">
      <Button
        size="xs"
        variant="outline"
        disabled={!openInCwd}
        onClick={workspaceMode === "editor" ? onOpenEditor : onOpenAgent}
      >
        <PrimaryWorkspaceIcon aria-hidden="true" className="size-3.5" />
        <span className="ml-0.5">{primaryWorkspaceLabel}</span>
      </Button>
      <GroupSeparator className="hidden @3xl/header-actions:block" />
      <Menu>
        <MenuTrigger
          render={<Button aria-label="Workspace open options" size="icon-xs" variant="outline" />}
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={onOpenEditor}>
            <FileCode2Icon aria-hidden="true" className="text-muted-foreground" />
            Editor
          </MenuItem>
          <MenuItem onClick={onOpenAgent}>
            <BotIcon aria-hidden="true" className="text-muted-foreground" />
            Agent
          </MenuItem>
          <MenuItem disabled={!openInCwd} onClick={() => openInEditor("file-manager")}>
            <FolderClosedIcon aria-hidden="true" className="text-muted-foreground" />
            {fileManagerLabel}
          </MenuItem>
          {externalEditorOptions.length > 0 ? <MenuSeparator /> : null}
          {externalEditorOptions.length === 0 ? (
            <MenuItem disabled>No installed editors found</MenuItem>
          ) : null}
          {externalEditorOptions.map(({ label, Icon, value }) => (
            <MenuItem key={value} disabled={!openInCwd} onClick={() => openInEditor(value)}>
              <Icon aria-hidden="true" className="text-muted-foreground" />
              {`Open in ${label}`}
              {value === preferredEditor && openFavoriteEditorShortcutLabel ? (
                <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
              ) : null}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
