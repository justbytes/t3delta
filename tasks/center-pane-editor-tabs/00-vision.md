# Center Pane Editor Tabs

## Vision

Colosseum’s T3-based workspace should stop treating files as something that immediately ejects you into an external IDE and instead let the app itself become the primary working surface. Done looks like a thread view where the center pane can hold the agent or one or more open file tabs, the explorer opens files directly into that pane with correct language highlighting, and the top controls clearly separate Finder-style external navigation from in-app Editor and Agent modes. This is valuable because it turns the app from a launcher into a real workspace without breaking T3’s existing thread, terminal, and project model.

## High-Level Goals

- Make the center pane a first-class workspace that can show either the agent thread or open file tabs.
- Replace the current explorer-to-external-editor handoff with an in-app file-open flow.
- Preserve T3’s existing environment/thread/project abstractions instead of bypassing them with ad hoc local file reads.
- Keep Finder/external-editor affordances available where they still make sense, but separate them from the new in-app editor path.
- Deliver an IDE-like read experience first: tabs, syntax-aware rendering, correct file identity, and smooth switching back to the agent.

## Themes

- Center-pane mode architecture
- File open/read lifecycle
- Editor tab UX and syntax rendering
- Header/explorer/open-control integration
- Incremental polish without overcommitting to full IDE parity

## Out of Scope for Now

- Full write/save/editing workflow with dirty tracking and conflict handling
- Multi-split editor panes
- Search across files, symbol indexing, or language server features
- Replacing the terminal or git sidecar model
- Branch/worktree switching changes
