# Tabbed Editor Surface

## Status: Complete

## Goal

Render opened files inside the center pane as IDE-style tabs with syntax-aware display.

## Context

Once the app can read file content, the next job is making that feel like a real workspace rather than a raw preview. The user wants file clicks to open tabs in the center pane and show code with correct language formatting. That means tabs, active selection, file icons/names, and a syntax-aware content renderer that feels consistent with the rest of T3.

## Requirements

- [x] Build an in-app editor view with a top tab strip for multiple open files.
- [x] Show file name, path context, and correct language highlighting for supported text files.
- [x] Reuse the existing VS Code-style file icon mapping where appropriate so the tab strip and explorer stay visually aligned.
- [x] Define a fallback presentation for unsupported or binary files.

## Technical Notes

Start with a read-first editor surface. Do not mix initial implementation with save/dirty-state complexity unless the architecture makes that unavoidable. Reuse or extend the existing icon/language association work already present under [vscode-icons.ts](/Users/xtox/colosseum/t3delta/apps/web/src/vscode-icons.ts) and related mappings. The editor surface should mount inside the same center-pane shell that currently renders the thread content from [ChatView.tsx](/Users/xtox/colosseum/t3delta/apps/web/src/components/ChatView.tsx).

## Acceptance Criteria

- [ ] Tests pass
- [ ] Feature works end-to-end in dev
