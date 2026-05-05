import { Effect, Layer } from "effect";
import fs from "node:fs";
import NodePath from "node:path";

import type {
  ProjectDiagnostic,
  ProjectDiagnosticsToolRun,
  ServerSettings,
} from "@t3delta/contracts";
import {
  BUILT_IN_JS_TS_RULE_CONFIG_FILES,
  evaluateBuiltInJavaScriptTypeScriptCodeRules,
  hasEnabledBuiltInJavaScriptTypeScriptCodeRules,
  isBuiltInJavaScriptTypeScriptRuleTarget,
} from "@t3delta/shared/projectCodeRules";
import { runProcess } from "../../processRunner.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  WorkspaceDiagnostics,
  WorkspaceDiagnosticsError,
  type WorkspaceDiagnosticsShape,
} from "../Services/WorkspaceDiagnostics.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";

type DiagnosticSeverity = ProjectDiagnostic["severity"];
type ToolRunStatus = ProjectDiagnosticsToolRun["status"];

interface DiagnosticsContext {
  readonly cwd: string;
  readonly targetAbsolutePath: string;
  readonly targetRelativePath: string;
  readonly targetBasename: string;
  readonly targetDirectory: string;
  readonly targetExtension: string;
}

interface DiagnosticsAdapterOutcome {
  readonly diagnostics: readonly ProjectDiagnostic[];
  readonly run: ProjectDiagnosticsToolRun;
}

const TYPESCRIPT_LIKE_EXTENSIONS = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "cts"]);
const PYTHON_EXTENSIONS = new Set(["py"]);
const RUST_EXTENSIONS = new Set(["rs"]);
const SOLIDITY_EXTENSIONS = new Set(["sol"]);
const ESLINT_CONFIG_FILES = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
] as const;
const globalCommandCache = new Map<string, Promise<string | null>>();

function normalizeAbsolutePath(candidatePath: string, cwd: string): string {
  return NodePath.resolve(
    NodePath.isAbsolute(candidatePath) ? candidatePath : NodePath.join(cwd, candidatePath),
  );
}

function isTargetDiagnosticPath(candidatePath: string, context: DiagnosticsContext): boolean {
  return normalizeAbsolutePath(candidatePath, context.cwd) === context.targetAbsolutePath;
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await fs.promises.access(pathValue, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findUpwards(
  startDirectory: string,
  rootDirectory: string,
  candidateNames: readonly string[],
): Promise<string | null> {
  let currentDirectory = NodePath.resolve(startDirectory);
  const normalizedRoot = NodePath.resolve(rootDirectory);

  while (true) {
    for (const candidateName of candidateNames) {
      const candidatePath = NodePath.join(currentDirectory, candidateName);
      if (await pathExists(candidatePath)) {
        return candidatePath;
      }
    }

    if (currentDirectory === normalizedRoot) {
      return null;
    }

    const parentDirectory = NodePath.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }
    currentDirectory = parentDirectory;
  }
}

async function resolveLocalNodeBinary(cwd: string, binaryName: string): Promise<string | null> {
  const candidates =
    process.platform === "win32"
      ? [`${binaryName}.cmd`, `${binaryName}.exe`, binaryName]
      : [binaryName];

  for (const candidate of candidates) {
    const candidatePath = NodePath.join(cwd, "node_modules", ".bin", candidate);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

function resolveGlobalCommand(commandNames: readonly string[]): Promise<string | null> {
  const cacheKey = commandNames.join("|");
  const cached = globalCommandCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const resolution = (async () => {
    for (const commandName of commandNames) {
      try {
        await runProcess(commandName, ["--version"], {
          allowNonZeroExit: true,
          timeoutMs: 5_000,
          outputMode: "truncate",
          maxBufferBytes: 32 * 1024,
        });
        return commandName;
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.startsWith("Command not found:") ||
            error.message.includes("not recognized as an internal or external command"))
        ) {
          continue;
        }
      }
    }
    return null;
  })();

  globalCommandCache.set(cacheKey, resolution);
  return resolution;
}

function makeToolRun(
  tool: string,
  command: string,
  status: ToolRunStatus,
  detail?: string,
): ProjectDiagnosticsToolRun {
  return {
    tool,
    command,
    status,
    ...(detail ? { detail } : {}),
  };
}

function toSeverity(value: string | number | null | undefined): DiagnosticSeverity {
  if (typeof value === "number") {
    if (value >= 2) return "error";
    if (value === 1) return "warning";
    return "information";
  }

  switch ((value ?? "").toString().toLowerCase()) {
    case "error":
      return "error";
    case "warning":
    case "warn":
      return "warning";
    case "hint":
      return "hint";
    default:
      return "information";
  }
}

function createDiagnostic(input: {
  readonly context: DiagnosticsContext;
  readonly line: number;
  readonly column: number;
  readonly severity: DiagnosticSeverity;
  readonly source: string;
  readonly message: string;
  readonly code?: string | null;
  readonly endLine?: number | null;
  readonly endColumn?: number | null;
}): ProjectDiagnostic {
  const trimmedMessage = input.message.trim();
  return {
    relativePath: input.context.targetRelativePath,
    severity: input.severity,
    source: input.source,
    message: trimmedMessage.length > 0 ? trimmedMessage : "Unknown diagnostic.",
    line: Math.max(1, Math.trunc(input.line)),
    column: Math.max(1, Math.trunc(input.column)),
    ...(input.endLine && input.endLine > 0 ? { endLine: Math.trunc(input.endLine) } : {}),
    ...(input.endColumn && input.endColumn > 0 ? { endColumn: Math.trunc(input.endColumn) } : {}),
    ...(input.code ? { code: input.code.trim() } : {}),
  };
}

async function hasJsTsRuleConfig(context: DiagnosticsContext): Promise<boolean> {
  return (
    (await findUpwards(context.targetDirectory, context.cwd, BUILT_IN_JS_TS_RULE_CONFIG_FILES)) !==
    null
  );
}

async function runBuiltInJavaScriptTypeScriptCodeRules(
  context: DiagnosticsContext,
  settings: ServerSettings,
): Promise<DiagnosticsAdapterOutcome> {
  if (!isBuiltInJavaScriptTypeScriptRuleTarget(context.targetRelativePath)) {
    return {
      diagnostics: [],
      run: makeToolRun(
        "t3delta-rules",
        "built-in JS/TS code rules",
        "notApplicable",
        "File is not JS or TS.",
      ),
    };
  }

  if (await hasJsTsRuleConfig(context)) {
    return {
      diagnostics: [],
      run: makeToolRun(
        "t3delta-rules",
        "built-in JS/TS code rules",
        "notApplicable",
        "Project ESLint config found.",
      ),
    };
  }

  const rules = settings.codeRules.javascriptTypeScript;
  if (!hasEnabledBuiltInJavaScriptTypeScriptCodeRules(rules)) {
    return {
      diagnostics: [],
      run: makeToolRun("t3delta-rules", "built-in JS/TS code rules", "notApplicable"),
    };
  }

  const sourceText = await fs.promises.readFile(context.targetAbsolutePath, "utf8");
  const diagnostics = evaluateBuiltInJavaScriptTypeScriptCodeRules({
    relativePath: context.targetRelativePath,
    sourceText,
    rules,
  });

  return {
    diagnostics,
    run: makeToolRun("t3delta-rules", "built-in JS/TS code rules", "ran"),
  };
}

function parseTypeScriptDiagnostics(
  output: string,
  context: DiagnosticsContext,
): readonly ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  const patterns = [
    /^(.*)\((\d+),\s*(\d+)\):\s*(error|warning)\s*(TS\d+):\s*(.+)$/i,
    /^(.*?):(\d+):(\d+)\s*-\s*(error|warning)\s*(TS\d+):\s*(.+)$/i,
  ];

  for (const rawLine of output.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    for (const pattern of patterns) {
      const match = pattern.exec(line);
      if (!match) continue;

      const [, filePath, lineValue, columnValue, severity, code, message] = match;
      if (!filePath || !lineValue || !columnValue || !message) {
        continue;
      }
      if (!isTargetDiagnosticPath(filePath, context)) {
        break;
      }

      diagnostics.push(
        createDiagnostic({
          context,
          line: Number.parseInt(lineValue, 10),
          column: Number.parseInt(columnValue, 10),
          severity: toSeverity(severity),
          source: "tsc",
          message,
          ...(code ? { code } : {}),
        }),
      );
      break;
    }
  }

  return diagnostics;
}

function parseRustDiagnostics(
  output: string,
  context: DiagnosticsContext,
): readonly ProjectDiagnostic[] {
  const diagnostics: ProjectDiagnostic[] = [];
  const pattern = /^(.*?):(\d+):(\d+):\s*(warning|error)(?:\[([A-Za-z0-9_]+)\])?:\s*(.+)$/i;

  for (const rawLine of output.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = pattern.exec(line);
    if (!match) continue;

    const [, filePath, lineValue, columnValue, severity, code, message] = match;
    if (!filePath || !lineValue || !columnValue || !message) {
      continue;
    }
    if (!isTargetDiagnosticPath(filePath, context)) {
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        context,
        line: Number.parseInt(lineValue, 10),
        column: Number.parseInt(columnValue, 10),
        severity: toSeverity(severity),
        source: "cargo",
        message,
        ...(code ? { code } : {}),
      }),
    );
  }

  return diagnostics;
}

function parsePythonDiagnostics(
  output: string,
  context: DiagnosticsContext,
): readonly ProjectDiagnostic[] {
  const fileMatch = /File "(.+?)", line (\d+)/.exec(output);
  const filePath = fileMatch?.[1];
  const lineValue = fileMatch?.[2];
  if (!filePath || !lineValue || !isTargetDiagnosticPath(filePath, context)) {
    return [];
  }

  const lines = output
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let errorLine: string | undefined;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const currentLine = lines[index];
    if (currentLine && /error/i.test(currentLine)) {
      errorLine = currentLine;
      break;
    }
  }

  return [
    createDiagnostic({
      context,
      line: Number.parseInt(lineValue, 10),
      column: 1,
      severity: "error",
      source: "py_compile",
      message: errorLine ?? "Python syntax error.",
    }),
  ];
}

function parseEslintDiagnostics(
  output: string,
  context: DiagnosticsContext,
): readonly ProjectDiagnostic[] {
  const parsed = JSON.parse(output) as Array<{
    filePath?: string;
    messages?: Array<{
      severity?: number;
      message?: string;
      line?: number;
      column?: number;
      endLine?: number;
      endColumn?: number;
      ruleId?: string | null;
    }>;
  }>;

  const diagnostics: ProjectDiagnostic[] = [];

  for (const fileResult of parsed) {
    if (!fileResult.filePath || !isTargetDiagnosticPath(fileResult.filePath, context)) {
      continue;
    }

    for (const message of fileResult.messages ?? []) {
      diagnostics.push(
        createDiagnostic({
          context,
          line: message.line ?? 1,
          column: message.column ?? 1,
          endLine: message.endLine ?? null,
          endColumn: message.endColumn ?? null,
          severity: toSeverity(message.severity ?? null),
          source: "eslint",
          message: message.message ?? "ESLint diagnostic.",
          code: message.ruleId ?? null,
        }),
      );
    }
  }

  return diagnostics;
}

function parseSolhintDiagnostics(
  output: string,
  context: DiagnosticsContext,
): readonly ProjectDiagnostic[] {
  const parsed = JSON.parse(output) as
    | Array<{
        filePath?: string;
        messages?: Array<{
          line?: number;
          column?: number;
          message?: string;
          severity?: string | number;
          ruleId?: string | null;
        }>;
      }>
    | {
        filePath?: string;
        messages?: Array<{
          line?: number;
          column?: number;
          message?: string;
          severity?: string | number;
          ruleId?: string | null;
        }>;
      };

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const diagnostics: ProjectDiagnostic[] = [];

  for (const entry of entries) {
    if (!entry.filePath || !isTargetDiagnosticPath(entry.filePath, context)) {
      continue;
    }

    for (const message of entry.messages ?? []) {
      diagnostics.push(
        createDiagnostic({
          context,
          line: message.line ?? 1,
          column: message.column ?? 1,
          severity: toSeverity(message.severity ?? null),
          source: "solhint",
          message: message.message ?? "Solidity diagnostic.",
          code: message.ruleId ?? null,
        }),
      );
    }
  }

  return diagnostics;
}

async function runTypeScriptDiagnostics(
  context: DiagnosticsContext,
): Promise<DiagnosticsAdapterOutcome> {
  if (!TYPESCRIPT_LIKE_EXTENSIONS.has(context.targetExtension)) {
    return {
      diagnostics: [],
      run: makeToolRun("tsc", "tsc --noEmit", "notApplicable", "File is not JS or TS."),
    };
  }

  const configPath = await findUpwards(context.targetDirectory, context.cwd, [
    "tsconfig.json",
    "jsconfig.json",
  ]);
  if (!configPath) {
    return {
      diagnostics: [],
      run: makeToolRun("tsc", "tsc --noEmit", "notApplicable", "No tsconfig or jsconfig found."),
    };
  }

  const command = await resolveLocalNodeBinary(context.cwd, "tsc");
  if (!command) {
    return {
      diagnostics: [],
      run: makeToolRun("tsc", "tsc --noEmit", "notAvailable", "Local TypeScript binary not found."),
    };
  }

  const result = await runProcess(command, ["--pretty", "false", "--noEmit", "-p", configPath], {
    cwd: context.cwd,
    allowNonZeroExit: true,
    outputMode: "truncate",
    maxBufferBytes: 2 * 1024 * 1024,
    timeoutMs: 60_000,
  });

  const diagnostics = parseTypeScriptDiagnostics(`${result.stdout}\n${result.stderr}`, context);
  return {
    diagnostics,
    run: makeToolRun("tsc", `${command} --pretty false --noEmit -p ${configPath}`, "ran"),
  };
}

async function runEslintDiagnostics(
  context: DiagnosticsContext,
): Promise<DiagnosticsAdapterOutcome> {
  if (!TYPESCRIPT_LIKE_EXTENSIONS.has(context.targetExtension)) {
    return {
      diagnostics: [],
      run: makeToolRun("eslint", "eslint -f json", "notApplicable", "File is not JS or TS."),
    };
  }

  const command = await resolveLocalNodeBinary(context.cwd, "eslint");
  if (!command) {
    return {
      diagnostics: [],
      run: makeToolRun(
        "eslint",
        "eslint -f json",
        "notAvailable",
        "Local ESLint binary not found.",
      ),
    };
  }

  const configPath = await findUpwards(context.targetDirectory, context.cwd, ESLINT_CONFIG_FILES);
  if (!configPath) {
    return {
      diagnostics: [],
      run: makeToolRun("eslint", "eslint -f json", "notApplicable", "No ESLint config found."),
    };
  }

  const result = await runProcess(command, ["-f", "json", context.targetAbsolutePath], {
    cwd: context.cwd,
    allowNonZeroExit: true,
    outputMode: "truncate",
    maxBufferBytes: 2 * 1024 * 1024,
    timeoutMs: 30_000,
  });

  try {
    return {
      diagnostics: parseEslintDiagnostics(result.stdout, context),
      run: makeToolRun("eslint", `${command} -f json ${context.targetAbsolutePath}`, "ran"),
    };
  } catch (error) {
    return {
      diagnostics: [],
      run: makeToolRun(
        "eslint",
        `${command} -f json ${context.targetAbsolutePath}`,
        "failed",
        error instanceof Error ? error.message : "Failed to parse ESLint output.",
      ),
    };
  }
}

async function runRustDiagnostics(context: DiagnosticsContext): Promise<DiagnosticsAdapterOutcome> {
  if (!RUST_EXTENSIONS.has(context.targetExtension)) {
    return {
      diagnostics: [],
      run: makeToolRun("cargo", "cargo check", "notApplicable", "File is not Rust."),
    };
  }

  const cargoRoot = await findUpwards(context.targetDirectory, context.cwd, ["Cargo.toml"]);
  if (!cargoRoot) {
    return {
      diagnostics: [],
      run: makeToolRun("cargo", "cargo check", "notApplicable", "No Cargo.toml found."),
    };
  }

  const command = await resolveGlobalCommand(["cargo"]);
  if (!command) {
    return {
      diagnostics: [],
      run: makeToolRun("cargo", "cargo check", "notAvailable", "cargo not found on PATH."),
    };
  }

  const result = await runProcess(command, ["check", "--message-format", "short", "--quiet"], {
    cwd: NodePath.dirname(cargoRoot),
    allowNonZeroExit: true,
    outputMode: "truncate",
    maxBufferBytes: 2 * 1024 * 1024,
    timeoutMs: 60_000,
  });

  return {
    diagnostics: parseRustDiagnostics(`${result.stdout}\n${result.stderr}`, context),
    run: makeToolRun("cargo", `${command} check --message-format short --quiet`, "ran"),
  };
}

async function runPythonDiagnostics(
  context: DiagnosticsContext,
): Promise<DiagnosticsAdapterOutcome> {
  if (!PYTHON_EXTENSIONS.has(context.targetExtension)) {
    return {
      diagnostics: [],
      run: makeToolRun(
        "py_compile",
        "python -m py_compile",
        "notApplicable",
        "File is not Python.",
      ),
    };
  }

  const command = await resolveGlobalCommand(["python3", "python"]);
  if (!command) {
    return {
      diagnostics: [],
      run: makeToolRun(
        "py_compile",
        "python -m py_compile",
        "notAvailable",
        "Python interpreter not found on PATH.",
      ),
    };
  }

  const result = await runProcess(command, ["-m", "py_compile", context.targetAbsolutePath], {
    cwd: context.cwd,
    allowNonZeroExit: true,
    outputMode: "truncate",
    maxBufferBytes: 512 * 1024,
    timeoutMs: 30_000,
  });

  return {
    diagnostics: parsePythonDiagnostics(`${result.stdout}\n${result.stderr}`, context),
    run: makeToolRun("py_compile", `${command} -m py_compile ${context.targetAbsolutePath}`, "ran"),
  };
}

async function runSolidityDiagnostics(
  context: DiagnosticsContext,
): Promise<DiagnosticsAdapterOutcome> {
  if (!SOLIDITY_EXTENSIONS.has(context.targetExtension)) {
    return {
      diagnostics: [],
      run: makeToolRun("solhint", "solhint -f json", "notApplicable", "File is not Solidity."),
    };
  }

  const localCommand = await resolveLocalNodeBinary(context.cwd, "solhint");
  const command = localCommand ?? (await resolveGlobalCommand(["solhint"]));
  if (!command) {
    return {
      diagnostics: [],
      run: makeToolRun("solhint", "solhint -f json", "notAvailable", "solhint not found."),
    };
  }

  const result = await runProcess(command, ["-f", "json", context.targetAbsolutePath], {
    cwd: context.cwd,
    allowNonZeroExit: true,
    outputMode: "truncate",
    maxBufferBytes: 1024 * 1024,
    timeoutMs: 30_000,
  });

  try {
    return {
      diagnostics: parseSolhintDiagnostics(result.stdout, context),
      run: makeToolRun("solhint", `${command} -f json ${context.targetAbsolutePath}`, "ran"),
    };
  } catch (error) {
    return {
      diagnostics: [],
      run: makeToolRun(
        "solhint",
        `${command} -f json ${context.targetAbsolutePath}`,
        "failed",
        error instanceof Error ? error.message : "Failed to parse solhint output.",
      ),
    };
  }
}

async function runAdapters(
  context: DiagnosticsContext,
  settings: ServerSettings,
): Promise<readonly DiagnosticsAdapterOutcome[]> {
  return Promise.all([
    runBuiltInJavaScriptTypeScriptCodeRules(context, settings),
    runTypeScriptDiagnostics(context),
    runEslintDiagnostics(context),
    runRustDiagnostics(context),
    runPythonDiagnostics(context),
    runSolidityDiagnostics(context),
  ]);
}

export const makeWorkspaceDiagnostics = Effect.gen(function* () {
  const workspacePaths = yield* WorkspacePaths;
  const serverSettings = yield* ServerSettingsService;

  const readDiagnostics: WorkspaceDiagnosticsShape["readDiagnostics"] = Effect.fn(
    "WorkspaceDiagnostics.readDiagnostics",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const targetStat = yield* Effect.tryPromise(() => fs.promises.stat(target.absolutePath)).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceDiagnosticsError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceDiagnostics.stat",
            detail:
              cause instanceof Error
                ? cause.message
                : "Failed to stat workspace file before diagnostics.",
            cause,
          }),
      ),
    );

    if (!targetStat.isFile()) {
      return {
        relativePath: target.relativePath,
        diagnostics: [],
        runs: [
          makeToolRun("workspace", "readDiagnostics", "notApplicable", "Target is not a file."),
        ],
      };
    }

    const context: DiagnosticsContext = {
      cwd: input.cwd,
      targetAbsolutePath: target.absolutePath,
      targetRelativePath: target.relativePath,
      targetBasename: NodePath.basename(target.absolutePath),
      targetDirectory: NodePath.dirname(target.absolutePath),
      targetExtension: NodePath.extname(target.absolutePath).replace(/^\./, "").toLowerCase(),
    };

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceDiagnosticsError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceDiagnostics.getSettings",
            detail: cause.message,
            cause,
          }),
      ),
    );
    const outcomes = yield* Effect.tryPromise(() => runAdapters(context, settings)).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceDiagnosticsError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceDiagnostics.runAdapters",
            detail:
              cause instanceof Error
                ? cause.message
                : "Failed to run workspace diagnostics adapters.",
            cause,
          }),
      ),
    );

    return {
      relativePath: target.relativePath,
      diagnostics: outcomes.flatMap((outcome) => outcome.diagnostics),
      runs: outcomes.map((outcome) => outcome.run),
    };
  });

  return { readDiagnostics } satisfies WorkspaceDiagnosticsShape;
});

export const WorkspaceDiagnosticsLive = Layer.effect(
  WorkspaceDiagnostics,
  makeWorkspaceDiagnostics,
);
