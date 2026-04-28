import type { IDisposable, editor } from "monaco-editor";

type Monaco = typeof import("monaco-editor");

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

function shouldAutoCloseModel(model: editor.ITextModel): boolean {
  if (model.getLanguageId() === "html") {
    return true;
  }
  return /\.(jsx|tsx)$/i.test(model.uri.path);
}

function getOpeningTagBeforeCursor(linePrefix: string): string | null {
  const match = linePrefix.match(/<([A-Za-z][\w:-]*)(?:\s[^<>]*)?>$/);
  const tagName = match?.[1];
  if (!tagName) {
    return null;
  }
  if (linePrefix.endsWith("/>") || VOID_HTML_TAGS.has(tagName.toLowerCase())) {
    return null;
  }
  return tagName;
}

export function registerMonacoAutoCloseTags(
  editorInstance: editor.IStandaloneCodeEditor,
  monaco: Monaco,
): IDisposable {
  return editorInstance.onDidChangeModelContent((event) => {
    if (!event.changes.some((change) => change.text.endsWith(">"))) {
      return;
    }

    const model = editorInstance.getModel();
    const position = editorInstance.getPosition();
    if (!model || !position || !shouldAutoCloseModel(model)) {
      return;
    }

    const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    const tagName = getOpeningTagBeforeCursor(linePrefix);
    if (!tagName) {
      return;
    }

    const lineSuffix = model.getLineContent(position.lineNumber).slice(position.column - 1);
    if (lineSuffix.startsWith(`</${tagName}>`)) {
      return;
    }

    const insertPosition = new monaco.Position(position.lineNumber, position.column);
    editorInstance.executeEdits("t3delta.auto-close-tag", [
      {
        range: new monaco.Range(
          insertPosition.lineNumber,
          insertPosition.column,
          insertPosition.lineNumber,
          insertPosition.column,
        ),
        text: `</${tagName}>`,
        forceMoveMarkers: true,
      },
    ]);
    editorInstance.setPosition(insertPosition);
  });
}
