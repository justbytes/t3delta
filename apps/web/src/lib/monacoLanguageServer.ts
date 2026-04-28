import type { EnvironmentId, ProjectLanguageServerRange } from "@t3delta/contracts";
import type { IDisposable, languages, Uri } from "monaco-editor";

import { requireEnvironmentConnection } from "../environments/runtime";

interface TypeScriptLanguageServerContext {
  readonly environmentId: EnvironmentId | null;
  readonly cwd: string | null;
  readonly relativePath: string | null;
  readonly serverId: string | null;
}

interface ActiveLanguageServerContext {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly serverId: string;
}

const MONACO_LANGUAGE_SERVER_LANGUAGE_IDS = [
  "typescript",
  "javascript",
  "rust",
  "python",
  "solidity",
  "cpp",
  "java",
  "csharp",
  "html",
  "css",
] as const;

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function isMarkupTagNameContext(
  model: { getLineContent(lineNumber: number): string },
  position: { readonly lineNumber: number; readonly column: number },
): boolean {
  const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  return /<([A-Za-z][\w:-]*)?$/.test(linePrefix);
}

function isPlainMarkupTagCompletion(item: {
  readonly label: string;
  readonly insertText?: string | undefined;
  readonly insertTextFormat?: string | undefined;
}): boolean {
  if (item.insertTextFormat === "snippet") {
    return false;
  }
  const insertText = item.insertText ?? item.label;
  return /^[A-Za-z][\w:-]*$/.test(insertText);
}

function toMarkupTagInsertText(tagName: string): string {
  return VOID_HTML_TAGS.has(tagName.toLowerCase()) ? `${tagName}>` : `${tagName}>$0</${tagName}>`;
}

function toMonacoRange(monaco: typeof import("monaco-editor"), range: ProjectLanguageServerRange) {
  return new monaco.Range(range.startLine, range.startColumn, range.endLine, range.endColumn);
}

function toResourceUri(currentUri: Uri, relativePath: string): Uri {
  return currentUri.with({
    path: relativePath,
    query: "",
    fragment: "",
  });
}

function toCompletionKind(
  monaco: typeof import("monaco-editor"),
  kind: string | undefined,
): languages.CompletionItemKind {
  switch ((kind ?? "").toLowerCase()) {
    case "method":
      return monaco.languages.CompletionItemKind.Method;
    case "function":
      return monaco.languages.CompletionItemKind.Function;
    case "constructor":
      return monaco.languages.CompletionItemKind.Constructor;
    case "field":
      return monaco.languages.CompletionItemKind.Field;
    case "variable":
      return monaco.languages.CompletionItemKind.Variable;
    case "class":
      return monaco.languages.CompletionItemKind.Class;
    case "interface":
      return monaco.languages.CompletionItemKind.Interface;
    case "module":
      return monaco.languages.CompletionItemKind.Module;
    case "property":
      return monaco.languages.CompletionItemKind.Property;
    case "enum":
      return monaco.languages.CompletionItemKind.Enum;
    case "keyword":
      return monaco.languages.CompletionItemKind.Keyword;
    case "snippet":
      return monaco.languages.CompletionItemKind.Snippet;
    case "text":
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}

async function withActiveContext<T>(
  getContext: () => TypeScriptLanguageServerContext,
  run: (context: ActiveLanguageServerContext) => Promise<T>,
): Promise<T | null> {
  const context = getContext();
  if (!context.environmentId || !context.cwd || !context.relativePath || !context.serverId) {
    return null;
  }
  return run({
    environmentId: context.environmentId,
    cwd: context.cwd,
    relativePath: context.relativePath,
    serverId: context.serverId,
  });
}

export function registerMonacoLanguageServerProviders(
  monaco: typeof import("monaco-editor"),
  getContext: () => TypeScriptLanguageServerContext,
): IDisposable[] {
  const hoverProvider = monaco.languages.registerHoverProvider(
    MONACO_LANGUAGE_SERVER_LANGUAGE_IDS,
    {
      provideHover: async (model, position) => {
        const response = await withActiveContext(getContext, async (context) =>
          requireEnvironmentConnection(context.environmentId).client.projects.hoverLanguageServer({
            cwd: context.cwd,
            serverId: context.serverId,
            relativePath: context.relativePath,
            line: position.lineNumber,
            column: position.column,
          }),
        );

        if (!response?.contents) {
          return null;
        }

        return {
          contents: [{ value: response.contents }],
          ...(response.range ? { range: toMonacoRange(monaco, response.range) } : {}),
        };
      },
    },
  );

  const definitionProvider = monaco.languages.registerDefinitionProvider(
    MONACO_LANGUAGE_SERVER_LANGUAGE_IDS,
    {
      provideDefinition: async (model, position) => {
        const response = await withActiveContext(getContext, async (context) =>
          requireEnvironmentConnection(
            context.environmentId,
          ).client.projects.definitionLanguageServer({
            cwd: context.cwd,
            serverId: context.serverId,
            relativePath: context.relativePath,
            line: position.lineNumber,
            column: position.column,
          }),
        );

        if (!response || response.locations.length === 0) {
          return [];
        }

        return response.locations.map((location) => ({
          uri: toResourceUri(model.uri, location.relativePath),
          range: toMonacoRange(monaco, location.range),
        }));
      },
    },
  );

  const referenceProvider = monaco.languages.registerReferenceProvider(
    MONACO_LANGUAGE_SERVER_LANGUAGE_IDS,
    {
      provideReferences: async (model, position) => {
        const response = await withActiveContext(getContext, async (context) =>
          requireEnvironmentConnection(
            context.environmentId,
          ).client.projects.referencesLanguageServer({
            cwd: context.cwd,
            serverId: context.serverId,
            relativePath: context.relativePath,
            line: position.lineNumber,
            column: position.column,
          }),
        );

        if (!response || response.locations.length === 0) {
          return [];
        }

        return response.locations.map((location) => ({
          uri: toResourceUri(model.uri, location.relativePath),
          range: toMonacoRange(monaco, location.range),
        }));
      },
    },
  );

  const completionProvider = monaco.languages.registerCompletionItemProvider(
    MONACO_LANGUAGE_SERVER_LANGUAGE_IDS,
    {
      provideCompletionItems: async (model, position) => {
        const response = await withActiveContext(getContext, async (context) => ({
          context,
          response: await requireEnvironmentConnection(
            context.environmentId,
          ).client.projects.completionLanguageServer({
            cwd: context.cwd,
            serverId: context.serverId,
            relativePath: context.relativePath,
            line: position.lineNumber,
            column: position.column,
          }),
        }));

        if (!response) {
          return { suggestions: [] };
        }

        const shouldSnippetizeHtmlTags =
          response.context.serverId === "vscode-html-language-server" &&
          model.getLanguageId() === "html" &&
          isMarkupTagNameContext(model, position);

        return {
          suggestions: response.response.items.map((item) => {
            const snippetized =
              shouldSnippetizeHtmlTags && isPlainMarkupTagCompletion(item)
                ? toMarkupTagInsertText(item.insertText ?? item.label)
                : null;
            const wordRange = model.getWordUntilPosition(position);

            return {
              label: item.label,
              kind: toCompletionKind(monaco, item.kind),
              insertText: snippetized ?? item.insertText ?? item.label,
              ...(snippetized || item.insertTextFormat === "snippet"
                ? {
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  }
                : {}),
              range: item.range
                ? toMonacoRange(monaco, item.range)
                : new monaco.Range(
                    position.lineNumber,
                    wordRange.startColumn,
                    position.lineNumber,
                    wordRange.endColumn,
                  ),
              ...(item.detail ? { detail: item.detail } : {}),
              ...(item.documentation ? { documentation: item.documentation } : {}),
            };
          }),
        };
      },
      triggerCharacters: [".", '"', "'", "/", "@", "<", ":"],
    },
  );

  const renameProvider = monaco.languages.registerRenameProvider(
    MONACO_LANGUAGE_SERVER_LANGUAGE_IDS,
    {
      provideRenameEdits: async (model, position, newName) => {
        const response = await withActiveContext(getContext, async (context) =>
          requireEnvironmentConnection(context.environmentId).client.projects.renameLanguageServer({
            cwd: context.cwd,
            serverId: context.serverId,
            relativePath: context.relativePath,
            line: position.lineNumber,
            column: position.column,
            newName,
          }),
        );

        if (!response) {
          return { edits: [] };
        }

        return {
          edits: response.edits.map((edit) => ({
            resource: toResourceUri(model.uri, edit.relativePath),
            versionId: undefined,
            textEdit: {
              range: toMonacoRange(monaco, edit.range),
              text: edit.newText,
            },
          })),
        };
      },
      resolveRenameLocation: async (_model, position) => ({
        range: new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column,
        ),
        text: "",
      }),
    },
  );

  return [hoverProvider, definitionProvider, referenceProvider, completionProvider, renameProvider];
}
