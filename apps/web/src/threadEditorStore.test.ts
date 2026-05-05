import { describe, expect, it } from "vitest";

import { useThreadEditorStore } from "./threadEditorStore";

const THREAD_KEY = "environment:thread";
const FILE_PATH = "src/demo.ts";

describe("threadEditorStore", () => {
  it("does not overwrite dirty text buffers when a reread arrives", () => {
    useThreadEditorStore.setState({
      buffersByThreadKey: {},
      editorDiagnosticCountsByThreadKey: {},
      projectRuleDiagnosticCountsByThreadKey: {},
    });

    const { receiveReadResult, updateDraft } = useThreadEditorStore.getState();

    receiveReadResult(THREAD_KEY, {
      relativePath: FILE_PATH,
      kind: "text",
      byteLength: 12,
      modifiedAt: 1,
      contents: "const a = 1;",
    });
    updateDraft(THREAD_KEY, FILE_PATH, "const a = 2;");
    receiveReadResult(THREAD_KEY, {
      relativePath: FILE_PATH,
      kind: "text",
      byteLength: 12,
      modifiedAt: 2,
      contents: "const a = 3;",
    });

    const buffer = useThreadEditorStore.getState().buffersByThreadKey[THREAD_KEY]?.[FILE_PATH];
    expect(buffer).toMatchObject({
      kind: "text",
      savedContents: "const a = 1;",
      draftContents: "const a = 2;",
    });
  });

  it("replaces project rule diagnostic counts for a thread", () => {
    useThreadEditorStore.setState({
      buffersByThreadKey: {},
      editorDiagnosticCountsByThreadKey: {},
      projectRuleDiagnosticCountsByThreadKey: {},
    });

    const { replaceProjectRuleDiagnosticCounts } = useThreadEditorStore.getState();
    replaceProjectRuleDiagnosticCounts(THREAD_KEY, {
      "src/a.ts": { errors: 1, warnings: 0 },
    });
    replaceProjectRuleDiagnosticCounts(THREAD_KEY, {
      "src/b.ts": { errors: 0, warnings: 2 },
    });

    expect(
      useThreadEditorStore.getState().projectRuleDiagnosticCountsByThreadKey[THREAD_KEY],
    ).toEqual({
      "src/b.ts": { errors: 0, warnings: 2 },
    });
  });
});
