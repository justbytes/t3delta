import type { IDisposable, editor } from "monaco-editor";

type Monaco = typeof import("monaco-editor");

const MARKUP_TAG_LANGUAGES = ["html", "javascript", "typescript"] as const;

const HTML_TAGS = [
  "a",
  "article",
  "aside",
  "button",
  "circle",
  "code",
  "defs",
  "div",
  "em",
  "footer",
  "form",
  "g",
  "h1",
  "h2",
  "h3",
  "header",
  "img",
  "input",
  "label",
  "li",
  "main",
  "nav",
  "option",
  "path",
  "p",
  "rect",
  "section",
  "select",
  "span",
  "strong",
  "svg",
  "textarea",
  "ul",
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

type MarkupFlavor = "html" | "jsx";

function getMarkupFlavor(model: editor.ITextModel): MarkupFlavor | null {
  if (model.getLanguageId() === "html") {
    return "html";
  }
  if (/\.(jsx|tsx)$/i.test(model.uri.path)) {
    return "jsx";
  }
  return null;
}

function getTagPrefix(linePrefix: string): string | null {
  const match = linePrefix.match(/<([A-Za-z][\w:-]*)?$/);
  return match?.[1] ?? "";
}

function toTagRange(
  monaco: Monaco,
  position: { readonly lineNumber: number; readonly column: number },
  prefix: string,
) {
  const startColumn = position.column - prefix.length;
  return new monaco.Range(position.lineNumber, startColumn, position.lineNumber, position.column);
}

function toMarkupInsertText(tagName: string, flavor: MarkupFlavor): string {
  if (VOID_HTML_TAGS.has(tagName)) {
    return flavor === "jsx" ? `${tagName} />` : `${tagName}>`;
  }
  return `${tagName}>$0</${tagName}>`;
}

export function registerMonacoJsxTagCompletions(monaco: Monaco): IDisposable {
  return monaco.languages.registerCompletionItemProvider(MARKUP_TAG_LANGUAGES, {
    provideCompletionItems: (model, position) => {
      const markupFlavor = getMarkupFlavor(model);
      if (!markupFlavor) {
        return { suggestions: [] };
      }

      const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const tagPrefix = getTagPrefix(linePrefix);
      if (tagPrefix === null) {
        return { suggestions: [] };
      }

      const range = toTagRange(monaco, position, tagPrefix);
      const normalizedPrefix = tagPrefix.toLowerCase();
      const suggestions = HTML_TAGS.filter((tagName) => tagName.startsWith(normalizedPrefix)).map(
        (tagName) => ({
          label: tagName,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: toMarkupInsertText(tagName, markupFlavor),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: `0-${tagName}`,
        }),
      );

      return { suggestions };
    },
    triggerCharacters: ["<"],
  });
}
