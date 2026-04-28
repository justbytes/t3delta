import { Schema } from "effect";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProjectDiagnostic } from "./project.ts";

export const LanguageServerId = TrimmedNonEmptyString;
export type LanguageServerId = typeof LanguageServerId.Type;

export const ProjectLanguageServerSessionKey = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  serverId: LanguageServerId,
});
export type ProjectLanguageServerSessionKey = typeof ProjectLanguageServerSessionKey.Type;

export const ProjectLanguageServerCapabilities = Schema.Struct({
  diagnostics: Schema.Boolean,
  hover: Schema.Boolean,
  completion: Schema.Boolean,
  definition: Schema.Boolean,
  references: Schema.Boolean,
  rename: Schema.Boolean,
  codeAction: Schema.Boolean,
});
export type ProjectLanguageServerCapabilities = typeof ProjectLanguageServerCapabilities.Type;

export const ProjectLanguageServerSessionStatus = Schema.Literals([
  "starting",
  "running",
  "stopped",
  "missingBinary",
  "failed",
  "restartScheduled",
]);
export type ProjectLanguageServerSessionStatus = typeof ProjectLanguageServerSessionStatus.Type;

export const ProjectLanguageServerStartInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  serverId: LanguageServerId,
});
export type ProjectLanguageServerStartInput = typeof ProjectLanguageServerStartInput.Type;

export const ProjectLanguageServerStartResult = Schema.Struct({
  session: ProjectLanguageServerSessionKey,
  status: ProjectLanguageServerSessionStatus,
  capabilities: ProjectLanguageServerCapabilities,
  detail: Schema.optional(Schema.String),
});
export type ProjectLanguageServerStartResult = typeof ProjectLanguageServerStartResult.Type;

export const ProjectLanguageServerStopInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  serverId: LanguageServerId,
});
export type ProjectLanguageServerStopInput = typeof ProjectLanguageServerStopInput.Type;

export const ProjectLanguageServerStopResult = Schema.Struct({
  session: ProjectLanguageServerSessionKey,
  stopped: Schema.Boolean,
});
export type ProjectLanguageServerStopResult = typeof ProjectLanguageServerStopResult.Type;

export const ProjectLanguageServerDocumentSyncAction = Schema.Literals([
  "open",
  "change",
  "save",
  "close",
]);
export type ProjectLanguageServerDocumentSyncAction =
  typeof ProjectLanguageServerDocumentSyncAction.Type;

export const ProjectLanguageServerDocumentSyncInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  serverId: LanguageServerId,
  relativePath: TrimmedNonEmptyString,
  languageId: TrimmedNonEmptyString,
  version: PositiveInt,
  action: ProjectLanguageServerDocumentSyncAction,
  text: Schema.optional(Schema.String),
});
export type ProjectLanguageServerDocumentSyncInput =
  typeof ProjectLanguageServerDocumentSyncInput.Type;

export const ProjectLanguageServerPositionInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  serverId: LanguageServerId,
  relativePath: TrimmedNonEmptyString,
  line: PositiveInt,
  column: PositiveInt,
});
export type ProjectLanguageServerPositionInput = typeof ProjectLanguageServerPositionInput.Type;

export const ProjectLanguageServerRange = Schema.Struct({
  startLine: PositiveInt,
  startColumn: PositiveInt,
  endLine: PositiveInt,
  endColumn: PositiveInt,
});
export type ProjectLanguageServerRange = typeof ProjectLanguageServerRange.Type;

export const ProjectLanguageServerLocation = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  range: ProjectLanguageServerRange,
});
export type ProjectLanguageServerLocation = typeof ProjectLanguageServerLocation.Type;

export const ProjectLanguageServerHoverResult = Schema.Struct({
  contents: Schema.optional(Schema.String),
  range: Schema.optional(ProjectLanguageServerRange),
});
export type ProjectLanguageServerHoverResult = typeof ProjectLanguageServerHoverResult.Type;

export const ProjectLanguageServerDefinitionResult = Schema.Struct({
  locations: Schema.Array(ProjectLanguageServerLocation),
});
export type ProjectLanguageServerDefinitionResult =
  typeof ProjectLanguageServerDefinitionResult.Type;

export const ProjectLanguageServerReferencesResult = Schema.Struct({
  locations: Schema.Array(ProjectLanguageServerLocation),
});
export type ProjectLanguageServerReferencesResult =
  typeof ProjectLanguageServerReferencesResult.Type;

export const ProjectLanguageServerCompletionItem = Schema.Struct({
  label: TrimmedNonEmptyString,
  insertText: Schema.optional(Schema.String),
  insertTextFormat: Schema.optional(Schema.Literals(["plainText", "snippet"])),
  range: Schema.optional(ProjectLanguageServerRange),
  detail: Schema.optional(Schema.String),
  documentation: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.String),
});
export type ProjectLanguageServerCompletionItem = typeof ProjectLanguageServerCompletionItem.Type;

export const ProjectLanguageServerCompletionResult = Schema.Struct({
  items: Schema.Array(ProjectLanguageServerCompletionItem),
});
export type ProjectLanguageServerCompletionResult =
  typeof ProjectLanguageServerCompletionResult.Type;

export const ProjectLanguageServerTextEdit = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  range: ProjectLanguageServerRange,
  newText: Schema.String,
});
export type ProjectLanguageServerTextEdit = typeof ProjectLanguageServerTextEdit.Type;

export const ProjectLanguageServerRenameInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  serverId: LanguageServerId,
  relativePath: TrimmedNonEmptyString,
  line: PositiveInt,
  column: PositiveInt,
  newName: TrimmedNonEmptyString,
});
export type ProjectLanguageServerRenameInput = typeof ProjectLanguageServerRenameInput.Type;

export const ProjectLanguageServerRenameResult = Schema.Struct({
  edits: Schema.Array(ProjectLanguageServerTextEdit),
});
export type ProjectLanguageServerRenameResult = typeof ProjectLanguageServerRenameResult.Type;

export const ProjectLanguageServerCodeAction = Schema.Struct({
  title: TrimmedNonEmptyString,
  kind: Schema.optional(Schema.String),
  diagnostics: Schema.Array(ProjectDiagnostic),
});
export type ProjectLanguageServerCodeAction = typeof ProjectLanguageServerCodeAction.Type;

export const ProjectLanguageServerCodeActionsResult = Schema.Struct({
  actions: Schema.Array(ProjectLanguageServerCodeAction),
});
export type ProjectLanguageServerCodeActionsResult =
  typeof ProjectLanguageServerCodeActionsResult.Type;

export const ProjectLanguageServerCodeActionsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  serverId: LanguageServerId,
  relativePath: TrimmedNonEmptyString,
  range: ProjectLanguageServerRange,
});
export type ProjectLanguageServerCodeActionsInput =
  typeof ProjectLanguageServerCodeActionsInput.Type;

export const ProjectLanguageServerSubscribeInput = Schema.Struct({
  cwd: Schema.optional(TrimmedNonEmptyString),
  serverId: Schema.optional(LanguageServerId),
});
export type ProjectLanguageServerSubscribeInput = typeof ProjectLanguageServerSubscribeInput.Type;

export const ProjectLanguageServerSessionEvent = Schema.Struct({
  type: Schema.Literal("session"),
  session: ProjectLanguageServerSessionKey,
  status: ProjectLanguageServerSessionStatus,
  capabilities: ProjectLanguageServerCapabilities,
  detail: Schema.optional(Schema.String),
});
export type ProjectLanguageServerSessionEvent = typeof ProjectLanguageServerSessionEvent.Type;

export const ProjectLanguageServerDiagnosticsEvent = Schema.Struct({
  type: Schema.Literal("diagnostics"),
  session: ProjectLanguageServerSessionKey,
  relativePath: TrimmedNonEmptyString,
  diagnostics: Schema.Array(ProjectDiagnostic),
});
export type ProjectLanguageServerDiagnosticsEvent =
  typeof ProjectLanguageServerDiagnosticsEvent.Type;

export const ProjectLanguageServerStreamEvent = Schema.Union([
  ProjectLanguageServerSessionEvent,
  ProjectLanguageServerDiagnosticsEvent,
]);
export type ProjectLanguageServerStreamEvent = typeof ProjectLanguageServerStreamEvent.Type;

export class ProjectLanguageServerError extends Schema.TaggedErrorClass<ProjectLanguageServerError>()(
  "ProjectLanguageServerError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
