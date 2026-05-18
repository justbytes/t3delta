/**
 * WorkspaceDiagnostics - Effect service contract for project-aware diagnostics.
 *
 * Owns workspace-root-relative diagnostics execution and normalization for the
 * active editor file. This layer detects relevant local tools, runs them on the
 * desktop/server side, and returns a normalized result the editor can map into
 * Monaco markers.
 *
 * @module WorkspaceDiagnostics
 */
import { Context, Schema, type Effect } from "effect";

import type { ProjectReadDiagnosticsInput, ProjectReadDiagnosticsResult } from "@t3delta/contracts";
import { WorkspacePathOutsideRootError } from "./WorkspacePaths.ts";

export class WorkspaceDiagnosticsError extends Schema.TaggedErrorClass<WorkspaceDiagnosticsError>()(
  "WorkspaceDiagnosticsError",
  {
    cwd: Schema.String,
    relativePath: Schema.optional(Schema.String),
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface WorkspaceDiagnosticsShape {
  readonly readDiagnostics: (
    input: ProjectReadDiagnosticsInput,
  ) => Effect.Effect<
    ProjectReadDiagnosticsResult,
    WorkspaceDiagnosticsError | WorkspacePathOutsideRootError
  >;
}

export class WorkspaceDiagnostics extends Context.Service<
  WorkspaceDiagnostics,
  WorkspaceDiagnosticsShape
>()("t3/workspace/Services/WorkspaceDiagnostics") {}
