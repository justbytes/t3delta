# Ship Python LSP

## Goal

Add production-quality Python editor support through `pyright-langserver`.

## Context

Python currently has syntax highlighting and basic `py_compile` diagnostics. A real editor needs import-aware analysis, type checking, hover, completion, and navigation from a Python language server.

## Requirements

- [x] Add a `pyright-langserver` adapter.
- [x] Detect Python project roots using `pyproject.toml`, `setup.cfg`, `setup.py`, `requirements.txt`, or a workspace root fallback.
- [x] Support `.py` and `.pyi`.
- [x] Sync unsaved buffers for live diagnostics.
- [x] Provide hover, completion, definition, references, and rename where supported.
- [x] Keep `py_compile` as a low-cost saved-file syntax layer if still useful.
- [x] Add Python server settings for enablement, binary path, args, and optional virtualenv path later.

## Technical Notes

- Initial implementation can rely on the active shell/PATH environment for `pyright-langserver`.
- Virtualenv selection is important for professional-grade Python, but can be a follow-up after baseline LSP works.
- Diagnostics should clearly identify whether they came from Pyright or `py_compile`.

## Acceptance Criteria

- [x] Opening a Python file starts a Pyright session for the correct workspace.
- [x] Unsaved Python syntax/type/import errors appear without saving.
- [x] Hover and definition work for local symbols.
- [x] Missing Pyright or missing Python environment is reported clearly.
- [x] Explorer badges and editor counts reflect Python diagnostics.
- [x] Targeted validation passes, or unrelated failures are documented separately.
