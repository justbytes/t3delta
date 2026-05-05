import type { CodeRuleSeverity, ProjectDiagnostic, ServerSettings } from "@t3delta/contracts";

export const BUILT_IN_JS_TS_RULE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
]);

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

type JavaScriptTypeScriptCodeRules = ServerSettings["codeRules"]["javascriptTypeScript"];
type DiagnosticSeverity = ProjectDiagnostic["severity"];

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

function findExplicitAnyColumn(line: string): number | null {
  const match = /\bany\b/.exec(line);
  return match ? match.index + 1 : null;
}

function extractImportedNames(line: string): readonly string[] {
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

function extractDeclaredVariableNames(line: string): readonly string[] {
  const trimmedLine = line.trim();
  if (!/^(?:export\s+)?(?:const|let|var)\s+/.test(trimmedLine)) {
    return [];
  }
  if (trimmedLine.startsWith("export ")) {
    return [];
  }

  const names = new Set<string>();
  for (const match of trimmedLine.matchAll(/([A-Za-z_$][\w$]*)\s*(?::[^=,;]+)?\s*=/g)) {
    const variableName = match[1];
    if (variableName && !variableName.startsWith("_")) {
      names.add(variableName);
    }
  }

  const iterationMatch = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\b/.exec(trimmedLine);
  if (iterationMatch?.[1] && !iterationMatch[1].startsWith("_")) {
    names.add(iterationMatch[1]);
  }

  return [...names];
}

function fileExtensionOf(pathValue: string): string {
  const filename = pathValue.split(/[\\/]/).at(-1) ?? pathValue;
  const extension = filename.split(".").at(-1);
  return extension === filename ? "" : (extension?.toLowerCase() ?? "");
}

function basenameOf(pathValue: string): string {
  return pathValue.split(/[\\/]/).at(-1) ?? pathValue;
}

export function hasEnabledBuiltInJavaScriptTypeScriptCodeRules(
  rules: JavaScriptTypeScriptCodeRules,
): boolean {
  return (
    codeRuleSeverityToDiagnosticSeverity(rules.maxFileLinesSeverity) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.explicitAny) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.unusedImports) !== null ||
    codeRuleSeverityToDiagnosticSeverity(rules.unusedVariables) !== null
  );
}

export function isBuiltInJavaScriptTypeScriptRuleTarget(pathValue: string): boolean {
  return BUILT_IN_JS_TS_RULE_EXTENSIONS.has(fileExtensionOf(pathValue));
}

export function isBuiltInJavaScriptTypeScriptRuleConfigFile(pathValue: string): boolean {
  return BUILT_IN_JS_TS_RULE_CONFIG_FILES.includes(
    basenameOf(pathValue) as (typeof BUILT_IN_JS_TS_RULE_CONFIG_FILES)[number],
  );
}

export function evaluateBuiltInJavaScriptTypeScriptCodeRules(input: {
  relativePath: string;
  sourceText: string;
  rules: JavaScriptTypeScriptCodeRules;
}): readonly ProjectDiagnostic[] {
  if (!isBuiltInJavaScriptTypeScriptRuleTarget(input.relativePath)) {
    return [];
  }

  const maxFileLinesSeverity = codeRuleSeverityToDiagnosticSeverity(
    input.rules.maxFileLinesSeverity,
  );
  const explicitAnySeverity = codeRuleSeverityToDiagnosticSeverity(input.rules.explicitAny);
  const unusedImportsSeverity = codeRuleSeverityToDiagnosticSeverity(input.rules.unusedImports);
  const unusedVariablesSeverity = codeRuleSeverityToDiagnosticSeverity(input.rules.unusedVariables);
  if (
    !maxFileLinesSeverity &&
    !explicitAnySeverity &&
    !unusedImportsSeverity &&
    !unusedVariablesSeverity
  ) {
    return [];
  }

  const lines = input.sourceText.split(/\r\n|\r|\n/);
  const diagnostics: ProjectDiagnostic[] = [];

  if (maxFileLinesSeverity && lines.length > input.rules.maxFileLines) {
    const firstOverflowLine = input.rules.maxFileLines + 1;
    const lastLine = lines.length;
    const lastLineText = lines.at(-1) ?? "";
    diagnostics.push({
      relativePath: input.relativePath,
      line: firstOverflowLine,
      column: 1,
      endLine: lastLine,
      endColumn: Math.max(1, lastLineText.length + 1),
      severity: maxFileLinesSeverity,
      source: "t3delta-rules",
      message: `File has ${lines.length} lines. The current app default is ${input.rules.maxFileLines}.`,
      code: "max-file-lines",
    });
  }

  if (explicitAnySeverity) {
    lines.forEach((line, index) => {
      const column = findExplicitAnyColumn(line);
      if (!column) {
        return;
      }
      diagnostics.push({
        relativePath: input.relativePath,
        line: index + 1,
        column,
        endLine: index + 1,
        endColumn: column + 3,
        severity: explicitAnySeverity,
        source: "t3delta-rules",
        message: "Avoid explicit `any` in JS/TS files without project lint rules.",
        code: "no-explicit-any",
      });
    });
  }

  if (unusedImportsSeverity) {
    lines.forEach((line, index) => {
      const importedNames = extractImportedNames(line);
      for (const importedName of importedNames) {
        const usagePattern = new RegExp(`\\b${importedName}\\b`, "g");
        const usageCount = [...input.sourceText.matchAll(usagePattern)].length;
        if (usageCount > 1) {
          continue;
        }
        const column = line.indexOf(importedName) + 1;
        diagnostics.push({
          relativePath: input.relativePath,
          line: index + 1,
          column: Math.max(1, column),
          endLine: index + 1,
          endColumn: Math.max(1, column + importedName.length),
          severity: unusedImportsSeverity,
          source: "t3delta-rules",
          message: `Imported name \`${importedName}\` is not used in this file.`,
          code: "no-unused-imports",
        });
      }
    });
  }

  if (unusedVariablesSeverity) {
    lines.forEach((line, index) => {
      const declaredNames = extractDeclaredVariableNames(line);
      for (const declaredName of declaredNames) {
        const usagePattern = new RegExp(`\\b${declaredName}\\b`, "g");
        const usageCount = [...input.sourceText.matchAll(usagePattern)].length;
        if (usageCount > 1) {
          continue;
        }
        const column = line.indexOf(declaredName) + 1;
        diagnostics.push({
          relativePath: input.relativePath,
          line: index + 1,
          column: Math.max(1, column),
          endLine: index + 1,
          endColumn: Math.max(1, column + declaredName.length),
          severity: unusedVariablesSeverity,
          source: "t3delta-rules",
          message: `Variable \`${declaredName}\` is declared but never used in this file.`,
          code: "no-unused-variables",
        });
      }
    });
  }

  return diagnostics;
}
