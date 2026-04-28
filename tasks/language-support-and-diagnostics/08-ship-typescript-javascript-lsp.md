# Ship TypeScript and JavaScript LSP

## Goal

Make TypeScript, TSX, JavaScript, and JSX feel like first-class IDE languages in the T3 editor.

## Context

TS/JS are the most important first implementation because this repo, the outer Colosseum repo, and most frontend/server work depend on them. They also exercise the hardest problems: project configs, Vite ambient types, Node backend modules, JSX/TSX, path aliases, monorepo roots, and import resolution.

## Requirements

- [x] Add a TypeScript/JavaScript server adapter using `typescript-language-server` or a tsserver-backed host path.
- [x] Detect the correct project root and `tsconfig.json` or `jsconfig.json` for the opened file.
- [x] Support `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, and `.cjs`.
- [x] Sync unsaved buffers and receive live diagnostics.
- [x] Provide hover, completion, definition, references, and rename through Monaco.
- [x] Ensure Vite/browser files and Node/backend files use the correct project context.
- [x] Keep ESLint and `tsc` project diagnostics as saved-file or workspace-rule layers where useful.
- [x] Add settings for TypeScript server enablement, binary path override, and args once the adapter works.

## Technical Notes

- Use the profile work in `monacoProjectProfile.ts` only as a temporary Monaco fallback; the LSP should rely on real project configs.
- The adapter should handle both frontend Vite projects and NodeNext backend projects.
- Avoid loading package declarations manually into Monaco once the LSP owns project-aware type intelligence.
- Preserve Monaco syntax diagnostics as a fast fallback, but do not let Monaco semantic false positives override LSP truth.

## Acceptance Criteria

- [x] Opening representative web, backend, and package TS/JS files starts the correct server session.
- [x] Invalid unsaved code produces live diagnostics without saving.
- [x] Valid imports that match the real project config do not show bogus squiggles.
- [x] Hover, completion, definition, references, and rename work in at least one TSX file and one backend TS file.
- [x] Explorer badges and editor diagnostic counts reflect LSP diagnostics.
- [x] Targeted validation passes, or unrelated failures are documented separately.
