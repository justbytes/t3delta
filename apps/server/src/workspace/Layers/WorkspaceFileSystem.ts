import { Effect, FileSystem, Layer, Path } from "effect";
import fsPromises from "node:fs/promises";
import trash from "trash";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const MAX_PREVIEWABLE_TEXT_FILE_BYTES = 512 * 1024;
  const MAX_PREVIEWABLE_IMAGE_FILE_BYTES = 5 * 1024 * 1024;
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;

  const imageMediaTypeForPath = (relativePath: string): string | null => {
    const lowerPath = relativePath.toLowerCase();
    if (lowerPath.endsWith(".png")) return "image/png";
    if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) return "image/jpeg";
    if (lowerPath.endsWith(".gif")) return "image/gif";
    if (lowerPath.endsWith(".webp")) return "image/webp";
    if (lowerPath.endsWith(".avif")) return "image/avif";
    if (lowerPath.endsWith(".svg")) return "image/svg+xml";
    return null;
  };

  const toImagePreviewFields = (
    relativePath: string,
    bytes: Uint8Array,
  ): { mediaType: string; dataUrl: string } | null => {
    const mediaType = imageMediaTypeForPath(relativePath);
    if (!mediaType || bytes.byteLength > MAX_PREVIEWABLE_IMAGE_FILE_BYTES) {
      return null;
    }
    return {
      mediaType,
      dataUrl: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
    };
  };

  const readFile: WorkspaceFileSystemShape["readFile"] = Effect.fn("WorkspaceFileSystem.readFile")(
    function* (input) {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });

      const stat = yield* Effect.tryPromise(() => fsPromises.stat(target.absolutePath)).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.stat",
              detail: cause instanceof Error ? cause.message : "Failed to stat workspace file.",
              cause,
            }),
        ),
      );
      const bytes = yield* Effect.tryPromise(() => fsPromises.readFile(target.absolutePath)).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: input.relativePath,
              operation: "workspaceFileSystem.readFile",
              detail: cause instanceof Error ? cause.message : "Failed to read workspace file.",
              cause,
            }),
        ),
      );

      const byteLength = bytes.byteLength;
      const modifiedAt = stat.mtimeMs;
      const imagePreview = toImagePreviewFields(target.relativePath, bytes);

      if (byteLength > MAX_PREVIEWABLE_TEXT_FILE_BYTES) {
        return {
          relativePath: target.relativePath,
          kind: "tooLarge" as const,
          byteLength,
          modifiedAt,
          ...(imagePreview ?? {}),
        };
      }

      if (imagePreview && imagePreview.mediaType !== "image/svg+xml") {
        return {
          relativePath: target.relativePath,
          kind: "binary" as const,
          byteLength,
          modifiedAt,
          ...imagePreview,
        };
      }

      if (bytes.includes(0)) {
        return {
          relativePath: target.relativePath,
          kind: "binary" as const,
          byteLength,
          modifiedAt,
          ...(imagePreview ?? {}),
        };
      }

      const decoded = yield* Effect.try({
        try: () => utf8Decoder.decode(bytes),
        catch: (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.decodeUtf8",
            detail: cause instanceof Error ? cause.message : "Failed to decode workspace file.",
            cause,
          }),
      }).pipe(
        Effect.catchTag("WorkspaceFileSystemError", (error) => {
          if (error.operation === "workspaceFileSystem.decodeUtf8") {
            return Effect.succeed(null);
          }
          return Effect.fail(error);
        }),
      );

      if (decoded === null) {
        return {
          relativePath: target.relativePath,
          kind: "unsupportedEncoding" as const,
          byteLength,
          modifiedAt,
          ...(imagePreview ?? {}),
        };
      }

      return {
        relativePath: target.relativePath,
        kind: "text" as const,
        byteLength,
        modifiedAt,
        contents: decoded,
        ...(imagePreview ?? {}),
      };
    },
  );

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const createDirectory: WorkspaceFileSystemShape["createDirectory"] = Effect.fn(
    "WorkspaceFileSystem.createDirectory",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.createDirectoryParent",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* Effect.tryPromise({
      try: () => fsPromises.mkdir(target.absolutePath),
      catch: (cause) =>
        new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "workspaceFileSystem.createDirectory",
          detail: cause instanceof Error ? cause.message : "Failed to create workspace folder.",
          cause,
        }),
    });
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const renameEntry: WorkspaceFileSystemShape["renameEntry"] = Effect.fn(
    "WorkspaceFileSystem.renameEntry",
  )(function* (input) {
    const source = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.fromRelativePath,
    });
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.toRelativePath,
    });

    const targetExists = yield* Effect.tryPromise(() => fsPromises.stat(target.absolutePath)).pipe(
      Effect.map(() => true),
      Effect.catch(() => Effect.succeed(false)),
    );
    if (targetExists) {
      return yield* new WorkspaceFileSystemError({
        cwd: input.cwd,
        relativePath: input.toRelativePath,
        operation: "workspaceFileSystem.renameEntry",
        detail: "A file or folder already exists at the destination path.",
      });
    }

    yield* Effect.tryPromise(() =>
      fsPromises.rename(source.absolutePath, target.absolutePath),
    ).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.fromRelativePath,
            operation: "workspaceFileSystem.renameEntry",
            detail: cause instanceof Error ? cause.message : "Failed to rename workspace entry.",
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return {
      fromRelativePath: source.relativePath,
      toRelativePath: target.relativePath,
    };
  });

  const deleteEntry: WorkspaceFileSystemShape["deleteEntry"] = Effect.fn(
    "WorkspaceFileSystem.deleteEntry",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const deleteMode = input.mode ?? "delete";
    const operation =
      deleteMode === "trash" ? "workspaceFileSystem.trashEntry" : "workspaceFileSystem.deleteEntry";

    yield* Effect.tryPromise({
      try: async () => {
        if (deleteMode === "trash") {
          await fsPromises.stat(target.absolutePath);
          await trash([target.absolutePath], { glob: false });
          return;
        }

        await fsPromises.rm(target.absolutePath, {
          recursive: input.recursive === true,
          force: false,
        });
      },
      catch: (cause) =>
        new WorkspaceFileSystemError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation,
          detail:
            cause instanceof Error
              ? cause.message
              : deleteMode === "trash"
                ? "Failed to move workspace entry to trash."
                : "Failed to delete workspace entry.",
          cause,
        }),
    }).pipe(Effect.mapError((cause) => cause as WorkspaceFileSystemError));
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  return {
    createDirectory,
    deleteEntry,
    readFile,
    renameEntry,
    writeFile,
  } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
