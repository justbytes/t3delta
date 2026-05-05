import type { EnvironmentId } from "@t3delta/contracts";
import {
  evaluateBuiltInJavaScriptTypeScriptCodeRules,
  hasEnabledBuiltInJavaScriptTypeScriptCodeRules,
  isBuiltInJavaScriptTypeScriptRuleConfigFile,
  isBuiltInJavaScriptTypeScriptRuleTarget,
  PROJECT_CODE_RULE_SCAN_MAX_FILES,
  PROJECT_CODE_RULE_SCAN_SKIP_DIRECTORY_NAMES,
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

export function useProjectCodeRuleDiagnostics(input: {
  environmentId: EnvironmentId;
  cwd: string | null;
  threadKey: string;
}) {
  const rules = useSettings((settings) => settings.codeRules.javascriptTypeScript);
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
    if (!input.cwd || !hasEnabledBuiltInJavaScriptTypeScriptCodeRules(rules)) {
      replaceProjectRuleDiagnosticCounts(input.threadKey, {});
      return;
    }

    let cancelled = false;
    const client = requireEnvironmentConnection(input.environmentId).client.projects;

    const timer = window.setTimeout(() => {
      const scanDirectory = async (
        relativePath: string,
        inheritedRuleConfig: boolean,
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
        const skipRuleChecks = inheritedRuleConfig || hasRuleConfigInDirectory;

        const filesToScan = skipRuleChecks
          ? []
          : directory.entries.filter(
              (entry) =>
                entry.kind === "file" && isBuiltInJavaScriptTypeScriptRuleTarget(entry.path),
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
          const diagnostics = evaluateBuiltInJavaScriptTypeScriptCodeRules({
            relativePath: entry.path,
            sourceText,
            rules,
          });
          const counts = summarizeDiagnostics(diagnostics);
          if (counts.errors > 0 || counts.warnings > 0) {
            countsByPath[entry.path] = counts;
          }
        }

        for (const entry of directory.entries) {
          if (entry.kind !== "directory" || shouldSkipDirectoryPath(entry.path)) {
            continue;
          }
          await scanDirectory(entry.path, skipRuleChecks, countsByPath, scanState);
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
    rules,
    threadBuffersByPath,
  ]);
}
