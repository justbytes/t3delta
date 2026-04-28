# Ship C and C++ LSP

## Goal

Add production-quality C and C++ editor support through `clangd`.

## Context

C and C++ users expect real compile-command-aware diagnostics, completion, navigation, and refactor support. Monaco grammar support is not enough. `clangd` is the practical first server for both C and C++.

## Requirements

- [x] Add a `clangd` server adapter.
- [x] Detect project roots using `compile_commands.json`, `compile_flags.txt`, CMake files, Makefiles, or workspace fallback.
- [x] Support `.c`, `.h`, `.cc`, `.cpp`, `.cxx`, `.hpp`, and `.hxx`.
- [x] Sync unsaved buffers for live diagnostics.
- [x] Provide hover, completion, definition, references, and rename where supported.
- [x] Add C/C++ server settings for enablement, binary path, args, and compile database path override.

## Technical Notes

- `clangd` quality depends heavily on compile commands; surface missing compile database status clearly.
- Headers may not belong to a single obvious translation unit; start with clangd defaults and document limitations.
- Do not try to implement C/C++ diagnostics through hand-rolled compiler calls first.
- The initial implementation passes `--compile-commands-dir` automatically when a compile database is found or when the settings override is provided.

## Acceptance Criteria

- [x] Opening a C or C++ file starts `clangd` for the correct workspace.
- [x] Unsaved syntax/type errors appear without saving.
- [x] Hover and definition work in a representative compile-database-backed project.
- [x] Missing `compile_commands.json` or `clangd` is reported clearly.
- [x] Explorer badges and editor counts reflect C/C++ diagnostics.
- [x] Targeted validation passes, or unrelated failures are documented separately.
