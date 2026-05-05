# T3 Delta Release Checklist

Use this checklist before tagging or publishing any release candidate.

## Required automated validation

Run from the repo root:

```bash
bun fmt
bun lint
bun typecheck
bun run test
bun run build
```

All five commands must pass.

## Manual smoke tests

### Startup and routing

- Launch the dev app with `bun dev`.
- Confirm the web client loads without console errors.
- Confirm the server starts and serves the app URL.
- Confirm startup works with the default home dir (`~/.delta`) and with an explicit `T3CODE_HOME` override.

### Thread and agent flow

- Open or create a project/thread.
- Send a prompt through the primary provider flow.
- Confirm streamed events render and the thread reaches a completed state.
- Reload the app and confirm the thread still appears correctly.

### Workspace and editor flow

- Open a workspace file from the explorer.
- Edit a text file in the Monaco editor.
- Confirm dirty-state behavior is visible.
- Save the file and confirm the dirty state clears.
- Re-open the same file and confirm saved contents persist.

### Diagnostics and explorer flow

- Enable project diagnostics.
- Confirm explorer badges update for changed files.
- Confirm disabled editor languages fall back to plaintext.
- Validate behavior in:
  - a repo with ESLint config
  - a repo with Biome config
  - a repo with no JS/TS lint config
- Confirm switching files/threads remains responsive while diagnostics are enabled.

### Settings and persistence

- Toggle editor diagnostics and project diagnostics.
- Change at least one custom editor language association.
- Restart the app and confirm settings persist.

### Branding and release surfaces

- Confirm app title, icons, repository links, and package metadata use T3 Delta branding.
- Confirm the CLI binary is `delta`.
- Confirm docs explain that `T3CODE_*` env vars remain supported for compatibility.
- Confirm OTLP/default server service naming reports `delta-server`.

## Large-repo diagnostics spot check

- Test project diagnostics on at least one medium or large real repository.
- Confirm scan cost is bounded.
- Confirm skipped directories/limits behave as expected.
- Confirm the app stays interactive during or after the scan.

## Go / no-go criteria

Ship only if all of the following are true:

- Automated validation passes.
- Core thread flow works end-to-end.
- File open/edit/save works.
- Diagnostics are correct enough to trust and do not freeze the app.
- Release branding is coherent.
- No known Sev-1 or Sev-2 regressions remain in startup, threading, editing, persistence, or diagnostics.

## Deferred but non-blocking items

These may remain open only if they are documented in the release notes:

- Existing lint warnings that are pre-existing and non-breaking.
- Non-critical UX polish.
- Future improvements to diagnostics depth beyond the bounded fallback behavior.
- TypeScript advisory messages that do not fail the gate (for example, Effect guidance that still exits successfully).

## Release note minimums

- Call out any compatibility-preserved legacy inputs such as `T3CODE_*` env vars.
- Call out known limitations or bounded behavior in project diagnostics.
- Link to the public repo and the correct release artifacts.
