# Open Controls and Explorer Handoff

## Status: Complete

## Goal

Refit the header and explorer interactions so file opening routes into the in-app editor by default while preserving intentional external-open actions.

## Context

The current top control area mixes external-open behavior into the primary workspace affordances, and the explorer still assumes file clicks should launch the preferred editor. That needs to change if Colosseum is going to feel like its own IDE. The control model should distinguish Finder from Editor and Agent intentionally rather than burying the center-pane behavior behind legacy open-in-editor semantics.

## Requirements

- [x] Redesign the `Open` affordance so Finder remains available but in-app `Editor` and `Agent` destinations are explicit.
- [x] Change explorer file clicks to open the selected file into the in-app editor tabs instead of `openInPreferredEditor(...)`.
- [x] Make switching back to the agent surface obvious and fast from the same header/control system.
- [x] Preserve an external-editor path for users who still want Zed/VS Code/Cursor, but make it secondary to the in-app workflow.

## Technical Notes

The current header composition lives in [ChatHeader.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/chat/ChatHeader.tsx), and the existing external-open UI is driven by [OpenInPicker.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/chat/OpenInPicker.tsx) plus [editorPreferences.ts](/Users/xtox/colosseum/t3delta/apps/web/src/editorPreferences.ts). This task should intentionally separate file-manager actions from workspace-mode actions instead of piling more options into a generic launcher. The explorer handoff lives in [ProjectExplorerPanel.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/ProjectExplorerPanel.tsx).

## Acceptance Criteria

- [ ] Tests pass
- [ ] Feature works end-to-end in dev
