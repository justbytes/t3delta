import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { afterEach, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { GitCoreLive } from "../../git/Layers/GitCore.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspaceFileSystem } from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntriesLive } from "./WorkspaceEntries.ts";
import { WorkspaceFileSystemLive } from "./WorkspaceFileSystem.ts";
import { WorkspacePathsLive } from "./WorkspacePaths.ts";

const { trashMock } = vi.hoisted(() => ({
  trashMock: vi.fn<(paths: readonly string[], options?: { glob?: boolean }) => Promise<void>>(),
}));

vi.mock("trash", () => ({
  default: trashMock,
}));

const ProjectLayer = WorkspaceFileSystemLive.pipe(
  Layer.provide(WorkspacePathsLive),
  Layer.provide(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
);

const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(ProjectLayer),
  Layer.provideMerge(WorkspaceEntriesLive.pipe(Layer.provide(WorkspacePathsLive))),
  Layer.provideMerge(WorkspacePathsLive),
  Layer.provideMerge(GitCoreLive),
  Layer.provide(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "t3-workspace-files-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({
    prefix: "t3delta-workspace-files-",
  });
});

afterEach(() => {
  trashMock.mockReset();
});

const writeTextFile = Effect.fn("writeTextFile")(function* (
  cwd: string,
  relativePath: string,
  contents = "",
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(cwd, relativePath);
  yield* fileSystem
    .makeDirectory(path.dirname(absolutePath), { recursive: true })
    .pipe(Effect.orDie);
  yield* fileSystem.writeFileString(absolutePath, contents).pipe(Effect.orDie);
});

it.layer(TestLayer)("WorkspaceFileSystemLive", (it) => {
  describe("readFile", () => {
    it.effect("reads previewable UTF-8 text files", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/example.ts", "export const answer = 42;\n");

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "src/example.ts",
        });

        expect(result).toEqual({
          relativePath: "src/example.ts",
          kind: "text",
          byteLength: Buffer.byteLength("export const answer = 42;\n"),
          modifiedAt: expect.any(Number),
          contents: "export const answer = 42;\n",
        });
      }),
    );

    it.effect("classifies files with NUL bytes as binary", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem
          .makeDirectory(path.join(cwd, "assets"), { recursive: true })
          .pipe(Effect.orDie);
        yield* fileSystem
          .writeFile(path.join(cwd, "assets/blob.bin"), new Uint8Array([0, 1, 2]))
          .pipe(Effect.orDie);

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "assets/blob.bin",
        });

        expect(result).toEqual({
          relativePath: "assets/blob.bin",
          kind: "binary",
          byteLength: 3,
          modifiedAt: expect.any(Number),
        });
      }),
    );

    it.effect("returns bounded image preview data for binary images", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        yield* fileSystem
          .makeDirectory(path.join(cwd, "assets"), { recursive: true })
          .pipe(Effect.orDie);
        yield* fileSystem.writeFile(path.join(cwd, "assets/logo.png"), pngBytes).pipe(Effect.orDie);

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "assets/logo.png",
        });

        expect(result).toEqual({
          relativePath: "assets/logo.png",
          kind: "binary",
          byteLength: pngBytes.byteLength,
          modifiedAt: expect.any(Number),
          mediaType: "image/png",
          dataUrl: `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`,
        });
      }),
    );

    it.effect("reports oversized files without returning contents", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "logs/huge.txt", "a".repeat(600_000));

        const result = yield* workspaceFileSystem.readFile({
          cwd,
          relativePath: "logs/huge.txt",
        });

        expect(result).toEqual({
          relativePath: "logs/huge.txt",
          kind: "tooLarge",
          byteLength: 600_000,
          modifiedAt: expect.any(Number),
        });
      }),
    );

    it.effect("rejects reads outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;

        const error = yield* workspaceFileSystem
          .readFile({
            cwd,
            relativePath: "../escape.md",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );
      }),
    );
  });

  describe("writeFile", () => {
    it.effect("writes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });
        const saved = yield* fileSystem
          .readFileString(path.join(cwd, "plans/effect-rpc.md"))
          .pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "plans/effect-rpc.md" });
        expect(saved).toBe("# Plan\n");
      }),
    );

    it.effect("invalidates workspace entry search cache after writes", () =>
      Effect.gen(function* () {
        const workspaceEntries = yield* WorkspaceEntries;
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        yield* writeTextFile(cwd, "src/existing.ts", "export {};\n");

        const beforeWrite = yield* workspaceEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(beforeWrite).toEqual({
          entries: [],
          truncated: false,
        });

        yield* workspaceFileSystem.writeFile({
          cwd,
          relativePath: "plans/effect-rpc.md",
          contents: "# Plan\n",
        });

        const afterWrite = yield* workspaceEntries.search({
          cwd,
          query: "rpc",
          limit: 10,
        });
        expect(afterWrite.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "plans/effect-rpc.md" })]),
        );
        expect(afterWrite.truncated).toBe(false);
      }),
    );

    it.effect("rejects writes outside the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        const fileSystem = yield* FileSystem.FileSystem;

        const error = yield* workspaceFileSystem
          .writeFile({
            cwd,
            relativePath: "../escape.md",
            contents: "# nope\n",
          })
          .pipe(Effect.flip);

        expect(error.message).toContain(
          "Workspace file path must be relative to the project root: ../escape.md",
        );

        const escapedPath = path.resolve(cwd, "..", "escape.md");
        const escapedStat = yield* fileSystem
          .stat(escapedPath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        expect(escapedStat).toBeNull();
      }),
    );
  });

  describe("createDirectory", () => {
    it.effect("creates a directory relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const result = yield* workspaceFileSystem.createDirectory({
          cwd,
          relativePath: "src/features",
        });
        const stat = yield* fileSystem.stat(path.join(cwd, "src/features")).pipe(Effect.orDie);

        expect(result).toEqual({ relativePath: "src/features" });
        expect(stat.type).toBe("Directory");
      }),
    );
  });

  describe("renameEntry", () => {
    it.effect("renames files within the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* writeTextFile(cwd, "src/old.ts", "export const oldName = true;\n");

        const result = yield* workspaceFileSystem.renameEntry({
          cwd,
          fromRelativePath: "src/old.ts",
          toRelativePath: "src/new.ts",
        });
        const renamed = yield* fileSystem
          .readFileString(path.join(cwd, "src/new.ts"))
          .pipe(Effect.orDie);
        const oldStat = yield* fileSystem
          .stat(path.join(cwd, "src/old.ts"))
          .pipe(Effect.catch(() => Effect.succeed(null)));

        expect(result).toEqual({
          fromRelativePath: "src/old.ts",
          toRelativePath: "src/new.ts",
        });
        expect(renamed).toBe("export const oldName = true;\n");
        expect(oldStat).toBeNull();
      }),
    );
  });

  describe("deleteEntry", () => {
    it.effect("deletes files relative to the workspace root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* writeTextFile(cwd, "src/remove.ts", "remove me\n");

        const result = yield* workspaceFileSystem.deleteEntry({
          cwd,
          relativePath: "src/remove.ts",
        });
        const stat = yield* fileSystem
          .stat(path.join(cwd, "src/remove.ts"))
          .pipe(Effect.catch(() => Effect.succeed(null)));

        expect(result).toEqual({ relativePath: "src/remove.ts" });
        expect(stat).toBeNull();
      }),
    );

    it.effect("moves files to trash when requested", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem;
        const cwd = yield* makeTempDir;
        const path = yield* Path.Path;
        yield* writeTextFile(cwd, "src/trash-me.ts", "trash me\n");

        trashMock.mockResolvedValueOnce(undefined);

        const result = yield* workspaceFileSystem.deleteEntry({
          cwd,
          relativePath: "src/trash-me.ts",
          mode: "trash",
        });

        expect(result).toEqual({ relativePath: "src/trash-me.ts" });
        expect(trashMock).toHaveBeenCalledWith([path.join(cwd, "src/trash-me.ts")], {
          glob: false,
        });
      }),
    );
  });
});
