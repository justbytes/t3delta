import type { EnvironmentId } from "@t3delta/contracts";
import {
  evaluateGenericCodeRules,
  evaluateJavaScriptCodeRules,
  evaluateTypeScriptCodeRules,
  hasEnabledGenericCodeRules,
  hasEnabledJavaScriptCodeRules,
  hasEnabledTypeScriptCodeRules,
  isBuiltInJavaScriptTypeScriptRuleConfigFile,
  JAVASCRIPT_EXTENSIONS,
  PROJECT_CODE_RULE_SCAN_MAX_FILES,
  PROJECT_CODE_RULE_SCAN_SKIP_DIRECTORY_NAMES,
  TYPESCRIPT_EXTENSIONS,
} from "@t3delta/shared/projectCodeRules";
import { useCallback, useEffect } from "react";

import { requireEnvironmentConnection } from "../environments/runtime";
import { useThreadEditorStore, type ThreadEditorBufferState } from "../threadEditorStore";
import { useSettings } from "./useSettings";

type DiagnosticCounts = { errors: number; warnings: number };

const EMPTY_THREAD_BUFFERS: Readonly<Record<string, ThreadEditorBufferState>> = {};
const PROJECT_CODE_RULE_SCAN_DEBOUNCE_MS = 250;

function summarizeDiagnostics(
  diagnostics: readonly {
    severity: "error" | "warning" | "information" | "hint";
  }[],
): DiagnosticCounts {
  let errors = 0;
  let warnings = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") {
      errors += 1;
    } else if (diagnostic.severity === "warning") {
      warnings += 1;
    }
  }
  return { errors, warnings };
}

function basenameOfPath(pathValue: string): string {
  return pathValue.split(/[\\/]/).at(-1) ?? pathValue;
}

function shouldSkipDirectoryPath(pathValue: string): boolean {
  return PROJECT_CODE_RULE_SCAN_SKIP_DIRECTORY_NAMES.has(basenameOfPath(pathValue));
}

function fileExtensionOf(pathValue: string): string {
  const filename = basenameOfPath(pathValue);
  const extension = filename.split(".").at(-1);
  return extension === filename ? "" : (extension?.toLowerCase() ?? "");
}

interface LanguageConfig {
  key: "javascript" | "typescript" | "rust" | "python" | "solidity" | "cpp" | "csharp";
  extensions: Set<string>;
  hasEnabled: (rules: Record<string, unknown>) => boolean;
  evaluate: (input: {
    relativePath: string;
    sourceText: string;
    rules: Record<string, unknown>;
  }) => readonly { severity: "error" | "warning" | "information" | "hint" }[];
  skipIfProjectConfig?: boolean;
}

const LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    key: "javascript",
    extensions: JAVASCRIPT_EXTENSIONS,
    hasEnabled: (rules) =>
      hasEnabledJavaScriptCodeRules(rules as Parameters<typeof hasEnabledJavaScriptCodeRules>[0]),
    evaluate: (input) =>
      evaluateJavaScriptCodeRules(input as Parameters<typeof evaluateJavaScriptCodeRules>[0]),
    skipIfProjectConfig: true,
  },
  {
    key: "typescript",
    extensions: TYPESCRIPT_EXTENSIONS,
    hasEnabled: (rules) =>
      hasEnabledTypeScriptCodeRules(rules as Parameters<typeof hasEnabledTypeScriptCodeRules>[0]),
    evaluate: (input) =>
      evaluateTypeScriptCodeRules(input as Parameters<typeof evaluateTypeScriptCodeRules>[0]),
    skipIfProjectConfig: true,
  },
  {
    key: "rust",
    extensions: new Set(["rs"]),
    hasEnabled: (rules) =>
      hasEnabledGenericCodeRules(rules as Parameters<typeof hasEnabledGenericCodeRules>[0]),
    evaluate: (input) =>
      evaluateGenericCodeRules({ ...input, language: "rust" } as Parameters<
        typeof evaluateGenericCodeRules
      >[0]),
  },
  {
    key: "python",
    extensions: new Set(["py", "pyw", "pyi"]),
    hasEnabled: (rules) =>
      hasEnabledGenericCodeRules(rules as Parameters<typeof hasEnabledGenericCodeRules>[0]),
    evaluate: (input) =>
      evaluateGenericCodeRules({ ...input, language: "python" } as Parameters<
        typeof evaluateGenericCodeRules
      >[0]),
  },
  {
    key: "solidity",
    extensions: new Set(["sol"]),
    hasEnabled: (rules) =>
      hasEnabledGenericCodeRules(rules as Parameters<typeof hasEnabledGenericCodeRules>[0]),
    evaluate: (input) =>
      evaluateGenericCodeRules({ ...input, language: "solidity" } as Parameters<
        typeof evaluateGenericCodeRules
      >[0]),
  },
  {
    key: "cpp",
    extensions: new Set(["c", "cc", "cpp", "cxx", "h", "hpp", "hxx"]),
    hasEnabled: (rules) =>
      hasEnabledGenericCodeRules(rules as Parameters<typeof hasEnabledGenericCodeRules>[0]),
    evaluate: (input) =>
      evaluateGenericCodeRules({ ...input, language: "cpp" } as Parameters<
        typeof evaluateGenericCodeRules
      >[0]),
  },
  {
    key: "csharp",
    extensions: new Set(["cs", "csx"]),
    hasEnabled: (rules) =>
      hasEnabledGenericCodeRules(rules as Parameters<typeof hasEnabledGenericCodeRules>[0]),
    evaluate: (input) =>
      evaluateGenericCodeRules({ ...input, language: "csharp" } as Parameters<
        typeof evaluateGenericCodeRules
      >[0]),
  },
];

export function useProjectCodeRuleDiagnostics(input: {
  environmentId: EnvironmentId;
  cwd: string | null;
  threadKey: string;
}) {
  const codeRules = useSettings((settings) => settings.codeRules);
  const replaceProjectRuleDiagnosticCounts = useThreadEditorStore(
    (state) => state.replaceProjectRuleDiagnosticCounts,
  );
  const threadBuffersByPath = useThreadEditorStore(
    useCallback(
      (state) => state.buffersByThreadKey[input.threadKey] ?? EMPTY_THREAD_BUFFERS,
      [input.threadKey],
    ),
  );

  useEffect(() => {
    if (!input.cwd) {
      replaceProjectRuleDiagnosticCounts(input.threadKey, {});
      return;
    }

    // Check if any language has enabled rules
    const hasAnyEnabled = LANGUAGE_CONFIGS.some((config) =>
      config.hasEnabled(codeRules[config.key]),
    );
    if (!hasAnyEnabled) {
      replaceProjectRuleDiagnosticCounts(input.threadKey, {});
      return;
    }

    let cancelled = false;
    const client = requireEnvironmentConnection(input.environmentId).client.projects;

    const timer = window.setTimeout(() => {
      const scanDirectory = async (
        relativePath: string,
        inheritedSkipJsTs: boolean,
        countsByPath: Record<string, DiagnosticCounts>,
        scanState: { scannedFiles: number; truncated: boolean },
      ): Promise<void> => {
        if (cancelled || scanState.truncated) {
          return;
        }

        const directory = await client.listDirectory({
          cwd: input.cwd!,
          ...(relativePath ? { relativePath } : {}),
        });
        if (cancelled || scanState.truncated) {
          return;
        }

        const hasRuleConfigInDirectory = directory.entries.some(
          (entry) =>
            entry.kind === "file" && isBuiltInJavaScriptTypeScriptRuleConfigFile(entry.path),
        );
        const skipJsTs = inheritedSkipJsTs || hasRuleConfigInDirectory;

        // Scan files for each enabled language
        for (const config of LANGUAGE_CONFIGS) {
          if (!config.hasEnabled(codeRules[config.key])) continue;

          const skipThisLanguage = config.skipIfProjectConfig && skipJsTs;
          if (skipThisLanguage) continue;

          const filesToScan = directory.entries.filter(
            (entry) => entry.kind === "file" && config.extensions.has(fileExtensionOf(entry.path)),
          );

          for (const entry of filesToScan) {
            if (cancelled) {
              return;
            }
            if (scanState.scannedFiles >= PROJECT_CODE_RULE_SCAN_MAX_FILES) {
              scanState.truncated = true;
              return;
            }

            scanState.scannedFiles += 1;
            const readResult = await client.readFile({
              cwd: input.cwd!,
              relativePath: entry.path,
            });
            if (cancelled || readResult.kind !== "text") {
              continue;
            }

            const activeBuffer = threadBuffersByPath[entry.path];
            const sourceText =
              activeBuffer?.kind === "text"
                ? activeBuffer.draftContents
                : (readResult.contents ?? "");

            const diagnostics = config.evaluate({
              relativePath: entry.path,
              sourceText,
              rules: codeRules[config.key],
            });
            const counts = summarizeDiagnostics(diagnostics);
            if (counts.errors > 0 || counts.warnings > 0) {
              countsByPath[entry.path] = counts;
            }
          }
        }

        // Recurse into subdirectories
        for (const entry of directory.entries) {
          if (entry.kind !== "directory" || shouldSkipDirectoryPath(entry.path)) {
            continue;
          }
          await scanDirectory(entry.path, skipJsTs, countsByPath, scanState);
          if (cancelled || scanState.truncated) {
            return;
          }
        }
      };

      void (async () => {
        try {
          const countsByPath: Record<string, DiagnosticCounts> = {};
          const scanState = { scannedFiles: 0, truncated: false };
          await scanDirectory("", false, countsByPath, scanState);
          if (cancelled) {
            return;
          }
          if (scanState.truncated) {
            console.warn(
              `[project-code-rules] truncated project diagnostics scan for ${input.cwd} after ${String(scanState.scannedFiles)} files.`,
            );
          }
          replaceProjectRuleDiagnosticCounts(input.threadKey, countsByPath);
        } catch (error) {
          if (cancelled) {
            return;
          }
          console.warn("[project-code-rules] failed to scan project diagnostics", error);
          replaceProjectRuleDiagnosticCounts(input.threadKey, {});
        }
      })();
    }, PROJECT_CODE_RULE_SCAN_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    input.cwd,
    input.environmentId,
    input.threadKey,
    replaceProjectRuleDiagnosticCounts,
    codeRules,
    threadBuffersByPath,
  ]);
}
