# Agent and Editor Coexistence Polish

## Status

Implemented in code, pending dev verification.

## Goal

Make the agent surface and the new editor tabs feel like one coherent workspace instead of two competing modes.

## Context

The hard part is not only rendering files. It is making the thread, editor tabs, sidecar, and terminal behave predictably together so the app still feels like T3 rather than a bolted-on IDE preview. This pass is where the mode transitions, focus behavior, empty states, and basic keyboard interactions get cleaned up.

## Requirements

- [x] Define what remains visible when the editor is active: composer, terminal drawer, and sidecar behavior.
- [x] Add polished empty/loading/error states for editor mode and no-open-file cases.
- [x] Add basic tab management interactions such as activate, close, and close-others if the implementation surface supports them cleanly.
- [x] Verify that diff sidecar, explorer sidecar, and terminal interactions still make sense while the editor owns the center pane.

## Technical Notes

Be careful not to regress the right-side workspace sidecar work already implemented in [WorkspaceSidecarShell.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/WorkspaceSidecarShell.tsx), [DiffPanel.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/DiffPanel.tsx), and [ProjectExplorerPanel.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/ProjectExplorerPanel.tsx). The point is a unified workspace, not separate islands. Keep the first pass focused on coherence; full editing, save cycles, and undo/redo can be scheduled later if the user wants to push from viewer to full IDE.

## Acceptance Criteria

- [ ] Tests pass
- [ ] Feature works end-to-end in dev
