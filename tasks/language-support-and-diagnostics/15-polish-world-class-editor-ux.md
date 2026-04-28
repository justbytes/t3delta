# Polish World-Class Editor UX

## Goal

Make the LSP-backed editor feel coherent, reliable, and professional across the supported language set.

## Context

Adding language servers is not enough. Users expect consistent problem indicators, status affordances, hover/completion quality, navigation behavior, server health visibility, and settings that explain what is active without requiring them to read logs.

## Requirements

- [x] Add a compact per-file language/server status indicator in editor chrome.
- [x] Add clear states for starting, ready, unavailable, failed, and disabled language servers.
- [x] Ensure diagnostics from Monaco, CLI tools, and LSPs merge without duplicate noise.
- [x] Add a problems surface or scoped problem list that can show file/workspace issues.
- [x] Make explorer badges aggregate file and folder problems consistently.
- [x] Add keyboard and mouse affordances for definition, references, rename, and code actions.
- [x] Add settings for server binary paths, args, enablement, and per-workspace overrides where needed.
- [x] Add a representative smoke checklist for every supported language.

## Technical Notes

- Keep UI compact and aligned with the existing editor chrome.
- Avoid adding large instructional panels in the editor.
- Treat server status as developer tooling state, not as app observability.
- Prefer one shared diagnostics aggregation model instead of one-off UI paths per language.

## Smoke Checklist

- [ ] TypeScript: open a `ts/tsx` file, confirm server badge shows ready, hover works, rename works, and one syntax error appears once in the problem list.
- [ ] JavaScript: open a `js/jsx` file, confirm references and quick fix actions open from the editor chrome.
- [ ] Rust: open a Cargo-backed `.rs` file, confirm rust-analyzer starts, hover works, and `cargo check` diagnostics do not double-count against LSP diagnostics.
- [ ] Python: open a `.py` file in a project with `pyproject.toml` or `requirements.txt`, confirm unsaved import/type errors appear and problem list updates live.
- [ ] Solidity: open a `.sol` file in a Foundry or Hardhat project, confirm hover/definition work and `solhint` diagnostics do not duplicate LSP output.
- [ ] C/C++: open a compile-database-backed source file, confirm clangd starts and definition works; if compile commands are missing, confirm the server detail explains that diagnostics may be limited.
- [ ] Java: open a Maven or Gradle-backed `.java` file, confirm JDT LS starts and the server detail does not show a boot failure.
- [ ] C#: open a `.cs` or `.csx` file in a `.sln` or `.csproj` project, confirm C# server starts and definition works.

## Acceptance Criteria

- [x] Users can tell whether language support is active for the current file.
- [x] Diagnostics are visible inline, in the tab/explorer indicators, and in a problem surface.
- [x] Hover, completion, definition, references, and rename use consistent shortcuts and interactions.
- [x] Missing tools are actionable without reading terminal logs.
- [ ] The smoke checklist passes for TypeScript, JavaScript, Rust, Python, Solidity, C/C++, Java, and C#.
