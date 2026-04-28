import { Context, Schema, Stream, type Effect } from "effect";

import type {
  ProjectLanguageServerCodeActionsInput,
  ProjectLanguageServerCodeActionsResult,
  ProjectLanguageServerCompletionResult,
  ProjectLanguageServerDefinitionResult,
  ProjectLanguageServerDocumentSyncInput,
  ProjectLanguageServerHoverResult,
  ProjectLanguageServerPositionInput,
  ProjectLanguageServerRenameInput,
  ProjectLanguageServerRenameResult,
  ProjectLanguageServerReferencesResult,
  ProjectLanguageServerStartInput,
  ProjectLanguageServerStartResult,
  ProjectLanguageServerStopInput,
  ProjectLanguageServerStopResult,
  ProjectLanguageServerStreamEvent,
  ProjectLanguageServerSubscribeInput,
} from "@t3delta/contracts";
import { WorkspacePathOutsideRootError } from "./WorkspacePaths.ts";

export class WorkspaceLanguageServersError extends Schema.TaggedErrorClass<WorkspaceLanguageServersError>()(
  "WorkspaceLanguageServersError",
  {
    cwd: Schema.String,
    serverId: Schema.optional(Schema.String),
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface WorkspaceLanguageServersShape {
  readonly startSession: (
    input: ProjectLanguageServerStartInput,
  ) => Effect.Effect<
    ProjectLanguageServerStartResult,
    WorkspaceLanguageServersError | WorkspacePathOutsideRootError
  >;
  readonly stopSession: (
    input: ProjectLanguageServerStopInput,
  ) => Effect.Effect<
    ProjectLanguageServerStopResult,
    WorkspaceLanguageServersError | WorkspacePathOutsideRootError
  >;
  readonly syncDocument: (
    input: ProjectLanguageServerDocumentSyncInput,
  ) => Effect.Effect<void, WorkspaceLanguageServersError | WorkspacePathOutsideRootError>;
  readonly hover: (
    input: ProjectLanguageServerPositionInput,
  ) => Effect.Effect<
    ProjectLanguageServerHoverResult,
    WorkspaceLanguageServersError | WorkspacePathOutsideRootError
  >;
  readonly definition: (
    input: ProjectLanguageServerPositionInput,
  ) => Effect.Effect<
    ProjectLanguageServerDefinitionResult,
    WorkspaceLanguageServersError | WorkspacePathOutsideRootError
  >;
  readonly references: (
    input: ProjectLanguageServerPositionInput,
  ) => Effect.Effect<
    ProjectLanguageServerReferencesResult,
    WorkspaceLanguageServersError | WorkspacePathOutsideRootError
  >;
  readonly completion: (
    input: ProjectLanguageServerPositionInput,
  ) => Effect.Effect<
    ProjectLanguageServerCompletionResult,
    WorkspaceLanguageServersError | WorkspacePathOutsideRootError
  >;
  readonly rename: (
    input: ProjectLanguageServerRenameInput,
  ) => Effect.Effect<
    ProjectLanguageServerRenameResult,
    WorkspaceLanguageServersError | WorkspacePathOutsideRootError
  >;
  readonly codeActions: (
    input: ProjectLanguageServerCodeActionsInput,
  ) => Effect.Effect<
    ProjectLanguageServerCodeActionsResult,
    WorkspaceLanguageServersError | WorkspacePathOutsideRootError
  >;
  readonly subscribeEvents: (
    input: ProjectLanguageServerSubscribeInput,
  ) => Stream.Stream<ProjectLanguageServerStreamEvent, never, never>;
}

export class WorkspaceLanguageServers extends Context.Service<
  WorkspaceLanguageServers,
  WorkspaceLanguageServersShape
>()("t3/workspace/Services/WorkspaceLanguageServers") {}
