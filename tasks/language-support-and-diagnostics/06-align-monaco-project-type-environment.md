# Align Monaco Project Type Environment

## Goal

Make Monaco's embedded TypeScript worker understand the same project-level ambient types and compiler assumptions that the real web app uses, so diagnostics are useful instead of becoming a stream of false positives.

## Context

The first Monaco diagnostics pass catches syntax and simple TypeScript issues, but it is still running in a simplified browser-side TypeScript environment. We already had to patch `import.meta.env` with a Vite shim, and the next squiggle on `.trim()` is a sign that Monaco is still missing either the right lib set, ambient declarations, or project type context. This task is the investigation and hardening pass before building a full desktop LSP host. It depends on tasks `01` and `02`, and it informs task `04` by identifying which problems are reasonable to solve in Monaco versus which should move to the real LSP layer.

## Requirements

- [x] Inventory the current Monaco false positives across representative files in `apps/web/src`, including the Vite env case and the `.trim()` case.
- [x] Identify the actual diagnostic source for each false positive: Monaco syntax, Monaco semantic, project `tsc`, ESLint, or another marker owner.
- [x] Compare Monaco's compiler options against `apps/web/tsconfig.json` and `tsconfig.base.json`, including `lib`, `types`, `jsx`, `module`, `moduleResolution`, and path aliases.
- [x] Add a dedicated Monaco project environment module instead of continuing to add ad hoc declarations inside `monacoDiagnostics.ts`.
- [x] Feed Monaco the required ambient declarations for Vite, browser globals, and app-local globals such as `window.nativeApi` and `window.desktopBridge`.
- [x] Decide which node/package declarations are safe and useful to load into Monaco, and document what remains out of scope until the LSP host exists.
- [ ] Add a small regression checklist or test fixture set for common files: Vite env usage, string `.trim()`, TSX JSX, import aliases, and browser globals.

## Implementation Notes

- Added `apps/web/src/lib/monacoProjectEnvironment.ts` as the owner for Monaco ambient project declarations.
- Moved the Vite env declarations out of `monacoDiagnostics.ts`.
- Changed `VITE_*` env typing to `string | undefined` instead of a broad `string | boolean | undefined` index signature. This fixes false positives on `.trim()` for Vite env variables while keeping `DEV`, `PROD`, and `SSR` as booleans.
- Added app-local browser globals as `unknown` placeholders for `window.nativeApi` and `window.desktopBridge`; the full contract types should wait until Monaco can reliably load package declarations.
- Kept package declaration loading out of scope for this pass. Pulling arbitrary `node_modules` types into Monaco is brittle and should be handled by the future desktop LSP host when we need real project-wide type intelligence.

## Technical Notes

- Relevant current files:
  - `apps/web/src/lib/monacoDiagnostics.ts`
  - `apps/web/src/components/ThreadWorkspacePane.tsx`
  - `apps/web/src/vite-env.d.ts`
  - `apps/web/tsconfig.json`
  - `tsconfig.base.json`
- Do not fix source files just to satisfy Monaco unless `tsc` or the repo's real tooling agrees there is a problem.
- Prefer a structured helper such as `monacoProjectEnvironment.ts` that owns extra libs and compiler-option translation.
- Monaco cannot perfectly emulate a full project TypeScript server. The goal is high-signal diagnostics for common frontend files, not perfect workspace indexing.
- Be careful with `addExtraLib`: repeated calls can duplicate declarations after remount/HMR unless the implementation is idempotent.
- The Vite extra-lib shim should move out of `monacoDiagnostics.ts` into the new environment module.
- If TypeScript package declarations become too large or brittle to mirror, leave that for the desktop LSP host from task `04`.

## Acceptance Criteria

- [x] Tests pass or remaining failures are documented as unrelated ambient failures.
- [x] Vite env values such as `import.meta.env.VITE_*` do not produce false Monaco errors.
- [x] Standard JS methods such as `.trim()` do not produce false Monaco errors in the representative frontend file.
- [ ] TSX files still show real syntax and semantic errors when intentionally broken.
- [x] Monaco-only false positives from the audited representative files are either fixed or explicitly documented as LSP-host work.
