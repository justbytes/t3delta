# Design Project Diagnostics Runner

## Goal

Define and implement the first project-aware diagnostics layer that runs local tools in the workspace and normalizes their results into one editor-friendly format.

## Context

Repo-specific feedback such as ESLint, Biome, `tsc`, `cargo check`, `pyright`, `ruff`, and Solidity tooling cannot come from Monaco alone. We need a desktop-aware diagnostics runner that can invoke project-local tools and stream normalized diagnostics back into the editor.

## Requirements

- [x] Define a normalized diagnostics model shared between backend and editor UI.
- [x] Support an initial adapter set for the most relevant ecosystems: ESLint or Biome, TypeScript, Rust, Python, and Solidity.
- [x] Detect which tools are actually available in the project instead of assuming every workspace has the same stack.
- [x] Decide when diagnostics run: on save, on demand, background debounce, or explicit command.
- [x] Define how diagnostics attach to files, tabs, and a future problems panel.

## Implementation Notes

- Initial runtime strategy is file-scoped, not whole-project streaming.
- Diagnostics run automatically when a text file opens and after that file is saved.
- Dirty unsaved buffers clear project-tool markers until the next saved run so the editor does not show stale repo-tool results against unsaved text.
- Monaco native diagnostics remain active for JS and TS, and project-tool diagnostics are layered on top as a separate marker owner.
- The normalized result already carries file-relative diagnostics plus per-tool run metadata, which is enough to feed future per-tab badges or a problems panel without changing the server contract.
- This layer should not be used to compensate for Monaco ambient type gaps. Task `06` owns Monaco's embedded TypeScript environment; this task owns saved-file project tooling.

## Technical Notes

- This layer should live on the desktop or server side of the app, not inside browser-only editor code.
- Reuse existing project and environment abstractions rather than letting the editor spawn arbitrary processes directly.
- Start with project-local CLI tools before full LSP process management.
- Normalize severity, file path, line and column, source, message, and optional code or fix fields.
- Do not use esbuild as a stand-in for linting; lint and type tools should be the real source of diagnostics.

## Acceptance Criteria

- [x] Tests pass
- [ ] At least one JS or TS tool and one non-JS tool can produce normalized diagnostics end-to-end in dev
- [ ] Project-tool markers remain separate from Monaco markers so false-positive source can be identified in dev
