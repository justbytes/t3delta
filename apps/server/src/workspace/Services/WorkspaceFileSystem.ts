/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import { Schema, Context } from "effect";
import type { Effect } from "effect";

import type {
  ProjectCreateDirectoryInput,
  ProjectCreateDirectoryResult,
  ProjectDeleteEntryInput,
  ProjectDeleteEntryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectRenameEntryInput,
  ProjectRenameEntryResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3delta/contracts";
import { WorkspacePathOutsideRootError } from "./WorkspacePaths.ts";

export class WorkspaceFileSystemError extends Schema.TaggedErrorClass<WorkspaceFileSystemError>()(
  "WorkspaceFileSystemError",
  {
    cwd: Schema.String,
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

/**
 * WorkspaceFileSystemShape - Service API for workspace-relative file operations.
 */
export interface WorkspaceFileSystemShape {
  /**
   * Read a file relative to the workspace root.
   *
   * Returns text contents when the file is previewable and explicit non-text
   * result kinds for binary, oversized, or unsupported-encoding files.
   */
  readonly readFile: (
    input: ProjectReadFileInput,
  ) => Effect.Effect<
    ProjectReadFileResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  /**
   * Write a file relative to the workspace root.
   *
   * Creates parent directories as needed and rejects paths that escape the
   * workspace root.
   */
  readonly writeFile: (
    input: ProjectWriteFileInput,
  ) => Effect.Effect<
    ProjectWriteFileResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  readonly createDirectory: (
    input: ProjectCreateDirectoryInput,
  ) => Effect.Effect<
    ProjectCreateDirectoryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  readonly renameEntry: (
    input: ProjectRenameEntryInput,
  ) => Effect.Effect<
    ProjectRenameEntryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;

  readonly deleteEntry: (
    input: ProjectDeleteEntryInput,
  ) => Effect.Effect<
    ProjectDeleteEntryResult,
    WorkspaceFileSystemError | WorkspacePathOutsideRootError
  >;
}

/**
 * WorkspaceFileSystem - Service tag for workspace file operations.
 */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  WorkspaceFileSystemShape
>()("t3/workspace/Services/WorkspaceFileSystem") {}
