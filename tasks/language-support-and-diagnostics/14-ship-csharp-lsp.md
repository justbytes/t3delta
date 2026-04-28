# Ship C# LSP

## Goal

Add production-quality C# editor support through a C# language server.

## Context

C# is part of the target language set but is not currently a first-class curated language in the editor settings. This task adds real C# support instead of relying on icon associations or generic text behavior.

## Requirements

- [x] Add `csharp` to the curated editor language settings and file association resolver.
- [x] Select the first C# server path, likely OmniSharp or `csharp-ls`, after a compatibility spike.
- [x] Add a C# LSP adapter.
- [x] Detect project roots using `.sln`, `.csproj`, or workspace fallback.
- [x] Support `.cs` and optionally `.csx`.
- [x] Sync unsaved buffers for live diagnostics.
- [x] Provide hover, completion, definition, references, and rename where supported.
- [x] Add C# server settings for enablement, binary path, and args.

## Technical Notes

- OmniSharp and `csharp-ls` have different installation and runtime expectations; choose the one that is easiest to support locally first.
- Treat .NET SDK availability as a separate status from language-server availability.
- Add icons and settings only as part of real runtime support, not as a cosmetic-only step.
- Initial path: use `csharp-ls` first because it fits the existing stdio host with less custom bootstrapping than OmniSharp.

## Acceptance Criteria

- [x] Opening a C# file starts the selected C# language server for the correct workspace.
- [x] Unsaved C# diagnostics appear without saving.
- [x] Hover and definition work in a representative `.csproj` or `.sln` project.
- [x] Missing .NET SDK or missing server binary is reported clearly.
- [x] Explorer badges and editor counts reflect C# diagnostics.
- [x] Targeted validation passes, or unrelated failures are documented separately.
