# Plan Desktop LSP Host

## Status: Complete

## Goal

Define the architecture for a real desktop-hosted LSP layer that can later provide richer diagnostics, completions, navigation, and code actions for multiple languages.

## Context

A proper LSP host is the longer-term answer for full IDE behavior, but it is materially harder than language mapping or project diagnostics. We need a concrete design before implementing it so we do not accidentally build a fragile pseudo-extension system or pretend we are copying Zed's Rust runtime into an Electron app.

## Requirements

- [x] Define where language-server processes live and how they are started, restarted, and shut down.
- [x] Define the transport boundary between the desktop or backend side and the web editor surface.
- [x] Define workspace-root detection and multi-project behavior.
- [x] Identify the first candidate servers, likely TypeScript support, `rust-analyzer`, `pyright`, and a Solidity server.
- [x] Define language-server selection and disable rules in a way that is easy to configure later in settings.

## Technical Notes

- Keep this aligned with Electron and desktop hosting; the plain web build should be treated as a reduced-capability fallback.
- Borrow configuration ideas from editors like Zed, such as per-language server selection, but do not attempt to copy Zed's Rust, Wasm, or GPUI implementation.
- Do not assume VS Code extension compatibility.
- This task should likely end in a design doc plus one narrow spike, not a giant first-pass implementation.
- A future problems panel, go-to-definition, hover, and richer completions should depend on this design rather than being invented ad hoc.

## Proposed Architecture

### 1. Process ownership

- Language-server processes should live on the desktop or server side, alongside the existing workspace diagnostics runner.
- The web editor must never spawn language servers directly.
- Add a new workspace-adjacent service, tentatively `WorkspaceLanguageServers`, parallel to:
  - `WorkspaceFileSystem`
  - `WorkspaceDiagnostics`
- That service owns:
  - server selection
  - process spawn
  - stdio transport
  - restart policy
  - shutdown on workspace/thread teardown

### 2. Runtime placement

- In desktop mode:
  - Electron-launched server process is the host for LSP child processes.
  - This keeps filesystem access and process control in one trusted runtime.
- In plain web mode:
  - LSP is reduced-capability or disabled entirely.
  - Monaco-native diagnostics and project CLI diagnostics remain the fallback.

### 3. Session model

- LSP sessions should be keyed by workspace root plus server identity, not by editor tab.
- Multiple file tabs in the same project should share one server session where the language server supports full-workspace indexing.
- Proposed key shape:
  - `workspaceRoot`
  - `serverId`
  - optional `environmentId` if the same root can appear in distinct runtime contexts

### 4. Lifecycle rules

- Start:
  - lazily on first editor feature request for a supported file in a supported workspace
  - not eagerly for every project at app startup
- Keep alive:
  - while at least one relevant editor model is open
  - optionally with idle timeout later
- Restart:
  - when the process exits unexpectedly
  - when server settings materially change
  - when workspace root changes
- Stop:
  - on desktop/server shutdown
  - on explicit disable
  - when the owning workspace is removed

### 5. Transport boundary

- Server side talks to language servers over stdio using JSON-RPC.
- Web editor talks to the server host over the existing T3 RPC/WebSocket boundary.
- Do not expose raw LSP JSON-RPC directly to the browser.
- Instead add a narrow normalized host API for editor needs:
  - open text document
  - change text document
  - close text document
  - request hover
  - request definition
  - request completion
  - receive diagnostics
  - request code actions later

### 6. Document sync strategy

- Monaco is the source of truth for unsaved editor buffer text.
- The LSP host must therefore support live in-memory text synchronization, not only saved-disk snapshots.
- That means the current project diagnostics runner and the future LSP host will coexist:
  - CLI diagnostics: saved-file, tool-specific, good for repo rules
  - LSP diagnostics: live-buffer, language-service, good for editor interactions
- Initial sync mode should be full-text sync on change.
- Incremental sync can come later if performance requires it.

### 7. Workspace-root behavior

- Root detection should use the existing project/workspace root supplied by the thread/editor context.
- Do not invent a second root system in the browser.
- The host may later support nested overrides if a file sits inside a subproject with its own config root, but the first pass should prefer the known workspace root and let each server decide how to interpret project structure.
- Multi-project behavior:
  - separate LSP sessions per workspace root
  - no cross-project document contamination

### 8. Initial server set

- First-wave candidates:
  - TypeScript: `typescript-language-server` or tsserver-backed host path
  - Rust: `rust-analyzer`
  - Python: `pyright-langserver` or equivalent pyright-based LSP path
  - Solidity: Solidity LSP / Solidity language server path
- Candidate order for the first spike:
  1. TypeScript
  2. Rust
  3. Python
  4. Solidity
- Reason:
  - TypeScript/TSX is already central to the current codebase
  - it exercises diagnostics, hover, completion, and definition in one realistic language family

### 9. Capability model

- The host should track server capabilities per session after initialize handshake:
  - diagnostics
  - hover
  - completion
  - definition
  - references
  - rename
  - code actions
- The web editor should only enable features the active server actually reports.
- Avoid fake UI affordances for unsupported actions.

### 10. Settings model

- Settings should be declarative and per language, not extension-marketplace driven.
- Suggested future config shape:
  - language -> enabled boolean
  - language -> preferred server id
  - language -> fallback server ids
  - server id -> binary path override
  - server id -> extra args
  - server id -> disabled flag
- Disable rules should allow:
  - globally disable a server
  - disable by language
  - disable for a workspace root later
- This mirrors the useful part of Zed-like language configuration without copying its implementation.

### 11. Editor integration path

- Monaco remains the editor surface.
- The browser layer should convert LSP output into Monaco primitives:
  - diagnostics -> model markers
  - completion items -> Monaco completion provider
  - hover -> Monaco hover provider
  - definitions -> Monaco definition provider
- This should be wired in a dedicated editor integration module, not spread ad hoc through `ThreadWorkspacePane.tsx`.

### 12. Relationship to the current diagnostics runner

- Current `WorkspaceDiagnostics` remains the project-tool layer for:
  - ESLint
  - `tsc`
  - `cargo check`
  - `py_compile`
  - `solhint`
- LSP host does not replace that immediately.
- The near-term model is layered:
  - Monaco native diagnostics
  - project CLI diagnostics
  - LSP diagnostics and editor features
- Later, if an LSP fully subsumes a language’s diagnostics path, we can decide whether the CLI runner should remain for repo-rule fidelity.

## First Spike

### Scope

- One desktop-hosted TypeScript LSP path only.
- One editor model at a time is enough for the spike.
- Deliver:
  - diagnostics
  - hover
  - go-to-definition
- Skip for the spike:
  - rename
  - code actions
  - multi-root workspaces
  - full problems panel

### Spike deliverables

- `WorkspaceLanguageServers` service contract
- one TypeScript server adapter
- one server-side session manager keyed by workspace root
- one browser-side Monaco integration module
- one narrow RPC stream or subscription path for diagnostics push events
- one unary request path for hover and definition

### Spike success criteria

- Open a `.ts` or `.tsx` file in the center editor
- LSP session starts lazily
- Unsaved edits update diagnostics in the editor
- Hover works on a symbol
- Go-to-definition returns a target inside the same workspace
- Closing the last relevant editor tab eventually releases the session

## Explicit non-goals

- No VS Code extension compatibility layer
- No Zed runtime transplant
- No Rust rewrite of T3
- No browser-only LSP process management
- No giant all-language implementation in one pass

## Recommended next implementation order

1. Add the `WorkspaceLanguageServers` service contract and session manager skeleton.
2. Add one TypeScript/JavaScript adapter and one diagnostics push path.
3. Bind Monaco diagnostics to that stream.
4. Add hover, completion, definition, references, and rename for the same adapter.
5. Generalize through the dedicated language rollout tasks.

## Acceptance Criteria

- [x] A clear implementation design exists for desktop-hosted LSP.
- [x] The first implementation tasks are split into executable follow-up files.
- [ ] A validated TypeScript/JavaScript spike exists in dev.
