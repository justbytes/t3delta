import type { CodeRuleSeverity, ProjectDiagnostic, ServerSettings } from "@t3delta/contracts";

// ── Extension sets ───────────────────────────────────────────────

export const JAVASCRIPT_EXTENSIONS = new Set(["js", "jsx", "mjs", "cjs"]);

export const TYPESCRIPT_EXTENSIONS = new Set(["ts", "tsx", "mts", "cts"]);

export const BUILT_IN_JS_TS_RULE_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
] as const;

export const RUST_EXTENSIONS = new Set(["rs"]);

export const PYTHON_EXTENSIONS = new Set(["py", "pyw", "pyi"]);

export const SOLIDITY_EXTENSIONS = new Set(["sol"]);

export const CPP_EXTENSIONS = new Set(["c", "cc", "cpp", "cxx", "h", "hpp", "hxx"]);

export const CSHARP_EXTENSIONS = new Set(["cs", "csx"]);

export const PROJECT_CODE_RULE_SCAN_SKIP_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".next",
  ".nuxt",
  ".turbo",
  ".yarn",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

export const PROJECT_CODE_RULE_SCAN_MAX_FILES = 250;

// ── Type aliases ─────────────────────────────────────────────────

type JavaScriptCodeRules = ServerSettings["codeRules"]["javascript"];
type TypeScriptCodeRules = ServerSettings["codeRules"]["typescript"];
type DiagnosticSeverity = ProjectDiagnostic["severity"];

// ── Helpers ──────────────────────────────────────────────────────

function codeRuleSeverityToDiagnosticSeverity(
  severity: CodeRuleSeverity,
): DiagnosticSeverity | null {
  switch (severity) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    case "off":
      return null;
  }
}

function fileExtensionOf(pathValue: string): string {
  const filename = pathValue.split(/[\\/]/).at(-1) ?? pathValue;
  const extension = filename.split(".").at(-1);
  return extension === filename ? "" : (extension?.toLowerCase() ?? "");
}

function basenameOf(pathValue: string): string {
  return pathValue.split(/[\\/]/).at(-1) ?? pathValue;
}

function isJsFile(pathValue: string): boolean {
  return JAVASCRIPT_EXTENSIONS.has(fileExtensionOf(pathValue));
}

function isTsFile(pathValue: string): boolean {
  return TYPESCRIPT_EXTENSIONS.has(fileExtensionOf(pathValue));
}

// ── Language-specific import extractors ──────────────────────────

function extractJsImportedNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("import ") || !trimmedLine.includes(" from ")) {
    return [];
  }

  const names = new Set<string>();
  const defaultMatch = /^import\s+([A-Za-z_$][\w$]*)\s*(?:,|\s+from)/.exec(trimmedLine);
  if (defaultMatch?.[1] && defaultMatch[1] !== "type") {
    names.add(defaultMatch[1]);
  }

  const namedBlock = /\{([^}]+)\}/.exec(trimmedLine)?.[1];
  if (namedBlock) {
    for (const importedName of namedBlock.split(",")) {
      const localName = importedName
        .trim()
        .split(/\s+as\s+/i)
        .at(-1)
        ?.trim();
      if (localName && /^[A-Za-z_$][\w$]*$/.test(localName)) {
        names.add(localName);
      }
    }
  }

  const namespaceMatch = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(trimmedLine);
  if (namespaceMatch?.[1]) {
    names.add(namespaceMatch[1]);
  }

  return [...names];
}

function extractRustImportedNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("use ")) return [];

  const names = new Set<string>();
  // use crate::module::Item; -> extract Item
  // use crate::module::{Item1, Item2}; -> extract Item1, Item2
  const simpleUse = /use\s+(?:[\w:]+::)?([A-Za-z_]\w*)\s*;/.exec(trimmedLine);
  if (simpleUse?.[1]) names.add(simpleUse[1]);

  const bracedUse = /\{([^}]+)\}/.exec(trimmedLine)?.[1];
  if (bracedUse) {
    for (const part of bracedUse.split(",")) {
      const name = part.trim().split("::").at(-1)?.trim();
      if (
        name &&
        /^[A-Za-z_]\w*$/.test(name) &&
        name !== "self" &&
        name !== "super" &&
        name !== "crate"
      ) {
        names.add(name);
      }
    }
  }

  return [...names];
}

function extractPythonImportedNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  const names = new Set<string>();

  // import os, sys
  const simpleImport = /^import\s+(.+)/.exec(trimmedLine);
  if (simpleImport?.[1]) {
    for (const part of simpleImport[1].split(",")) {
      const name = part.trim().split(".").at(0)?.trim();
      if (name && /^[A-Za-z_]\w*$/.test(name)) names.add(name);
    }
  }

  // from module import name1, name2
  const fromImport = /^from\s+\S+\s+import\s+(.+)/.exec(trimmedLine);
  if (fromImport?.[1]) {
    for (const part of fromImport[1].split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+/i)
        .at(-1)
        ?.trim();
      if (name && /^[A-Za-z_]\w*$/.test(name)) names.add(name);
    }
  }

  return [...names];
}

function extractSolidityImportedNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("import ")) return [];

  const names = new Set<string>();
  // import { symbol1, symbol2 } from "file";
  const namedBlock = /\{([^}]+)\}/.exec(trimmedLine)?.[1];
  if (namedBlock) {
    for (const part of namedBlock.split(",")) {
      const name = part.trim();
      if (name && /^[A-Za-z_]\w*$/.test(name)) names.add(name);
    }
  }

  // import * as name from "file"; (less common in Solidity but valid)
  const namespaceMatch = /\*\s+as\s+([A-Za-z_]\w*)/.exec(trimmedLine);
  if (namespaceMatch?.[1]) {
    names.add(namespaceMatch[1]);
  }

  return [...names];
}

function extractCppImportedNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  // C/C++: #include <header> or #include "header" — no named imports
  // We could track #include lines but they're not "unused imports" in the same sense
  return [];
}

function extractCsharpImportedNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  if (!trimmedLine.startsWith("using ")) return [];

  // using System; -> System
  // using static System.Console; -> Console
  // using MyNamespace = System.Collections.Generic; -> MyNamespace
  const names = new Set<string>();
  const aliasMatch = /^using\s+([A-Za-z_]\w*)\s*=/.exec(trimmedLine);
  if (aliasMatch?.[1]) {
    names.add(aliasMatch[1]);
  } else {
    const namespace = trimmedLine
      .replace(/^using\s+(?:static\s+)?/, "")
      .replace(/;/, "")
      .trim()
      .split(".")
      .at(-1);
    if (namespace && /^[A-Za-z_]\w*$/.test(namespace)) {
      names.add(namespace);
    }
  }

  return [...names];
}

// ── Language-specific variable extractors ────────────────────────

function extractJsVariableNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  if (!/^(?:export\s+)?(?:const|let|var)\s+/.test(trimmedLine)) return [];
  if (trimmedLine.startsWith("export ")) return [];

  const names = new Set<string>();
  for (const match of trimmedLine.matchAll(/([A-Za-z_$][\w$]*)\s*(?::[^=,;]+)?\s*=/g)) {
    const variableName = match[1];
    if (variableName && !variableName.startsWith("_")) names.add(variableName);
  }

  const iterationMatch = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/.exec(trimmedLine);
  if (iterationMatch?.[1] && !iterationMatch[1].startsWith("_")) {
    names.add(iterationMatch[1]);
  }

  return [...names];
}

function extractRustVariableNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  // let x = 5; let mut y = 10; const Z: i32 = 0;
  if (!/^(?:let|const)\s+(?:mut\s+)?/.test(trimmedLine)) return [];

  const names = new Set<string>();
  const match = /^(?:let|const)\s+(?:mut\s+)?([A-Za-z_]\w*)/.exec(trimmedLine);
  if (match?.[1] && !match[1].startsWith("_")) names.add(match[1]);

  return [...names];
}

function extractPythonVariableNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  // x = 1 (but not ==, >=, <=, +=, -=)
  const assignmentMatch = /^([A-Za-z_]\w*)\s*(?:,\s*[A-Za-z_]\w*)*\s*=/.exec(trimmedLine);
  if (!assignmentMatch) return [];

  const names = new Set<string>();
  const beforeEquals = trimmedLine.split("=")[0];
  if (!beforeEquals) return [];
  for (const part of beforeEquals.split(",")) {
    const name = part.trim();
    if (name && !name.startsWith("_") && /^[A-Za-z_]\w*$/.test(name)) names.add(name);
  }

  return [...names];
}

function extractSolidityVariableNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  // uint256 x = 1; string name = "a"; address addr;
  const match =
    /\b(?:uint\d*|int\d*|bool|address|string|bytes\d*)\s+(?:\w+\s+)?([A-Za-z_]\w*)\s*(?:=|;)/.exec(
      trimmedLine,
    );
  if (!match?.[1] || match[1].startsWith("_")) return [];

  return [match[1]];
}

function extractCppVariableNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  // int x = 1; std::string s; auto y = 2;
  // Skip lines that look like function declarations (have parentheses after name)
  if (/\b[A-Za-z_]\w*\s+[A-Za-z_]\w*\s*\(/.test(trimmedLine)) return [];

  const match =
    /\b(?:int|float|double|char|bool|auto|void|string|vector|map|std::\w+)\s+(?:\*\s*)?(?:const\s+)?([A-Za-z_]\w*)\s*(?:=|;|\[)/.exec(
      trimmedLine,
    );
  if (!match?.[1] || match[1].startsWith("_")) return [];

  return [match[1]];
}

function extractCsharpVariableNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  // var x = 1; string s = "a"; int n;
  // Skip lines that look like method declarations
  if (/\b(?:public|private|protected|internal|static|void|Task)\b/.test(trimmedLine)) return [];

  const match =
    /\b(?:var|string|int|bool|double|float|decimal|DateTime|List<[^>]+>)\s+([A-Za-z_]\w*)\s*(?:=|;)/.exec(
      trimmedLine,
    );
  if (!match?.[1] || match[1].startsWith("_")) return [];

  return [match[1]];
}

// ── Language rule configurations ─────────────────────────────────

interface LanguageRuleConfig {
  extensions: Set<string>;
  extractImports: (line: string) => readonly string[];
  extractVariables: (line: string) => readonly string[];
  extractExtra?: (line: string) => readonly { code: string; column: number; message: string }[];
  importMessage: (name: string) => string;
  variableMessage: (name: string) => string;
}

const LANGUAGE_RULE_CONFIGS: Record<string, LanguageRuleConfig> = {
  javascript: {
    extensions: JAVASCRIPT_EXTENSIONS,
    extractImports: extractJsImportedNames,
    extractVariables: extractJsVariableNames,
    extractExtra: (line) => {
      const trimmedLine = line.trim();
      const diagnostics: { code: string; column: number; message: string }[] = [];
      // noConsole
      const consoleMatch = /\bconsole\.(log|warn|error|info|debug)\b/.exec(trimmedLine);
      if (consoleMatch) {
        diagnostics.push({
          code: "no-console",
          column: consoleMatch.index + 1,
          message: "Avoid console statements in production code.",
        });
      }
      return diagnostics;
    },
    importMessage: (name) => `Imported name \`${name}\` is not used in this file.`,
    variableMessage: (name) => `Variable \`${name}\` is declared but never used in this file.`,
  },
  typescript: {
    extensions: TYPESCRIPT_EXTENSIONS,
    extractImports: extractJsImportedNames,
    extractVariables: extractJsVariableNames,
    extractExtra: (line) => {
      const trimmedLine = line.trim();
      const diagnostics: { code: string; column: number; message: string }[] = [];
      // noConsole
      const consoleMatch = /\bconsole\.(log|warn|error|info|debug)\b/.exec(trimmedLine);
      if (consoleMatch) {
        diagnostics.push({
          code: "no-console",
          column: consoleMatch.index + 1,
          message: "Avoid console statements in production code.",
        });
      }
      return diagnostics;
    },
    importMessage: (name) => `Imported name \`${name}\` is not used in this file.`,
    variableMessage: (name) => `Variable \`${name}\` is declared but never used in this file.`,
  },
  rust: {
    extensions: RUST_EXTENSIONS,
    extractImports: extractRustImportedNames,
    extractVariables: extractRustVariableNames,
    extractExtra: (line) => {
      const trimmedLine = line.trim();
      const diagnostics: { code: string; column: number; message: string }[] = [];
      // unwrapUsage
      const unwrapMatch = /\.(unwrap|expect)\s*\(/.exec(trimmedLine);
      if (unwrapMatch) {
        diagnostics.push({
          code: "no-unwrap",
          column: unwrapMatch.index + 2,
          message: `Avoid \`${unwrapMatch[1]}()\` in production code; prefer proper error handling.`,
        });
      }
      return diagnostics;
    },
    importMessage: (name) => `Imported item \`${name}\` is not used in this file.`,
    variableMessage: (name) => `Variable \`${name}\` is declared but never used in this file.`,
  },
  python: {
    extensions: PYTHON_EXTENSIONS,
    extractImports: extractPythonImportedNames,
    extractVariables: extractPythonVariableNames,
    extractExtra: (line) => {
      const trimmedLine = line.trim();
      const diagnostics: { code: string; column: number; message: string }[] = [];
      // bareExcept
      const bareExceptMatch = /^except\s*:/.exec(trimmedLine);
      if (bareExceptMatch) {
        diagnostics.push({
          code: "no-bare-except",
          column: bareExceptMatch.index + 1,
          message:
            "Bare `except:` catches KeyboardInterrupt and SystemExit; use `except Exception:` instead.",
        });
      }
      return diagnostics;
    },
    importMessage: (name) => `Imported name \`${name}\` is not used in this file.`,
    variableMessage: (name) => `Variable \`${name}\` is assigned but never used in this file.`,
  },
  solidity: {
    extensions: SOLIDITY_EXTENSIONS,
    extractImports: extractSolidityImportedNames,
    extractVariables: extractSolidityVariableNames,
    extractExtra: (line) => {
      const trimmedLine = line.trim();
      const diagnostics: { code: string; column: number; message: string }[] = [];
      // txOriginUsage
      const txOriginMatch = /\btx\.origin\b/.exec(trimmedLine);
      if (txOriginMatch) {
        diagnostics.push({
          code: "no-tx-origin",
          column: txOriginMatch.index + 1,
          message:
            "Avoid `tx.origin` for authorization; it is vulnerable to phishing attacks. Use `msg.sender` instead.",
        });
      }
      return diagnostics;
    },
    importMessage: (name) => `Imported symbol \`${name}\` is not used in this file.`,
    variableMessage: (name) => `Variable \`${name}\` is declared but never used in this file.`,
  },
  cpp: {
    extensions: CPP_EXTENSIONS,
    extractImports: extractCppImportedNames,
    extractVariables: extractCppVariableNames,
    importMessage: () => "", // C/C++ doesn't have named imports in the same sense
    variableMessage: (name) => `Variable \`${name}\` is declared but never used in this file.`,
  },
  csharp: {
    extensions: CSHARP_EXTENSIONS,
    extractImports: extractCsharpImportedNames,
    extractVariables: extractCsharpVariableNames,
    importMessage: (name) => `Using directive \`${name}\` is not used in this file.`,
    variableMessage: (name) => `Variable \`${name}\` is declared but never used in this file.`,
  },
};

// ── Generic rule evaluator for all languages ─────────────────────

export function hasEnabledGenericCodeRules(rules: Record<string, unknown>): boolean {
  return (
    codeRuleSeverityToDiagnosticSeverity(rules.maxFileLinesSeverity as CodeRuleSeverity) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.unusedImports as CodeRuleSeverity) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.unusedVariables as CodeRuleSeverity) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.unwrapUsage as CodeRuleSeverity) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.bareExcept as CodeRuleSeverity) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.txOriginUsage as CodeRuleSeverity) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.noConsole as CodeRuleSeverity) !== null
  );
}

export function evaluateGenericCodeRules(input: {
  relativePath: string;
  sourceText: string;
  rules: Record<string, unknown>;
  language: keyof typeof LANGUAGE_RULE_CONFIGS;
}): readonly ProjectDiagnostic[] {
  const config = LANGUAGE_RULE_CONFIGS[input.language];
  if (!config) return [];
  if (!config.extensions.has(fileExtensionOf(input.relativePath))) return [];

  const maxFileLinesSeverity = codeRuleSeverityToDiagnosticSeverity(
    input.rules.maxFileLinesSeverity as CodeRuleSeverity,
  );
  const unusedImportsSeverity = codeRuleSeverityToDiagnosticSeverity(
    input.rules.unusedImports as CodeRuleSeverity,
  );
  const unusedVariablesSeverity = codeRuleSeverityToDiagnosticSeverity(
    input.rules.unusedVariables as CodeRuleSeverity,
  );
  const extraSeverity = codeRuleSeverityToDiagnosticSeverity(
    (input.rules.unwrapUsage ??
      input.rules.bareExcept ??
      input.rules.txOriginUsage ??
      input.rules.noConsole) as CodeRuleSeverity,
  );

  if (!maxFileLinesSeverity && !unusedImportsSeverity && !unusedVariablesSeverity && !extraSeverity)
    return [];

  const lines = input.sourceText.split(/\r\n|\r|\n/);
  const diagnostics: ProjectDiagnostic[] = [];

  if (maxFileLinesSeverity) {
    evaluateMaxFileLines(
      input.relativePath,
      lines,
      input.rules.maxFileLines as number,
      maxFileLinesSeverity,
      diagnostics,
    );
  }

  if (unusedImportsSeverity) {
    lines.forEach((line, index) => {
      const importedNames = config.extractImports(line);
      for (const importedName of importedNames) {
        // Count usages that are NOT in the same import line
        const usagePattern = new RegExp(`\\b${importedName}\\b`, "g");
        let usageCount = 0;
        for (const match of input.sourceText.matchAll(usagePattern)) {
          const matchLine = input.sourceText.substring(0, match.index).split(/\r\n|\r|\n/).length;
          if (matchLine !== index + 1) {
            usageCount += 1;
          }
        }
        if (usageCount > 0) continue;
        const column = line.indexOf(importedName) + 1;
        if (column > 0) {
          diagnostics.push({
            relativePath: input.relativePath,
            line: index + 1,
            column: Math.max(1, column),
            endLine: index + 1,
            endColumn: Math.max(1, column + importedName.length),
            severity: unusedImportsSeverity,
            source: "t3delta-rules",
            message: config.importMessage(importedName),
            code: "no-unused-imports",
          });
        }
      }
    });
  }

  if (unusedVariablesSeverity) {
    lines.forEach((line, index) => {
      const declaredNames = config.extractVariables(line);
      for (const declaredName of declaredNames) {
        const usagePattern = new RegExp(`\\b${declaredName}\\b`, "g");
        const usageCount = [...input.sourceText.matchAll(usagePattern)].length;
        if (usageCount > 1) continue;
        const column = line.indexOf(declaredName) + 1;
        if (column > 0) {
          diagnostics.push({
            relativePath: input.relativePath,
            line: index + 1,
            column: Math.max(1, column),
            endLine: index + 1,
            endColumn: Math.max(1, column + declaredName.length),
            severity: unusedVariablesSeverity,
            source: "t3delta-rules",
            message: config.variableMessage(declaredName),
            code: "no-unused-variables",
          });
        }
      }
    });
  }

  // Extra language-specific rules (noConsole, unwrapUsage, bareExcept, txOriginUsage)
  const extraRules = [
    { key: "noConsole", code: "no-console" },
    { key: "unwrapUsage", code: "no-unwrap" },
    { key: "bareExcept", code: "no-bare-except" },
    { key: "txOriginUsage", code: "no-tx-origin" },
  ];

  for (const extraRule of extraRules) {
    const severity = codeRuleSeverityToDiagnosticSeverity(
      input.rules[extraRule.key] as CodeRuleSeverity,
    );
    if (!severity || !config.extractExtra) continue;

    lines.forEach((line, index) => {
      const extraDiagnostics = config.extractExtra!(line);
      for (const extra of extraDiagnostics) {
        if (extra.code !== extraRule.code) continue;
        diagnostics.push({
          relativePath: input.relativePath,
          line: index + 1,
          column: Math.max(1, extra.column),
          endLine: index + 1,
          endColumn: Math.max(1, extra.column + 10),
          severity,
          source: "t3delta-rules",
          message: extra.message,
          code: extra.code,
        });
      }
    });
  }

  return diagnostics;
}

// ── JavaScript rules (backward compat) ───────────────────────────

export function hasEnabledJavaScriptCodeRules(rules: JavaScriptCodeRules): boolean {
  return (
    hasEnabledGenericCodeRules(rules) ||
    codeRuleSeverityToDiagnosticSeverity(rules.noConsole) !== null
  );
}

export function evaluateJavaScriptCodeRules(input: {
  relativePath: string;
  sourceText: string;
  rules: JavaScriptCodeRules;
}): readonly ProjectDiagnostic[] {
  return evaluateGenericCodeRules({ ...input, language: "javascript" });
}

// ── TypeScript rules (backward compat) ───────────────────────────

export function hasEnabledTypeScriptCodeRules(rules: TypeScriptCodeRules): boolean {
  return (
    hasEnabledGenericCodeRules(rules) ||
    codeRuleSeverityToDiagnosticSeverity(rules.explicitAny) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.noConsole) !== null
  );
}

export function evaluateTypeScriptCodeRules(input: {
  relativePath: string;
  sourceText: string;
  rules: TypeScriptCodeRules;
}): readonly ProjectDiagnostic[] {
  if (!isTsFile(input.relativePath)) return [];

  const diagnostics: ProjectDiagnostic[] = [
    ...evaluateGenericCodeRules({
      relativePath: input.relativePath,
      sourceText: input.sourceText,
      rules: input.rules,
      language: "typescript",
    }),
  ];

  const explicitAnySeverity = codeRuleSeverityToDiagnosticSeverity(input.rules.explicitAny);
  if (explicitAnySeverity) {
    const lines = input.sourceText.split(/\r\n|\r|\n/);
    lines.forEach((line, index) => {
      const match = /\bany\b/.exec(line);
      if (!match) return;
      const column = match.index + 1;
      diagnostics.push({
        relativePath: input.relativePath,
        line: index + 1,
        column,
        endLine: index + 1,
        endColumn: column + 3,
        severity: explicitAnySeverity,
        source: "t3delta-rules",
        message: "Avoid explicit `any` in TypeScript files without project lint rules.",
        code: "no-explicit-any",
      });
    });
  }

  return diagnostics;
}

// ── Max-file-lines helper ────────────────────────────────────────

function evaluateMaxFileLines(
  relativePath: string,
  lines: readonly string[],
  maxFileLines: number,
  severity: DiagnosticSeverity | null,
  diagnostics: ProjectDiagnostic[],
): void {
  if (!severity || lines.length <= maxFileLines) return;

  const firstOverflowLine = maxFileLines + 1;
  const lastLine = lines.length;
  const lastLineText = lines.at(-1) ?? "";
  diagnostics.push({
    relativePath,
    line: firstOverflowLine,
    column: 1,
    endLine: lastLine,
    endColumn: Math.max(1, lastLineText.length + 1),
    severity,
    source: "t3delta-rules",
    message: `File has ${lines.length} lines. The current app default is ${maxFileLines}.`,
    code: "max-file-lines",
  });
}

// ── Config file detection ──────────────────────────────────────

export function isBuiltInJavaScriptTypeScriptRuleConfigFile(pathValue: string): boolean {
  return BUILT_IN_JS_TS_RULE_CONFIG_FILES.includes(
    basenameOf(pathValue) as (typeof BUILT_IN_JS_TS_RULE_CONFIG_FILES)[number],
  );
}
