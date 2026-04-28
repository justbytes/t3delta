import { DiffsHighlighter, getSharedHighlighter, type SupportedLanguages } from "@pierre/diffs";
import type { EditorCustomAssociation, EditorLanguageId } from "@t3delta/contracts/settings";
import { useEffect, useMemo, useState } from "react";

import { resolveDiffThemeName } from "./diffRendering";
import { basenameOfPath, resolveEditorLanguageForPath } from "../vscode-icons";

const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();
const highlighterLanguageOverrides: Record<string, string> = {
  plaintext: "text",
  shell: "bash",
};

export function resolveEditorLanguage(
  pathValue: string,
  options?: {
    readonly enabledLanguageIds?: readonly EditorLanguageId[];
    readonly customAssociations?: readonly EditorCustomAssociation[];
  },
): string {
  return resolveEditorLanguageForPath(pathValue, options);
}

function resolveHighlighterLanguage(pathValue: string, editorLanguage: string): SupportedLanguages {
  const basename = basenameOfPath(pathValue).toLowerCase();
  if (basename.endsWith(".tsx")) {
    return "tsx";
  }
  if (basename.endsWith(".jsx")) {
    return "jsx";
  }

  return (highlighterLanguageOverrides[editorLanguage] ?? editorLanguage) as SupportedLanguages;
}

function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) {
    return cached;
  }

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch((error) => {
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      throw error;
    }
    return getHighlighterPromise("text");
  });

  highlighterPromiseCache.set(language, promise);
  return promise;
}

export function EditorSyntaxBlock(props: {
  code: string;
  pathValue: string;
  theme: "light" | "dark";
}) {
  const editorLanguage = resolveEditorLanguage(props.pathValue);
  const highlighterLanguage = resolveHighlighterLanguage(props.pathValue, editorLanguage);
  const themeName = resolveDiffThemeName(props.theme);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const plainTextCode = useMemo(() => props.code, [props.code]);

  useEffect(() => {
    let cancelled = false;
    setHighlightedHtml(null);

    void getHighlighterPromise(highlighterLanguage)
      .then((highlighter) => {
        if (cancelled) {
          return;
        }

        try {
          setHighlightedHtml(
            highlighter.codeToHtml(props.code, {
              lang: highlighterLanguage,
              theme: themeName,
            }),
          );
        } catch (error) {
          console.warn(
            `Editor syntax highlighting failed for language "${editorLanguage}", falling back to plain text.`,
            error instanceof Error ? error.message : error,
          );

          try {
            setHighlightedHtml(
              highlighter.codeToHtml(props.code, {
                lang: "text",
                theme: themeName,
              }),
            );
          } catch {
            setHighlightedHtml(null);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn(
            `Editor syntax highlighter failed to initialize for language "${editorLanguage}".`,
            error instanceof Error ? error.message : error,
          );
          setHighlightedHtml(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editorLanguage, highlighterLanguage, props.code, themeName]);

  if (highlightedHtml === null) {
    return (
      <pre className="m-0 min-h-full overflow-visible px-5 py-4 font-mono text-xs leading-[1.55] text-foreground">
        <code>{plainTextCode}</code>
      </pre>
    );
  }

  return (
    <div className="thread-workspace-shiki" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
  );
}
