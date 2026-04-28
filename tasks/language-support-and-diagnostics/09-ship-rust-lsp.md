# Ship Rust LSP

## Goal

Add production-quality Rust editor support through `rust-analyzer`.

## Context

Rust support should move beyond syntax highlighting and saved `cargo check` results. `rust-analyzer` should provide live diagnostics and navigation for Rust workspaces while `cargo check` remains useful for saved-file or full-project validation.

## Requirements

- [x] Add a `rust-analyzer` server adapter.
- [x] Detect Rust workspace roots using `Cargo.toml`.
- [x] Support `.rs` files and multi-crate workspaces.
- [x] Sync unsaved buffers for live diagnostics.
- [x] Provide hover, completion, definition, references, and rename where supported.
- [x] Keep `cargo check` as a project diagnostics layer, with duplicate diagnostics handled cleanly.
- [x] Add Rust server settings for enablement, binary path, and args.

## Technical Notes

- Prefer one `rust-analyzer` session per Cargo workspace root.
- Surface missing `rust-analyzer` distinctly from missing `cargo`.
- Do not run `cargo check` on every keystroke.
- The diagnostics aggregator should avoid showing identical `rust-analyzer` and `cargo check` messages twice when possible.

## Acceptance Criteria

- [x] Opening a Rust file starts a `rust-analyzer` session for the correct Cargo workspace.
- [x] Unsaved Rust syntax/type errors appear without saving.
- [x] Hover and go-to-definition work across modules in the same crate.
- [x] `cargo check` remains available as a saved/project diagnostic pass.
- [x] Explorer badges and editor counts reflect Rust diagnostics.
- [x] Targeted validation passes, or unrelated failures are documented separately.
