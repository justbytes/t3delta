import { TurnId } from "@t3delta/contracts";

export interface DiffRouteSearch {
  diff?: "1" | undefined;
  sidecar?: "diff" | "explorer" | undefined;
  diffTurnId?: TurnId | undefined;
  diffFilePath?: string | undefined;
  diffTarget?: "conversation" | undefined;
}

function isDiffOpenValue(value: unknown): boolean {
  return value === "1" || value === 1 || value === true;
}

function normalizeSearchString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function stripDiffSearchParams<T extends Record<string, unknown>>(
  params: T,
): Omit<T, "diff" | "sidecar" | "diffTurnId" | "diffFilePath" | "diffTarget"> {
  const {
    diff: _diff,
    sidecar: _sidecar,
    diffTurnId: _diffTurnId,
    diffFilePath: _diffFilePath,
    diffTarget: _diffTarget,
    ...rest
  } = params;
  return rest as Omit<T, "diff" | "sidecar" | "diffTurnId" | "diffFilePath" | "diffTarget">;
}

export function parseDiffRouteSearch(search: Record<string, unknown>): DiffRouteSearch {
  const diff = isDiffOpenValue(search.diff) ? "1" : undefined;
  const sidecarRaw = normalizeSearchString(search.sidecar);
  const sidecar =
    sidecarRaw === "explorer" ? "explorer" : sidecarRaw === "diff" ? "diff" : undefined;
  const diffTurnIdRaw = diff ? normalizeSearchString(search.diffTurnId) : undefined;
  const diffTurnId = diffTurnIdRaw ? TurnId.make(diffTurnIdRaw) : undefined;
  const diffTargetRaw = diff && !diffTurnId ? normalizeSearchString(search.diffTarget) : undefined;
  const diffTarget = diffTargetRaw === "conversation" ? "conversation" : undefined;
  const diffFilePath = diff && diffTurnId ? normalizeSearchString(search.diffFilePath) : undefined;

  return {
    ...(diff ? { diff } : {}),
    ...(sidecar ? { sidecar } : {}),
    ...(diffTurnId ? { diffTurnId } : {}),
    ...(diffTarget ? { diffTarget } : {}),
    ...(diffFilePath ? { diffFilePath } : {}),
  };
}
