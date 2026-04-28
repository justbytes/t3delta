# Add Monaco Diagnostics Baseline

## Goal

Turn the editor from syntax-colored text into a basic diagnostic surface by enabling Monaco markers and editor-native feedback where Monaco already has language-service support.

## Context

Before we chase external language servers, we should take the win Monaco already gives us for JavaScript and TypeScript. That gets us real errors and warnings for the center-pane editor quickly and creates the marker plumbing the later diagnostics layers will reuse.

## Requirements

- [x] Configure Monaco's JavaScript and TypeScript defaults intentionally for this app.
- [x] Surface Monaco markers in the editor gutter, overview ruler, and inline squiggles.
- [x] Add lightweight editor feedback for error and warning counts on the active tab or current pane.
- [x] Make sure `.tsx` and `.jsx` files benefit from the corrected language resolution from task `01`.
- [x] Keep the baseline diagnostics fast enough that file open and editing stay responsive.
- [x] Avoid one-off ambient type patches by feeding Monaco the project-like environment it needs for common globals such as `import.meta.env`, browser APIs, and package declarations.

## Technical Notes

- This task is about Monaco-native diagnostics, not repo-specific lint rules.
- Monaco can cover JS, JSX, TS, and TSX reasonably well once language identity is fixed.
- This is the correct first step before introducing any desktop process orchestration.
- If we want `max-len` or other style rules later, those should come from ESLint or Biome, not from Monaco itself.
- False positives from Monaco not knowing Vite's `import.meta.env` shape are now handled by `apps/web/src/lib/monacoProjectEnvironment.ts`.
- Full package declaration loading remains out of scope for Monaco and belongs to the future LSP host if project-wide type intelligence is needed.

## Acceptance Criteria

- [x] Tests pass
- [ ] JS, JSX, TS, and TSX files show Monaco diagnostics in dev with visible inline markers
- [x] Known project globals and standard JS/browser APIs do not produce Monaco-only false positives when the same file is clean in Zed or `tsc`
