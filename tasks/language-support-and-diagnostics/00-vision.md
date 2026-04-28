# Language Support and Diagnostics

## Vision

Colosseum's T3-based editor should become a world-class coding surface by keeping Monaco as the editor UI and adding a real desktop-hosted language-server layer underneath it. Done looks like TypeScript, JavaScript, Rust, Python, Solidity, C, C++, Java, and C# files opening with correct language identity, live diagnostics on unsaved buffers, project-aware import/type resolution, hover, completion, definition, references, rename where supported, and clear red/yellow problem indicators throughout the editor and explorer. This is valuable because T3 is becoming a broader super-app surface, and users will still expect the embedded editor to behave like a serious IDE instead of a syntax-highlighted text box.

## High-Level Goals

- Fix Monaco language resolution so the editor recognizes the file types we actually use.
- Add real diagnostics in stages, starting with Monaco-native JS/TS feedback.
- Make Monaco's embedded TypeScript environment match real project ambient types closely enough that Vite globals, browser libs, path aliases, and common package declarations do not produce false positives.
- Build a desktop-side project diagnostics runner for linting and typecheck tools.
- Build a desktop-hosted LSP layer that provides live-buffer diagnostics and IDE features.
- Support the first professional language set: TypeScript, JavaScript, Rust, Python, Solidity, C, C++, Java, and C#.
- Add settings for language associations, server selection, binary overrides, and per-workspace enablement after the runtime paths are real.

## Themes

- Monaco language identity and file association correctness
- Monaco project environment parity for TypeScript, Vite, browser globals, aliases, and package types
- Diagnostics first, then hover/completion/navigation/refactor features
- Desktop-owned lint, typecheck, and language-server processes
- Live unsaved-buffer synchronization between Monaco and LSP sessions
- Per-language rollout with shared host infrastructure
- Language and server configuration in settings once the server paths exist
- Explicit non-goals around Zed and VS Code compatibility

## Target Language Set

- TypeScript and JavaScript through `typescript-language-server` or a tsserver-backed adapter.
- Rust through `rust-analyzer`.
- Python through `pyright-langserver`.
- Solidity through `solidity-language-server` plus `solhint` where useful.
- C and C++ through `clangd`.
- Java through Eclipse JDT LS or another production Java LSP path.
- C# through OmniSharp or `csharp-ls`, selected after a short compatibility spike.

## Execution Order

1. Finish the shared desktop LSP host foundation.
2. Ship TypeScript and JavaScript end to end.
3. Ship Rust end to end.
4. Ship Python end to end.
5. Ship Solidity end to end.
6. Add the systems and enterprise languages: C/C++, Java, and C#.
7. Polish editor UX so diagnostics, hover, completion, definition, references, and rename feel consistent across languages.

## Out of Scope for Now

- Copying Zed's Rust, GPUI, Wasm extension, or Tree-sitter host architecture into this repo
- Converting `t3delta` into Rust
- Full VS Code extension compatibility or a public extension marketplace
- Rewriting the whole desktop shell or center-pane layout to mimic Zed internals
- Debug adapters, test explorer integration, and package-manager UI
- Full IDE parity for languages outside the target set before the first target set is solid
