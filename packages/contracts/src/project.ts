import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_LIST_DIRECTORY_PATH_MAX_LENGTH = 512;
const PROJECT_READ_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_READ_DIAGNOSTICS_PATH_MAX_LENGTH = 512;
const PROJECT_CREATE_DIRECTORY_PATH_MAX_LENGTH = 512;
const PROJECT_RENAME_PATH_MAX_LENGTH = 512;
const PROJECT_DELETE_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectListDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_LIST_DIRECTORY_PATH_MAX_LENGTH)),
  ),
});
export type ProjectListDirectoryInput = typeof ProjectListDirectoryInput.Type;

export const ProjectListDirectoryResult = Schema.Struct({
  directoryPath: Schema.String,
  entries: Schema.Array(ProjectEntry),
});
export type ProjectListDirectoryResult = typeof ProjectListDirectoryResult.Type;

export class ProjectListDirectoryError extends Schema.TaggedErrorClass<ProjectListDirectoryError>()(
  "ProjectListDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

const ProjectReadFileKind = Schema.Literals(["text", "binary", "tooLarge", "unsupportedEncoding"]);

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  kind: ProjectReadFileKind,
  byteLength: Schema.Number,
  modifiedAt: Schema.Number,
  contents: Schema.optional(Schema.String),
  mediaType: Schema.optional(TrimmedNonEmptyString),
  dataUrl: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCreateDirectoryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_CREATE_DIRECTORY_PATH_MAX_LENGTH),
  ),
});
export type ProjectCreateDirectoryInput = typeof ProjectCreateDirectoryInput.Type;

export const ProjectCreateDirectoryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectCreateDirectoryResult = typeof ProjectCreateDirectoryResult.Type;

export class ProjectCreateDirectoryError extends Schema.TaggedErrorClass<ProjectCreateDirectoryError>()(
  "ProjectCreateDirectoryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectRenameEntryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  fromRelativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_RENAME_PATH_MAX_LENGTH)),
  toRelativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_RENAME_PATH_MAX_LENGTH)),
});
export type ProjectRenameEntryInput = typeof ProjectRenameEntryInput.Type;

export const ProjectRenameEntryResult = Schema.Struct({
  fromRelativePath: TrimmedNonEmptyString,
  toRelativePath: TrimmedNonEmptyString,
});
export type ProjectRenameEntryResult = typeof ProjectRenameEntryResult.Type;

export class ProjectRenameEntryError extends Schema.TaggedErrorClass<ProjectRenameEntryError>()(
  "ProjectRenameEntryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectDeleteEntryMode = Schema.Literals(["trash", "delete"]);
export type ProjectDeleteEntryMode = typeof ProjectDeleteEntryMode.Type;

export const ProjectDeleteEntryInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_DELETE_PATH_MAX_LENGTH)),
  recursive: Schema.optional(Schema.Boolean),
  mode: Schema.optional(ProjectDeleteEntryMode),
});
export type ProjectDeleteEntryInput = typeof ProjectDeleteEntryInput.Type;

export const ProjectDeleteEntryResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectDeleteEntryResult = typeof ProjectDeleteEntryResult.Type;

export class ProjectDeleteEntryError extends Schema.TaggedErrorClass<ProjectDeleteEntryError>()(
  "ProjectDeleteEntryError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadDiagnosticsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(
    Schema.isMaxLength(PROJECT_READ_DIAGNOSTICS_PATH_MAX_LENGTH),
  ),
});
export type ProjectReadDiagnosticsInput = typeof ProjectReadDiagnosticsInput.Type;

const ProjectDiagnosticSeverity = Schema.Literals(["error", "warning", "information", "hint"]);
export type ProjectDiagnosticSeverity = typeof ProjectDiagnosticSeverity.Type;

export const ProjectDiagnostic = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  severity: ProjectDiagnosticSeverity,
  source: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
  line: PositiveInt,
  column: PositiveInt,
  endLine: Schema.optional(PositiveInt),
  endColumn: Schema.optional(PositiveInt),
  code: Schema.optional(TrimmedNonEmptyString),
  suggestedFix: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectDiagnostic = typeof ProjectDiagnostic.Type;

const ProjectDiagnosticsRunStatus = Schema.Literals([
  "ran",
  "notAvailable",
  "notApplicable",
  "failed",
]);
export type ProjectDiagnosticsRunStatus = typeof ProjectDiagnosticsRunStatus.Type;

export const ProjectDiagnosticsToolRun = Schema.Struct({
  tool: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  status: ProjectDiagnosticsRunStatus,
  detail: Schema.optional(Schema.String),
});
export type ProjectDiagnosticsToolRun = typeof ProjectDiagnosticsToolRun.Type;

export const ProjectReadDiagnosticsResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  diagnostics: Schema.Array(ProjectDiagnostic),
  runs: Schema.Array(ProjectDiagnosticsToolRun),
});
export type ProjectReadDiagnosticsResult = typeof ProjectReadDiagnosticsResult.Type;

export class ProjectReadDiagnosticsError extends Schema.TaggedErrorClass<ProjectReadDiagnosticsError>()(
  "ProjectReadDiagnosticsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
