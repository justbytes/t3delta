# Center Pane Mode Model

## Status: Complete

## Goal

Define and implement the state model that lets the center pane switch cleanly between Agent and Editor surfaces.

## Context

Right now the center pane is structurally a chat-first surface, and the new explorer still assumes file clicks leave the app through `openInPreferredEditor`. Before any file rendering is added, Colosseum needs an explicit workspace model for what occupies the center pane, how that state is stored, and how it coexists with the existing thread route, terminal drawer, and right-side sidecar.

## Requirements

- [x] Introduce a center-pane workspace state that distinguishes `agent` from `editor` mode.
- [x] Store open-file tab state per active thread or per logical project, with a clearly chosen scope.
- [x] Define selection behavior for first open, repeated open, closing tabs, and returning to the agent surface.
- [x] Keep the existing thread route and terminal layout intact while the center pane content changes.

## Technical Notes

The current shell to anchor this work is [ChatView.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/ChatView.tsx) plus the thread route container [\_chat.$environmentId.$threadId.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/routes/_chat.$environmentId.$threadId.tsx). The new state should fit the existing store/UI-state patterns rather than living only inside [ProjectExplorerPanel.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/ProjectExplorerPanel.tsx). Decide up front whether editor tabs are thread-scoped or project-scoped and document the tradeoff in code comments or task notes.

This implementation chooses thread-scoped editor tabs. That keeps the center pane aligned with T3's existing thread-centric workspace model and avoids leaking file tabs across separate threads that happen to point at the same project.

## Acceptance Criteria

- [ ] Tests pass
- [ ] Feature works end-to-end in dev
