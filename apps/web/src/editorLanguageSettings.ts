import type { EditorLanguageId } from "@t3delta/contracts/settings";

export interface EditorLanguageServerOption {
  readonly id: string;
  readonly label: string;
}

export interface CuratedEditorLanguageDefinition {
  readonly id: EditorLanguageId;
  readonly label: string;
  readonly description: string;
  readonly examples: string;
  readonly serverOptions: readonly EditorLanguageServerOption[];
}

export const CURATED_EDITOR_LANGUAGES: readonly CuratedEditorLanguageDefinition[] = [
  {
    id: "javascript",
    label: "JavaScript",
    description: "JS and JSX syntax highlighting plus project diagnostics.",
    examples: ".js, .jsx, .mjs, .cjs",
    serverOptions: [{ id: "typescript-language-server", label: "TypeScript language server" }],
  },
  {
    id: "typescript",
    label: "TypeScript",
    description: "TS and TSX editor support.",
    examples: ".ts, .tsx, .mts, .cts",
    serverOptions: [{ id: "typescript-language-server", label: "TypeScript language server" }],
  },
  {
    id: "rust",
    label: "Rust",
    description: "Rust editor support and cargo diagnostics.",
    examples: ".rs",
    serverOptions: [{ id: "rust-analyzer", label: "rust-analyzer" }],
  },
  {
    id: "python",
    label: "Python",
    description: "Python syntax support and basic compile diagnostics.",
    examples: ".py",
    serverOptions: [{ id: "pyright-langserver", label: "Pyright language server" }],
  },
  {
    id: "solidity",
    label: "Solidity",
    description: "Solidity syntax support and solhint diagnostics.",
    examples: ".sol",
    serverOptions: [{ id: "solidity-language-server", label: "Solidity language server" }],
  },
  {
    id: "java",
    label: "Java",
    description: "Bundled Monaco Java grammar.",
    examples: ".java",
    serverOptions: [{ id: "jdtls", label: "Eclipse JDT LS" }],
  },
  {
    id: "csharp",
    label: "C#",
    description: "C# syntax support and project-aware language features.",
    examples: ".cs, .csx",
    serverOptions: [{ id: "csharp-ls", label: "C# language server" }],
  },
  {
    id: "cpp",
    label: "C and C++",
    description: "Bundled Monaco C/C++ grammar.",
    examples: ".c, .cc, .cpp, .h, .hpp",
    serverOptions: [{ id: "clangd", label: "clangd" }],
  },
  {
    id: "shell",
    label: "Shell",
    description: "Shell and script files.",
    examples: ".sh, .bash, .zsh, Makefile",
    serverOptions: [],
  },
  {
    id: "json",
    label: "JSON",
    description: "JSON and JSONC config files.",
    examples: ".json, .jsonc",
    serverOptions: [],
  },
  {
    id: "yaml",
    label: "YAML",
    description: "YAML config files and compose manifests.",
    examples: ".yml, .yaml",
    serverOptions: [],
  },
  {
    id: "ini",
    label: "INI and env",
    description: "INI-style config and .env files.",
    examples: ".env, .toml",
    serverOptions: [],
  },
  {
    id: "dockerfile",
    label: "Dockerfile",
    description: "Dockerfile syntax support.",
    examples: "Dockerfile",
    serverOptions: [],
  },
  {
    id: "html",
    label: "HTML",
    description: "HTML templates and static pages with language-server support.",
    examples: ".html",
    serverOptions: [{ id: "vscode-html-language-server", label: "HTML language server" }],
  },
  {
    id: "css",
    label: "CSS",
    description: "Plain CSS stylesheets with language-server support.",
    examples: ".css",
    serverOptions: [{ id: "vscode-css-language-server", label: "CSS language server" }],
  },
  {
    id: "markdown",
    label: "Markdown",
    description: "Markdown notes and docs.",
    examples: ".md, .mdc",
    serverOptions: [],
  },
  {
    id: "mdx",
    label: "MDX",
    description: "MDX documents.",
    examples: ".mdx",
    serverOptions: [],
  },
  {
    id: "xml",
    label: "XML",
    description: "XML documents and config files.",
    examples: ".xml",
    serverOptions: [],
  },
];
