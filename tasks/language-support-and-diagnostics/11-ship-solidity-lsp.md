# Ship Solidity LSP

## Goal

Add production-quality Solidity editor support through a Solidity language server plus lint tooling.

## Context

Solidity is part of the target language set and needs more than syntax highlighting. The editor should understand contracts well enough to show live diagnostics, symbol help, and navigation while keeping `solhint` available for project style and rule diagnostics.

## Requirements

- [x] Select and document the Solidity language server path to use first.
- [x] Add a Solidity LSP adapter.
- [x] Detect Solidity project roots using Foundry, Hardhat, Truffle, or workspace fallback files.
- [x] Support `.sol` files.
- [x] Sync unsaved buffers for live diagnostics.
- [x] Provide hover, completion, definition, and references where supported.
- [x] Keep `solhint` as a saved/project diagnostics layer.
- [x] Add Solidity server settings for enablement, binary path, and args.

## Technical Notes

- Foundry and Hardhat projects may need different root/config assumptions.
- Solidity import resolution can be project-tool-specific; document the first supported path clearly.
- Keep LSP diagnostics and `solhint` diagnostics visually distinct enough to debug false positives.
- Initial server choice: `nomicfoundation-solidity-language-server` first, still allowing a manual override to `solidity-language-server` or another compatible binary through settings.

## Acceptance Criteria

- [x] Opening a Solidity file starts a Solidity LSP session for the correct workspace.
- [x] Unsaved Solidity errors appear without saving.
- [x] Hover and definition work for local contract symbols in a representative project.
- [x] `solhint` remains available for lint rules.
- [x] Explorer badges and editor counts reflect Solidity diagnostics.
- [x] Targeted validation passes, or unrelated failures are documented separately.
