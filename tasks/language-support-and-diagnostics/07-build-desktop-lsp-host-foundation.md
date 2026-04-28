# Build Desktop LSP Host Foundation

## Goal

Create the shared desktop-side language-server host that all first-wave languages use.

## Context

The current editor has Monaco syntax, partial Monaco diagnostics, and saved-file project diagnostics. A professional IDE needs live-buffer LSP sessions owned by the trusted desktop/server runtime, not browser-spawned language servers. This task is the foundation before TypeScript, Rust, Python, Solidity, C/C++, Java, or C# can be implemented cleanly.

## Requirements

- [x] Add a `WorkspaceLanguageServers` service contract near the existing workspace services.
- [x] Add session management keyed by environment, workspace root, and server id.
- [x] Spawn language-server child processes over stdio JSON-RPC.
- [x] Implement initialize, initialized, shutdown, and exit lifecycle handling.
- [x] Add restart and failure-state handling with bounded retries.
- [x] Add document open, change, save, and close support using full-text sync first.
- [x] Add normalized diagnostics, hover, completion, definition, references, rename, and code-action request/response contracts.
- [x] Add a WebSocket or RPC subscription path for pushed diagnostics.
- [x] Add feature gating based on server capabilities reported during initialize.
- [x] Add logging that makes failed server startup, missing binaries, and protocol errors visible in dev.

## Technical Notes

- Start in `apps/server/src/workspace` next to `WorkspaceDiagnostics`.
- Reuse existing environment/workspace identity and file path normalization instead of inventing a browser-side root detector.
- The browser editor should talk to a narrow app API, not raw LSP JSON-RPC.
- Use full document sync initially; incremental sync can be a later performance task.
- Diagnostics should be owner-tagged separately from Monaco and CLI diagnostics when converted to Monaco markers.
- Plain web mode should degrade gracefully with LSP disabled.

## Acceptance Criteria

- [x] A supported language can start one LSP session lazily for a workspace.
- [x] Unsaved editor changes are sent to the server host.
- [x] Diagnostics can be pushed back to the active Monaco model.
- [x] Hover and definition can be requested through the normalized app API.
- [x] Missing language-server binaries produce clear UI-visible or log-visible status instead of silent failure.
- [x] Package-level typecheck or targeted tests pass for changed server/web packages, with unrelated existing failures documented separately.
