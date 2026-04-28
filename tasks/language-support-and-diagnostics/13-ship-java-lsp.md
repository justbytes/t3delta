# Ship Java LSP

## Goal

Add production-quality Java editor support through a Java language server.

## Context

Java support should not stop at Monaco grammar highlighting. Java users expect workspace indexing, import resolution, diagnostics, completion, navigation, and rename that understand Maven, Gradle, and source roots.

## Requirements

- [x] Select the first Java language server path, likely Eclipse JDT LS.
- [x] Add a Java LSP adapter.
- [x] Detect project roots using `pom.xml`, `build.gradle`, `settings.gradle`, `.project`, or workspace fallback.
- [x] Support `.java`.
- [x] Sync unsaved buffers for live diagnostics.
- [x] Provide hover, completion, definition, references, and rename where supported.
- [x] Add Java server settings for enablement, binary path, JVM args, and workspace storage path.

## Technical Notes

- JDT LS has heavier startup and workspace-state requirements than the earlier servers.
- Keep server storage outside source-controlled project files.
- Surface Java runtime or server boot failures clearly.
- Initial path: use `jdtls` first and pass a per-workspace `-data` directory under `~/.t3delta/jdtls-workspaces` unless settings override it.

## Acceptance Criteria

- [x] Opening a Java file starts the Java language server for the correct workspace.
- [x] Unsaved Java diagnostics appear without saving.
- [x] Hover and definition work in a representative Maven or Gradle project.
- [x] Server startup failures are visible and actionable.
- [x] Explorer badges and editor counts reflect Java diagnostics.
- [x] Targeted validation passes, or unrelated failures are documented separately.
