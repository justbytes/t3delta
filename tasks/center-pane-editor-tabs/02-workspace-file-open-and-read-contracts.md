# Workspace File Open and Read Contracts

## Status: Complete

## Goal

Add the runtime contracts needed for the app to open project files inside Colosseum instead of sending them to an external editor.

## Context

The explorer currently lists directories through the runtime project client and then calls `openInPreferredEditor(...)` when a file is selected. That is the correct architectural seam to replace, because the app already has an environment-aware runtime boundary. The missing piece is a file-read contract that can safely return file content and metadata for the selected project/worktree.

## Requirements

- [x] Add a runtime contract for reading a project file by path with enough metadata for tab identity and rendering.
- [x] Implement the server/runtime layer that resolves the active project/worktree and reads files safely from disk.
- [x] Handle common failure cases clearly: missing file, binary file, oversized file, and non-text encodings.
- [x] Keep the API compatible with the existing environment abstraction rather than special-casing the desktop shell directly in the React layer.

## Technical Notes

The explorer already uses `requireEnvironmentConnection(...).client.projects.listDirectory(...)` inside [ProjectExplorerPanel.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/ProjectExplorerPanel.tsx). The new read path should live alongside those project/runtime contracts in `packages/contracts` and the corresponding server/web RPC plumbing, not as a browser-only `localApi` shortcut. Review [editorPreferences.ts](/Users/xtox/colosseum/t3delta/apps/web/src/editorPreferences.ts) only as the current external-open fallback being replaced for this flow.

## Acceptance Criteria

- [ ] Tests pass
- [ ] Feature works end-to-end in dev
