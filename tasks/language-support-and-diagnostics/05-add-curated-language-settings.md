# Add Curated Language Settings

## Goal

Give the app a controlled settings-backed way to manage built-in language coverage, file associations, and language-server preferences without introducing a full extension marketplace.

## Context

We want broader language support, but the correct first step is a curated built-in list plus user-tunable associations and server preferences, not an extension store. Settings become much more useful once the editor can already highlight files and surface diagnostics from real tools.

## Requirements

- [x] Add a settings section for editor language support and diagnostics behavior.
- [x] Surface the curated built-in language list and let users enable or disable languages from that list.
- [x] Add custom file-association rules such as `pattern -> language` for edge cases and project-specific filenames.
- [x] Add per-language server selection and disable controls once the LSP host shape is defined.
- [x] Persist settings through the existing app settings path rather than local component state.

## Technical Notes

- The first-pass settings should configure language recognition and server selection, not install third-party grammars or extensions.
- Avoid promising "every language" through settings alone; the settings page should expose what the runtime can actually support.
- Solid likely belongs in documentation and UI copy as a TSX or JSX-backed workflow unless we later add Solid-specific diagnostics.
- Keep the model simple: built-in languages, custom associations, diagnostics preferences, and language-server selection.
- Monaco ambient project environment is not user-configurable in the settings UI yet. It is an implementation detail owned by task `06`.
- The Monaco diagnostics toggle controls deeper JS/TS checking behavior; syntax feedback stays on for supported Monaco languages.

## Acceptance Criteria

- [x] Tests pass
- [ ] Users can inspect and change built-in language coverage, file associations, and diagnostics-related preferences from Settings in dev
