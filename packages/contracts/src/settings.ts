import { Effect } from "effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { PositiveInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import {
  ClaudeModelOptions,
  CodexModelOptions,
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
} from "./model.ts";
import { ModelSelection } from "./orchestration.ts";

// ── Client Settings (local-only) ───────────────────────────────

export const TimestampFormat = Schema.Literals(["locale", "12-hour", "24-hour"]);
export type TimestampFormat = typeof TimestampFormat.Type;
export const DEFAULT_TIMESTAMP_FORMAT: TimestampFormat = "locale";

export const SidebarProjectSortOrder = Schema.Literals(["updated_at", "created_at", "manual"]);
export type SidebarProjectSortOrder = typeof SidebarProjectSortOrder.Type;
export const DEFAULT_SIDEBAR_PROJECT_SORT_ORDER: SidebarProjectSortOrder = "updated_at";

export const SidebarThreadSortOrder = Schema.Literals(["updated_at", "created_at"]);
export type SidebarThreadSortOrder = typeof SidebarThreadSortOrder.Type;
export const DEFAULT_SIDEBAR_THREAD_SORT_ORDER: SidebarThreadSortOrder = "updated_at";

export const SidebarProjectGroupingMode = Schema.Literals([
  "repository",
  "repository_path",
  "separate",
]);
export type SidebarProjectGroupingMode = typeof SidebarProjectGroupingMode.Type;
export const DEFAULT_SIDEBAR_PROJECT_GROUPING_MODE: SidebarProjectGroupingMode = "repository";

export const EditorLanguageId = Schema.Literals([
  "javascript",
  "typescript",
  "rust",
  "python",
  "solidity",
  "java",
  "csharp",
  "cpp",
  "shell",
  "json",
  "yaml",
  "ini",
  "dockerfile",
  "html",
  "css",
  "markdown",
  "mdx",
  "xml",
]);
export type EditorLanguageId = typeof EditorLanguageId.Type;

export const DEFAULT_EDITOR_ENABLED_LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "rust",
  "python",
  "solidity",
  "java",
  "csharp",
  "cpp",
  "shell",
  "json",
  "yaml",
  "ini",
  "dockerfile",
  "html",
  "css",
  "markdown",
  "mdx",
  "xml",
] as const satisfies readonly EditorLanguageId[];

export const EditorCustomAssociation = Schema.Struct({
  pattern: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  languageId: EditorLanguageId,
});
export type EditorCustomAssociation = typeof EditorCustomAssociation.Type;

export const EditorLanguageServerPreference = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  serverId: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type EditorLanguageServerPreference = typeof EditorLanguageServerPreference.Type;

export const CodeRuleSeverity = Schema.Literals(["off", "warning", "error"]);
export type CodeRuleSeverity = typeof CodeRuleSeverity.Type;

export const JavaScriptCodeRules = Schema.Struct({
  maxFileLines: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(400))),
  maxFileLinesSeverity: CodeRuleSeverity.pipe(
    Schema.withDecodingDefault(Effect.succeed("warning")),
  ),
  unusedImports: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unusedVariables: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  noConsole: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("off"))),
});
export type JavaScriptCodeRules = typeof JavaScriptCodeRules.Type;

export const TypeScriptCodeRules = Schema.Struct({
  maxFileLines: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(400))),
  maxFileLinesSeverity: CodeRuleSeverity.pipe(
    Schema.withDecodingDefault(Effect.succeed("warning")),
  ),
  explicitAny: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unusedImports: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unusedVariables: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  noConsole: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("off"))),
});
export type TypeScriptCodeRules = typeof TypeScriptCodeRules.Type;

export const RustCodeRules = Schema.Struct({
  maxFileLines: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(500))),
  maxFileLinesSeverity: CodeRuleSeverity.pipe(
    Schema.withDecodingDefault(Effect.succeed("warning")),
  ),
  unusedImports: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unusedVariables: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unwrapUsage: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
});
export type RustCodeRules = typeof RustCodeRules.Type;

export const PythonCodeRules = Schema.Struct({
  maxFileLines: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(500))),
  maxFileLinesSeverity: CodeRuleSeverity.pipe(
    Schema.withDecodingDefault(Effect.succeed("warning")),
  ),
  unusedImports: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unusedVariables: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  bareExcept: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
});
export type PythonCodeRules = typeof PythonCodeRules.Type;

export const SolidityCodeRules = Schema.Struct({
  maxFileLines: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(500))),
  maxFileLinesSeverity: CodeRuleSeverity.pipe(
    Schema.withDecodingDefault(Effect.succeed("warning")),
  ),
  unusedImports: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unusedVariables: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  txOriginUsage: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
});
export type SolidityCodeRules = typeof SolidityCodeRules.Type;

export const CppCodeRules = Schema.Struct({
  maxFileLines: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(500))),
  maxFileLinesSeverity: CodeRuleSeverity.pipe(
    Schema.withDecodingDefault(Effect.succeed("warning")),
  ),
  unusedImports: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unusedVariables: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
});
export type CppCodeRules = typeof CppCodeRules.Type;

export const CsharpCodeRules = Schema.Struct({
  maxFileLines: PositiveInt.pipe(Schema.withDecodingDefault(Effect.succeed(500))),
  maxFileLinesSeverity: CodeRuleSeverity.pipe(
    Schema.withDecodingDefault(Effect.succeed("warning")),
  ),
  unusedImports: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
  unusedVariables: CodeRuleSeverity.pipe(Schema.withDecodingDefault(Effect.succeed("warning"))),
});
export type CsharpCodeRules = typeof CsharpCodeRules.Type;

export const CodeRulesSettings = Schema.Struct({
  javascript: JavaScriptCodeRules.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  typescript: TypeScriptCodeRules.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  rust: RustCodeRules.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  python: PythonCodeRules.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  solidity: SolidityCodeRules.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  cpp: CppCodeRules.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  csharp: CsharpCodeRules.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodeRulesSettings = typeof CodeRulesSettings.Type;

export const DEFAULT_EDITOR_LANGUAGE_SERVER_PREFERENCES: Record<
  string,
  EditorLanguageServerPreference
> = {
  javascript: {
    enabled: true,
    serverId: "typescript-language-server",
  },
  typescript: {
    enabled: true,
    serverId: "typescript-language-server",
  },
  rust: {
    enabled: true,
    serverId: "rust-analyzer",
  },
  python: {
    enabled: true,
    serverId: "pyright-langserver",
  },
  solidity: {
    enabled: true,
    serverId: "solidity-language-server",
  },
  cpp: {
    enabled: true,
    serverId: "clangd",
  },
  java: {
    enabled: true,
    serverId: "jdtls",
  },
  csharp: {
    enabled: true,
    serverId: "csharp-ls",
  },
  html: {
    enabled: true,
    serverId: "vscode-html-language-server",
  },
  css: {
    enabled: true,
    serverId: "vscode-css-language-server",
  },
};

export const ClientSettingsSchema = Schema.Struct({
  confirmThreadArchive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  confirmThreadDelete: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  diffWordWrap: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  editorCustomAssociations: Schema.Array(EditorCustomAssociation).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  editorEnabledLanguageIds: Schema.Array(EditorLanguageId).pipe(
    Schema.withDecodingDefault(Effect.succeed([...DEFAULT_EDITOR_ENABLED_LANGUAGE_IDS])),
  ),
  editorLanguageServerPreferences: Schema.Record(
    TrimmedNonEmptyString,
    EditorLanguageServerPreference,
  ).pipe(
    Schema.withDecodingDefault(Effect.succeed({ ...DEFAULT_EDITOR_LANGUAGE_SERVER_PREFERENCES })),
  ),
  enableMonacoEditorDiagnostics: Schema.Boolean.pipe(
    Schema.withDecodingDefault(Effect.succeed(false)),
  ),
  enableProjectDiagnostics: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  sidebarProjectGroupingMode: SidebarProjectGroupingMode.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_PROJECT_GROUPING_MODE)),
  ),
  sidebarProjectGroupingOverrides: Schema.Record(
    TrimmedNonEmptyString,
    SidebarProjectGroupingMode,
  ).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  sidebarProjectSortOrder: SidebarProjectSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_PROJECT_SORT_ORDER)),
  ),
  sidebarThreadSortOrder: SidebarThreadSortOrder.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_SIDEBAR_THREAD_SORT_ORDER)),
  ),
  timestampFormat: TimestampFormat.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TIMESTAMP_FORMAT)),
  ),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

// ── Server Settings (server-authoritative) ────────────────────

export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

const makeBinaryPathSetting = (fallback: string) =>
  TrimmedString.pipe(
    Schema.decodeTo(
      Schema.String,
      SchemaTransformation.transformOrFail({
        decode: (value) => Effect.succeed(value || fallback),
        encode: (value) => Effect.succeed(value),
      }),
    ),
    Schema.withDecodingDefault(Effect.succeed(fallback)),
  );

export const CodexSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("codex"),
  homePath: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodexSettings = typeof CodexSettings.Type;

export const ClaudeSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("claude"),
  customModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ClaudeSettings = typeof ClaudeSettings.Type;

export const ObservabilitySettings = Schema.Struct({
  otlpTracesUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  otlpMetricsUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ObservabilitySettings = typeof ObservabilitySettings.Type;

export const TypeScriptLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("typescript-language-server"),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("--stdio"))),
});
export type TypeScriptLanguageServerSettings = typeof TypeScriptLanguageServerSettings.Type;

export const RustLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("rust-analyzer"),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type RustLanguageServerSettings = typeof RustLanguageServerSettings.Type;

export const PythonLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("pyright-langserver"),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("--stdio"))),
});
export type PythonLanguageServerSettings = typeof PythonLanguageServerSettings.Type;

export const SolidityLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("nomicfoundation-solidity-language-server"),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("--stdio"))),
});
export type SolidityLanguageServerSettings = typeof SolidityLanguageServerSettings.Type;

export const CppLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("clangd"),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  compileCommandsDirectory: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type CppLanguageServerSettings = typeof CppLanguageServerSettings.Type;

export const JavaLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("jdtls"),
  jvmArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  workspaceStoragePath: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type JavaLanguageServerSettings = typeof JavaLanguageServerSettings.Type;

export const CsharpLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("csharp-ls"),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type CsharpLanguageServerSettings = typeof CsharpLanguageServerSettings.Type;

export const HtmlLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("vscode-html-language-server"),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("--stdio"))),
});
export type HtmlLanguageServerSettings = typeof HtmlLanguageServerSettings.Type;

export const CssLanguageServerSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  binaryPath: makeBinaryPathSetting("vscode-css-language-server"),
  launchArgs: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed("--stdio"))),
});
export type CssLanguageServerSettings = typeof CssLanguageServerSettings.Type;

export const ServerSettings = Schema.Struct({
  enableAssistantStreaming: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  defaultThreadEnvMode: ThreadEnvMode.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const satisfies ThreadEnvMode)),
  ),
  addProjectBaseDirectory: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  codeRules: CodeRulesSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  textGenerationModelSelection: ModelSelection.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        provider: "codex" as const,
        model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
      }),
    ),
  ),

  // Provider specific settings
  providers: Schema.Struct({
    codex: CodexSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    claudeAgent: ClaudeSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  languageServers: Schema.Struct({
    typescript: TypeScriptLanguageServerSettings.pipe(
      Schema.withDecodingDefault(Effect.succeed({})),
    ),
    rust: RustLanguageServerSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    python: PythonLanguageServerSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    solidity: SolidityLanguageServerSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    cpp: CppLanguageServerSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    java: JavaLanguageServerSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    csharp: CsharpLanguageServerSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    html: HtmlLanguageServerSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
    css: CssLanguageServerSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  }).pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  observability: ObservabilitySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export const DEFAULT_SERVER_SETTINGS: ServerSettings = Schema.decodeSync(ServerSettings)({});

export class ServerSettingsError extends Schema.TaggedErrorClass<ServerSettingsError>()(
  "ServerSettingsError",
  {
    settingsPath: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Server settings error at ${this.settingsPath}: ${this.detail}`;
  }
}

// ── Unified type ─────────────────────────────────────────────────────

export type UnifiedSettings = ServerSettings & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  ...DEFAULT_CLIENT_SETTINGS,
};

// ── Server Settings Patch (replace with a Schema.deepPartial if available) ──────────────────────────────────────────

const CodexModelOptionsPatch = Schema.Struct({
  reasoningEffort: Schema.optionalKey(CodexModelOptions.fields.reasoningEffort),
  fastMode: Schema.optionalKey(CodexModelOptions.fields.fastMode),
});

const ClaudeModelOptionsPatch = Schema.Struct({
  thinking: Schema.optionalKey(ClaudeModelOptions.fields.thinking),
  effort: Schema.optionalKey(ClaudeModelOptions.fields.effort),
  fastMode: Schema.optionalKey(ClaudeModelOptions.fields.fastMode),
  contextWindow: Schema.optionalKey(ClaudeModelOptions.fields.contextWindow),
});

const ModelSelectionPatch = Schema.Union([
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("codex")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(CodexModelOptionsPatch),
  }),
  Schema.Struct({
    provider: Schema.optionalKey(Schema.Literal("claudeAgent")),
    model: Schema.optionalKey(TrimmedNonEmptyString),
    options: Schema.optionalKey(ClaudeModelOptionsPatch),
  }),
]);

const CodexSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  homePath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ClaudeSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  customModels: Schema.optionalKey(Schema.Array(Schema.String)),
  launchArgs: Schema.optionalKey(Schema.String),
});

const TypeScriptLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
});

const RustLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
});

const PythonLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
});

const SolidityLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
});

const CppLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
  compileCommandsDirectory: Schema.optionalKey(Schema.String),
});

const JavaLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  jvmArgs: Schema.optionalKey(Schema.String),
  workspaceStoragePath: Schema.optionalKey(Schema.String),
});

const CsharpLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
});

const HtmlLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
});

const CssLanguageServerSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  binaryPath: Schema.optionalKey(Schema.String),
  launchArgs: Schema.optionalKey(Schema.String),
});

const JavaScriptCodeRulesPatch = Schema.Struct({
  maxFileLines: Schema.optionalKey(PositiveInt),
  maxFileLinesSeverity: Schema.optionalKey(CodeRuleSeverity),
  unusedImports: Schema.optionalKey(CodeRuleSeverity),
  unusedVariables: Schema.optionalKey(CodeRuleSeverity),
  noConsole: Schema.optionalKey(CodeRuleSeverity),
});

const TypeScriptCodeRulesPatch = Schema.Struct({
  maxFileLines: Schema.optionalKey(PositiveInt),
  maxFileLinesSeverity: Schema.optionalKey(CodeRuleSeverity),
  explicitAny: Schema.optionalKey(CodeRuleSeverity),
  unusedImports: Schema.optionalKey(CodeRuleSeverity),
  unusedVariables: Schema.optionalKey(CodeRuleSeverity),
  noConsole: Schema.optionalKey(CodeRuleSeverity),
});

const RustCodeRulesPatch = Schema.Struct({
  maxFileLines: Schema.optionalKey(PositiveInt),
  maxFileLinesSeverity: Schema.optionalKey(CodeRuleSeverity),
  unusedImports: Schema.optionalKey(CodeRuleSeverity),
  unusedVariables: Schema.optionalKey(CodeRuleSeverity),
  unwrapUsage: Schema.optionalKey(CodeRuleSeverity),
});

const PythonCodeRulesPatch = Schema.Struct({
  maxFileLines: Schema.optionalKey(PositiveInt),
  maxFileLinesSeverity: Schema.optionalKey(CodeRuleSeverity),
  unusedImports: Schema.optionalKey(CodeRuleSeverity),
  unusedVariables: Schema.optionalKey(CodeRuleSeverity),
  bareExcept: Schema.optionalKey(CodeRuleSeverity),
});

const SolidityCodeRulesPatch = Schema.Struct({
  maxFileLines: Schema.optionalKey(PositiveInt),
  maxFileLinesSeverity: Schema.optionalKey(CodeRuleSeverity),
  unusedImports: Schema.optionalKey(CodeRuleSeverity),
  unusedVariables: Schema.optionalKey(CodeRuleSeverity),
  txOriginUsage: Schema.optionalKey(CodeRuleSeverity),
});

const CppCodeRulesPatch = Schema.Struct({
  maxFileLines: Schema.optionalKey(PositiveInt),
  maxFileLinesSeverity: Schema.optionalKey(CodeRuleSeverity),
  unusedImports: Schema.optionalKey(CodeRuleSeverity),
  unusedVariables: Schema.optionalKey(CodeRuleSeverity),
});

const CsharpCodeRulesPatch = Schema.Struct({
  maxFileLines: Schema.optionalKey(PositiveInt),
  maxFileLinesSeverity: Schema.optionalKey(CodeRuleSeverity),
  unusedImports: Schema.optionalKey(CodeRuleSeverity),
  unusedVariables: Schema.optionalKey(CodeRuleSeverity),
});

const CodeRulesSettingsPatch = Schema.Struct({
  javascript: Schema.optionalKey(JavaScriptCodeRulesPatch),
  typescript: Schema.optionalKey(TypeScriptCodeRulesPatch),
  rust: Schema.optionalKey(RustCodeRulesPatch),
  python: Schema.optionalKey(PythonCodeRulesPatch),
  solidity: Schema.optionalKey(SolidityCodeRulesPatch),
  cpp: Schema.optionalKey(CppCodeRulesPatch),
  csharp: Schema.optionalKey(CsharpCodeRulesPatch),
});

export const ServerSettingsPatch = Schema.Struct({
  enableAssistantStreaming: Schema.optionalKey(Schema.Boolean),
  defaultThreadEnvMode: Schema.optionalKey(ThreadEnvMode),
  addProjectBaseDirectory: Schema.optionalKey(Schema.String),
  codeRules: Schema.optionalKey(CodeRulesSettingsPatch),
  textGenerationModelSelection: Schema.optionalKey(ModelSelectionPatch),
  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(Schema.String),
      otlpMetricsUrl: Schema.optionalKey(Schema.String),
    }),
  ),
  providers: Schema.optionalKey(
    Schema.Struct({
      codex: Schema.optionalKey(CodexSettingsPatch),
      claudeAgent: Schema.optionalKey(ClaudeSettingsPatch),
    }),
  ),
  languageServers: Schema.optionalKey(
    Schema.Struct({
      typescript: Schema.optionalKey(TypeScriptLanguageServerSettingsPatch),
      rust: Schema.optionalKey(RustLanguageServerSettingsPatch),
      python: Schema.optionalKey(PythonLanguageServerSettingsPatch),
      solidity: Schema.optionalKey(SolidityLanguageServerSettingsPatch),
      cpp: Schema.optionalKey(CppLanguageServerSettingsPatch),
      java: Schema.optionalKey(JavaLanguageServerSettingsPatch),
      csharp: Schema.optionalKey(CsharpLanguageServerSettingsPatch),
      html: Schema.optionalKey(HtmlLanguageServerSettingsPatch),
      css: Schema.optionalKey(CssLanguageServerSettingsPatch),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;
