import type { ProjectReadFileResult } from "@t3delta/contracts";
import { create } from "zustand";

type NonTextBufferKind = "binary" | "tooLarge" | "unsupportedEncoding";

export type ThreadEditorBufferState =
  | {
      kind: "loading";
      relativePath: string;
    }
  | {
      kind: "error";
      relativePath: string;
      error: string;
    }
  | {
      kind: "text";
      relativePath: string;
      byteLength: number;
      modifiedAt: number;
      savedContents: string;
      draftContents: string;
      isSaving: boolean;
      saveError: string | null;
      mediaType?: string;
      dataUrl?: string;
    }
  | {
      kind: NonTextBufferKind;
      relativePath: string;
      byteLength: number;
      modifiedAt: number;
      mediaType?: string;
      dataUrl?: string;
    };

interface ThreadEditorStoreState {
  buffersByThreadKey: Record<string, Record<string, ThreadEditorBufferState>>;
  diagnosticsByThreadKey: Record<string, Record<string, { errors: number; warnings: number }>>;
  ensureLoadingBuffer: (threadKey: string, filePath: string) => void;
  receiveReadResult: (threadKey: string, result: ProjectReadFileResult) => void;
  setLoadError: (threadKey: string, filePath: string, error: string) => void;
  setDiagnosticCounts: (
    threadKey: string,
    filePath: string,
    counts: { errors: number; warnings: number },
  ) => void;
  updateDraft: (threadKey: string, filePath: string, contents: string) => void;
  resetDraft: (threadKey: string, filePath: string) => void;
  setSaving: (threadKey: string, filePath: string, isSaving: boolean) => void;
  setSaveError: (threadKey: string, filePath: string, error: string | null) => void;
  commitSavedDraft: (threadKey: string, filePath: string) => void;
}

const textEncoder = new TextEncoder();

function updateThreadBuffers(
  state: ThreadEditorStoreState,
  threadKey: string,
  update: (
    currentThreadBuffers: Record<string, ThreadEditorBufferState>,
  ) => Record<string, ThreadEditorBufferState>,
): ThreadEditorStoreState {
  const currentThreadBuffers = state.buffersByThreadKey[threadKey] ?? {};
  const nextThreadBuffers = update(currentThreadBuffers);
  if (nextThreadBuffers === currentThreadBuffers) {
    return state;
  }

  return {
    ...state,
    buffersByThreadKey: {
      ...state.buffersByThreadKey,
      [threadKey]: nextThreadBuffers,
    },
  };
}

export const useThreadEditorStore = create<ThreadEditorStoreState>((set) => ({
  buffersByThreadKey: {},
  diagnosticsByThreadKey: {},
  ensureLoadingBuffer: (threadKey, filePath) =>
    set((state) =>
      updateThreadBuffers(state, threadKey, (currentThreadBuffers) => {
        if (currentThreadBuffers[filePath]) {
          return currentThreadBuffers;
        }
        return {
          ...currentThreadBuffers,
          [filePath]: {
            kind: "loading",
            relativePath: filePath,
          },
        };
      }),
    ),
  receiveReadResult: (threadKey, result) =>
    set((state) =>
      updateThreadBuffers(state, threadKey, (currentThreadBuffers) => {
        const currentBuffer = currentThreadBuffers[result.relativePath];
        if (result.kind === "text") {
          const nextContents = result.contents ?? "";
          if (currentBuffer?.kind === "text") {
            const isDirty = currentBuffer.draftContents !== currentBuffer.savedContents;
            if (isDirty) {
              return currentThreadBuffers;
            }
          }

          return {
            ...currentThreadBuffers,
            [result.relativePath]: {
              kind: "text",
              relativePath: result.relativePath,
              byteLength: result.byteLength,
              modifiedAt: result.modifiedAt,
              savedContents: nextContents,
              draftContents: nextContents,
              isSaving: false,
              saveError: null,
              ...(result.mediaType ? { mediaType: result.mediaType } : {}),
              ...(result.dataUrl ? { dataUrl: result.dataUrl } : {}),
            },
          };
        }

        if (currentBuffer?.kind === "text") {
          const isDirty = currentBuffer.draftContents !== currentBuffer.savedContents;
          if (isDirty) {
            return currentThreadBuffers;
          }
        }

        return {
          ...currentThreadBuffers,
          [result.relativePath]: {
            kind: result.kind,
            relativePath: result.relativePath,
            byteLength: result.byteLength,
            modifiedAt: result.modifiedAt,
            ...(result.mediaType ? { mediaType: result.mediaType } : {}),
            ...(result.dataUrl ? { dataUrl: result.dataUrl } : {}),
          },
        };
      }),
    ),
  setLoadError: (threadKey, filePath, error) =>
    set((state) =>
      updateThreadBuffers(state, threadKey, (currentThreadBuffers) => ({
        ...currentThreadBuffers,
        [filePath]: {
          kind: "error",
          relativePath: filePath,
          error,
        },
      })),
    ),
  setDiagnosticCounts: (threadKey, filePath, counts) =>
    set((state) => {
      const currentThreadDiagnostics = state.diagnosticsByThreadKey[threadKey] ?? {};
      const currentCounts = currentThreadDiagnostics[filePath];
      if (
        currentCounts &&
        currentCounts.errors === counts.errors &&
        currentCounts.warnings === counts.warnings
      ) {
        return state;
      }

      return {
        ...state,
        diagnosticsByThreadKey: {
          ...state.diagnosticsByThreadKey,
          [threadKey]: {
            ...currentThreadDiagnostics,
            [filePath]: counts,
          },
        },
      };
    }),
  updateDraft: (threadKey, filePath, contents) =>
    set((state) =>
      updateThreadBuffers(state, threadKey, (currentThreadBuffers) => {
        const currentBuffer = currentThreadBuffers[filePath];
        if (!currentBuffer || currentBuffer.kind !== "text") {
          return currentThreadBuffers;
        }
        if (currentBuffer.draftContents === contents) {
          return currentThreadBuffers;
        }
        return {
          ...currentThreadBuffers,
          [filePath]: {
            ...currentBuffer,
            draftContents: contents,
            saveError: null,
          },
        };
      }),
    ),
  resetDraft: (threadKey, filePath) =>
    set((state) =>
      updateThreadBuffers(state, threadKey, (currentThreadBuffers) => {
        const currentBuffer = currentThreadBuffers[filePath];
        if (!currentBuffer || currentBuffer.kind !== "text") {
          return currentThreadBuffers;
        }
        if (
          currentBuffer.draftContents === currentBuffer.savedContents &&
          currentBuffer.saveError === null
        ) {
          return currentThreadBuffers;
        }
        return {
          ...currentThreadBuffers,
          [filePath]: {
            ...currentBuffer,
            draftContents: currentBuffer.savedContents,
            saveError: null,
          },
        };
      }),
    ),
  setSaving: (threadKey, filePath, isSaving) =>
    set((state) =>
      updateThreadBuffers(state, threadKey, (currentThreadBuffers) => {
        const currentBuffer = currentThreadBuffers[filePath];
        if (
          !currentBuffer ||
          currentBuffer.kind !== "text" ||
          currentBuffer.isSaving === isSaving
        ) {
          return currentThreadBuffers;
        }
        return {
          ...currentThreadBuffers,
          [filePath]: {
            ...currentBuffer,
            isSaving,
          },
        };
      }),
    ),
  setSaveError: (threadKey, filePath, error) =>
    set((state) =>
      updateThreadBuffers(state, threadKey, (currentThreadBuffers) => {
        const currentBuffer = currentThreadBuffers[filePath];
        if (!currentBuffer || currentBuffer.kind !== "text") {
          return currentThreadBuffers;
        }
        return {
          ...currentThreadBuffers,
          [filePath]: {
            ...currentBuffer,
            isSaving: false,
            saveError: error,
          },
        };
      }),
    ),
  commitSavedDraft: (threadKey, filePath) =>
    set((state) =>
      updateThreadBuffers(state, threadKey, (currentThreadBuffers) => {
        const currentBuffer = currentThreadBuffers[filePath];
        if (!currentBuffer || currentBuffer.kind !== "text") {
          return currentThreadBuffers;
        }
        return {
          ...currentThreadBuffers,
          [filePath]: {
            ...currentBuffer,
            byteLength: textEncoder.encode(currentBuffer.draftContents).byteLength,
            modifiedAt: Date.now(),
            savedContents: currentBuffer.draftContents,
            isSaving: false,
            saveError: null,
          },
        };
      }),
    ),
}));
