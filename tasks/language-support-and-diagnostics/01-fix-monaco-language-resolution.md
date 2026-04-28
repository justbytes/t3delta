# Fix Monaco Language Resolution

## Goal

Make the current editor resolve Monaco-compatible language ids correctly so the common file types already in use render with the expected syntax highlighting.

## Context

The current editor path resolves language ids through the vendored VS Code icon association data, but Monaco and icon packs do not use identical language ids. Right now `.tsx` resolves to `typescriptreact`, which is good for icon selection but not for Monaco language selection. This is the immediate root cause of the missing TSX highlighting and it has to be fixed before any diagnostics work is trustworthy.

## Requirements

- [x] Split icon-language resolution from editor-language resolution so Monaco gets its own canonical language ids.
- [x] Add explicit editor-language mappings for at least: JavaScript, JSX, TypeScript, TSX, Rust, Python, Solidity, Java, C, C++, shell, JSON, YAML, TOML, `.env`, and Makefile.
- [x] Add basename overrides for files that do not resolve correctly from extension-only logic, including `.env`, `Makefile`, `Dockerfile`, and similar common config files.
- [x] Treat Solid source as TSX or JSX for syntax-highlighting purposes unless we later add a more specific language layer.
- [x] Keep icon behavior unchanged while fixing editor language behavior.

## Technical Notes

- Current implementation to fix: `apps/web/src/lib/editorSyntax.tsx` and `apps/web/src/vscode-icons.ts`.
- `resolveEditorLanguage()` should no longer blindly return the icon-association language id.
- Monaco should receive its own language id, while future LSP adapters may still need LSP-specific ids like `typescriptreact`.
- This task should produce a small, explicit editor-language registry instead of growing one-off conditionals.

## Acceptance Criteria

- [x] Tests pass
- [ ] `.tsx`, `.jsx`, `.ts`, `.js`, `.rs`, `.py`, `.sol`, `.java`, `.c`, `.cpp`, `.env`, and Makefiles render with expected syntax highlighting in dev
