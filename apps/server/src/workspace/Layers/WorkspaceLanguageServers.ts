import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import NodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect, Layer, PubSub, Stream } from "effect";

import type {
  ProjectDiagnostic,
  ProjectLanguageServerCapabilities,
  ProjectLanguageServerCodeAction,
  ProjectLanguageServerCodeActionsResult,
  ProjectLanguageServerCompletionItem,
  ProjectLanguageServerCompletionResult,
  ProjectLanguageServerDefinitionResult,
  ProjectLanguageServerDiagnosticsEvent,
  ProjectLanguageServerDocumentSyncInput,
  ProjectLanguageServerHoverResult,
  ProjectLanguageServerLocation,
  ProjectLanguageServerPositionInput,
  ProjectLanguageServerRange,
  ProjectLanguageServerReferencesResult,
  ProjectLanguageServerRenameInput,
  ProjectLanguageServerRenameResult,
  ProjectLanguageServerSessionEvent,
  ProjectLanguageServerSessionStatus,
  ProjectLanguageServerStartInput,
  ProjectLanguageServerStartResult,
  ProjectLanguageServerStreamEvent,
  ProjectLanguageServerSubscribeInput,
  ProjectLanguageServerTextEdit,
} from "@t3delta/contracts";
import {
  WorkspaceLanguageServers,
  WorkspaceLanguageServersError,
  type WorkspaceLanguageServersShape,
} from "../Services/WorkspaceLanguageServers.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const EMPTY_CAPABILITIES: ProjectLanguageServerCapabilities = {
  diagnostics: false,
  hover: false,
  completion: false,
  definition: false,
  references: false,
  rename: false,
  codeAction: false,
};

const START_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;
const MAX_RESTART_ATTEMPTS = 2;

interface ServerDescriptor {
  readonly commandCandidates: readonly string[];
  readonly args: readonly string[];
}

interface LaunchConfig {
  readonly enabled: boolean;
  readonly command: string;
  readonly args: readonly string[];
  readonly detail?: string;
}

const SERVER_DESCRIPTORS: Record<string, ServerDescriptor> = {
  "typescript-language-server": {
    commandCandidates: ["typescript-language-server"],
    args: ["--stdio"],
  },
  "rust-analyzer": {
    commandCandidates: ["rust-analyzer"],
    args: [],
  },
  "pyright-langserver": {
    commandCandidates: ["pyright-langserver"],
    args: ["--stdio"],
  },
  "solidity-language-server": {
    commandCandidates: ["nomicfoundation-solidity-language-server", "solidity-language-server"],
    args: ["--stdio"],
  },
  clangd: {
    commandCandidates: ["clangd"],
    args: [],
  },
  jdtls: {
    commandCandidates: ["jdtls"],
    args: [],
  },
  "csharp-ls": {
    commandCandidates: ["csharp-ls"],
    args: [],
  },
  "vscode-html-language-server": {
    commandCandidates: ["vscode-html-language-server", "html-languageserver"],
    args: ["--stdio"],
  },
  "vscode-css-language-server": {
    commandCandidates: ["vscode-css-language-server", "css-languageserver"],
    args: ["--stdio"],
  },
};

const TYPESCRIPT_LIKE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const RUST_EXTENSIONS = new Set([".rs"]);
const PYTHON_EXTENSIONS = new Set([".py", ".pyi"]);
const SOLIDITY_EXTENSIONS = new Set([".sol"]);
const CPP_EXTENSIONS = new Set([".c", ".h", ".cc", ".cpp", ".cxx", ".hpp", ".hxx"]);
const JAVA_EXTENSIONS = new Set([".java"]);
const CSHARP_EXTENSIONS = new Set([".cs", ".csx"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const CSS_EXTENSIONS = new Set([".css"]);
const BUNDLED_LANGUAGE_SERVER_ROOTS = [
  fileURLToPath(new URL("../../../", import.meta.url)),
  fileURLToPath(new URL("../../../../../", import.meta.url)),
];

function toWorkspaceStorageSlug(workspaceRoot: string): string {
  return Buffer.from(workspaceRoot).toString("base64url");
}

interface JsonRpcRequestMessage {
  readonly jsonrpc: "2.0";
  readonly id: number;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcClientRequestMessage {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcNotificationMessage {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcSuccessResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly result?: unknown;
}

interface JsonRpcErrorResponse {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
  };
}

type JsonRpcIncoming =
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse
  | JsonRpcClientRequestMessage
  | JsonRpcNotificationMessage;

interface OpenDocumentState {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly uri: string;
  readonly languageId: string;
  readonly version: number;
  readonly text: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pathExists(pathValue: string): Promise<boolean> {
  try {
    await fs.promises.access(pathValue, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveLocalNodeBinary(
  workspaceRoot: string,
  binaryName: string,
): Promise<string | null> {
  const candidates =
    process.platform === "win32"
      ? [`${binaryName}.cmd`, `${binaryName}.exe`, binaryName]
      : [binaryName];

  const searchRoots = [workspaceRoot, ...BUNDLED_LANGUAGE_SERVER_ROOTS].filter(
    (root, index, roots) => roots.indexOf(root) === index,
  );

  for (const root of searchRoots) {
    for (const candidate of candidates) {
      const candidatePath = NodePath.join(root, "node_modules", ".bin", candidate);
      if (await pathExists(candidatePath)) {
        return candidatePath;
      }
    }
  }

  return null;
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

async function findUpwardsBySuffix(
  startDirectory: string,
  rootDirectory: string,
  suffixes: readonly string[],
): Promise<string | null> {
  let currentDirectory = NodePath.resolve(startDirectory);
  const normalizedRoot = NodePath.resolve(rootDirectory);

  while (true) {
    try {
      const entries = await fs.promises.readdir(currentDirectory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }
        const lowerName = entry.name.toLowerCase();
        if (suffixes.some((suffix) => lowerName.endsWith(suffix))) {
          return NodePath.join(currentDirectory, entry.name);
        }
      }
    } catch {
      // Ignore unreadable directories and continue upward.
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

async function detectWorkspaceRootForServer(input: {
  cwd: string;
  serverId: string;
  absolutePath?: string;
}): Promise<string> {
  if (!input.absolutePath) {
    return input.cwd;
  }

  const extension = NodePath.extname(input.absolutePath).toLowerCase();
  if (input.serverId === "typescript-language-server") {
    if (!TYPESCRIPT_LIKE_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const configPath = await findUpwards(startDirectory, input.cwd, [
      "tsconfig.json",
      "jsconfig.json",
    ]);
    if (configPath) {
      return NodePath.dirname(configPath);
    }

    const packageJsonPath = await findUpwards(startDirectory, input.cwd, ["package.json"]);
    if (packageJsonPath) {
      return NodePath.dirname(packageJsonPath);
    }

    return input.cwd;
  }

  if (input.serverId === "rust-analyzer") {
    if (!RUST_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const nearestCargoToml = await findUpwards(startDirectory, input.cwd, ["Cargo.toml"]);
    if (!nearestCargoToml) {
      return input.cwd;
    }

    let selectedRoot = NodePath.dirname(nearestCargoToml);
    let currentDirectory = NodePath.dirname(selectedRoot);
    const normalizedCwd = NodePath.resolve(input.cwd);

    while (currentDirectory.startsWith(normalizedCwd)) {
      const candidatePath = NodePath.join(currentDirectory, "Cargo.toml");
      if (!(await pathExists(candidatePath))) {
        const parentDirectory = NodePath.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
          break;
        }
        currentDirectory = parentDirectory;
        continue;
      }

      const manifestContents = await fs.promises.readFile(candidatePath, "utf8");
      if (manifestContents.includes("[workspace]")) {
        selectedRoot = currentDirectory;
      }

      if (currentDirectory === normalizedCwd) {
        break;
      }

      const parentDirectory = NodePath.dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        break;
      }
      currentDirectory = parentDirectory;
    }

    return selectedRoot;
  }

  if (input.serverId === "pyright-langserver") {
    if (!PYTHON_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const pythonProjectPath = await findUpwards(startDirectory, input.cwd, [
      "pyproject.toml",
      "setup.cfg",
      "setup.py",
      "requirements.txt",
    ]);
    if (pythonProjectPath) {
      return NodePath.dirname(pythonProjectPath);
    }

    return input.cwd;
  }

  if (input.serverId === "solidity-language-server") {
    if (!SOLIDITY_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const solidityProjectPath = await findUpwards(startDirectory, input.cwd, [
      "foundry.toml",
      "hardhat.config.ts",
      "hardhat.config.js",
      "hardhat.config.cjs",
      "hardhat.config.mjs",
      "truffle-config.ts",
      "truffle-config.js",
      "remappings.txt",
      "package.json",
    ]);
    if (solidityProjectPath) {
      return NodePath.dirname(solidityProjectPath);
    }

    return input.cwd;
  }

  if (input.serverId === "clangd") {
    if (!CPP_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const cppProjectPath = await findUpwards(startDirectory, input.cwd, [
      "compile_commands.json",
      "compile_flags.txt",
      "CMakeLists.txt",
      "Makefile",
    ]);
    if (cppProjectPath) {
      return NodePath.dirname(cppProjectPath);
    }

    return input.cwd;
  }

  if (input.serverId === "jdtls") {
    if (!JAVA_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const javaProjectPath = await findUpwards(startDirectory, input.cwd, [
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "settings.gradle.kts",
      ".project",
    ]);
    if (javaProjectPath) {
      return NodePath.dirname(javaProjectPath);
    }

    return input.cwd;
  }

  if (input.serverId === "csharp-ls") {
    if (!CSHARP_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const csharpProjectPath = await findUpwardsBySuffix(startDirectory, input.cwd, [
      ".sln",
      ".csproj",
    ]);
    if (csharpProjectPath) {
      return NodePath.dirname(csharpProjectPath);
    }

    return input.cwd;
  }

  if (input.serverId === "vscode-html-language-server") {
    if (!HTML_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const htmlProjectPath = await findUpwards(startDirectory, input.cwd, [
      "package.json",
      "vite.config.ts",
      "vite.config.js",
      "astro.config.mjs",
      "next.config.js",
    ]);
    if (htmlProjectPath) {
      return NodePath.dirname(htmlProjectPath);
    }

    return input.cwd;
  }

  if (input.serverId === "vscode-css-language-server") {
    if (!CSS_EXTENSIONS.has(extension)) {
      return input.cwd;
    }

    const startDirectory = NodePath.dirname(input.absolutePath);
    const cssProjectPath = await findUpwards(startDirectory, input.cwd, [
      "package.json",
      "vite.config.ts",
      "vite.config.js",
      "postcss.config.js",
      "tailwind.config.js",
      "tailwind.config.ts",
    ]);
    if (cssProjectPath) {
      return NodePath.dirname(cssProjectPath);
    }

    return input.cwd;
  }

  return input.cwd;
}

async function resolveCommand(
  workspaceRoot: string,
  serverId: string,
  overrideBinaryPath?: string,
): Promise<string> {
  if (overrideBinaryPath && overrideBinaryPath.trim().length > 0) {
    const localBinary = await resolveLocalNodeBinary(workspaceRoot, overrideBinaryPath.trim());
    if (localBinary) {
      return localBinary;
    }
    return overrideBinaryPath.trim();
  }

  const descriptor = SERVER_DESCRIPTORS[serverId];
  if (!descriptor) {
    return serverId;
  }

  for (const candidate of descriptor.commandCandidates) {
    const localBinary = await resolveLocalNodeBinary(workspaceRoot, candidate);
    if (localBinary) {
      return localBinary;
    }
  }

  return descriptor.commandCandidates[0] ?? serverId;
}

function summarizeCapabilities(capabilities: any): ProjectLanguageServerCapabilities {
  return {
    diagnostics: true,
    hover: Boolean(capabilities?.hoverProvider),
    completion: Boolean(capabilities?.completionProvider),
    definition: Boolean(capabilities?.definitionProvider),
    references: Boolean(capabilities?.referencesProvider),
    rename: Boolean(capabilities?.renameProvider),
    codeAction: Boolean(capabilities?.codeActionProvider),
  };
}

function toDiagnosticSeverity(value: number | undefined): ProjectDiagnostic["severity"] {
  switch (value) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 4:
      return "hint";
    default:
      return "information";
  }
}

function toLspPosition(line: number, column: number) {
  return {
    line: Math.max(0, line - 1),
    character: Math.max(0, column - 1),
  };
}

function toRange(range: any): ProjectLanguageServerRange {
  return {
    startLine: Math.max(1, (range?.start?.line ?? 0) + 1),
    startColumn: Math.max(1, (range?.start?.character ?? 0) + 1),
    endLine: Math.max(1, (range?.end?.line ?? 0) + 1),
    endColumn: Math.max(1, (range?.end?.character ?? 0) + 1),
  };
}

function markdownToString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => markdownToString(item))
      .filter((item): item is string => typeof item === "string" && item.length > 0);
    return parts.length > 0 ? parts.join("\n\n") : undefined;
  }
  if (typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return markdownToString((value as Record<string, unknown>).value);
  }
  return undefined;
}

export class StdioJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly onNotification: (method: string, params: unknown) => void;
  private readonly onRequest: (method: string, params: unknown) => Promise<unknown> | unknown;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;
  private buffer = Buffer.alloc(0);

  constructor(
    child: ChildProcessWithoutNullStreams,
    onNotification: (method: string, params: unknown) => void,
    onRequest?: (method: string, params: unknown) => Promise<unknown> | unknown,
  ) {
    this.child = child;
    this.onNotification = onNotification;
    this.onRequest = onRequest ?? (() => null);
    child.stdout.on("data", (chunk: Buffer) => {
      this.handleChunk(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const output = chunk.toString("utf8").trim();
      if (output.length > 0) {
        console.warn(`[lsp] stderr: ${output}`);
      }
    });
  }

  request(method: string, params?: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcRequestMessage = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.writeMessage(message);
    });
  }

  notify(method: string, params?: unknown): void {
    const message: JsonRpcNotificationMessage = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };
    this.writeMessage(message);
  }

  dispose(error?: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error ?? new Error("LSP request cancelled."));
    }
    this.pending.clear();
  }

  private writeMessage(
    message:
      | JsonRpcRequestMessage
      | JsonRpcNotificationMessage
      | JsonRpcSuccessResponse
      | JsonRpcErrorResponse,
  ): void {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8");
    this.child.stdin.write(header);
    this.child.stdin.write(payload);
  }

  private respondToServerRequest(id: number | string, result: unknown): void {
    this.writeMessage({
      jsonrpc: "2.0",
      id,
      result: result ?? null,
    });
  }

  private respondToServerRequestError(id: number | string, error: unknown): void {
    this.writeMessage({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Unhandled client request.",
      },
    });
  }

  private handleChunk(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const headerText = this.buffer.subarray(0, headerEnd).toString("utf8");
      const lengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!lengthMatch) {
        this.buffer = Buffer.alloc(0);
        return;
      }

      const contentLength = Number.parseInt(lengthMatch[1] ?? "0", 10);
      const totalLength = headerEnd + 4 + contentLength;
      if (this.buffer.length < totalLength) {
        return;
      }

      const payloadBuffer = this.buffer.subarray(headerEnd + 4, totalLength);
      this.buffer = this.buffer.subarray(totalLength);

      const parsed = JSON.parse(payloadBuffer.toString("utf8")) as JsonRpcIncoming;
      this.handleMessage(parsed);
    }
  }

  private handleMessage(message: JsonRpcIncoming): void {
    if ("method" in message) {
      if ("id" in message) {
        void Promise.resolve(this.onRequest(message.method, message.params))
          .then((result) => {
            this.respondToServerRequest(message.id, result);
          })
          .catch((error) => {
            this.respondToServerRequestError(message.id, error);
          });
        return;
      }
      this.onNotification(message.method, message.params);
      return;
    }

    if (typeof message.id !== "number") {
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(message.id);

    if ("error" in message && message.error) {
      pending.reject(new Error(message.error.message ?? "Unknown LSP error"));
      return;
    }

    pending.resolve("result" in message ? message.result : null);
  }
}

class LanguageServerSession {
  readonly workspaceRoot: string;
  readonly serverId: string;
  private readonly resolveLaunchConfig: (
    workspaceRoot: string,
    serverId: string,
  ) => Promise<LaunchConfig>;
  private readonly publish: (event: ProjectLanguageServerStreamEvent) => void;
  private child: ChildProcessWithoutNullStreams | null = null;
  private rpc: StdioJsonRpcClient | null = null;
  private status: ProjectLanguageServerSessionStatus = "stopped";
  private capabilities: ProjectLanguageServerCapabilities = EMPTY_CAPABILITIES;
  private startingPromise: Promise<ProjectLanguageServerStartResult> | null = null;
  private stopRequested = false;
  private restartAttempts = 0;
  private readonly openDocuments = new Map<string, OpenDocumentState>();
  private publicWorkspaceRoot: string;

  constructor(
    workspaceRoot: string,
    serverId: string,
    resolveLaunchConfig: (workspaceRoot: string, serverId: string) => Promise<LaunchConfig>,
    publish: (event: ProjectLanguageServerStreamEvent) => void,
    publicWorkspaceRoot: string,
  ) {
    this.workspaceRoot = workspaceRoot;
    this.serverId = serverId;
    this.resolveLaunchConfig = resolveLaunchConfig;
    this.publish = publish;
    this.publicWorkspaceRoot = publicWorkspaceRoot;
  }

  private get descriptor(): ServerDescriptor | undefined {
    return SERVER_DESCRIPTORS[this.serverId];
  }

  private resolveWorkspaceConfiguration(section: string | undefined): unknown {
    switch (section) {
      case "html":
      case "css":
      case "javascript":
      case "js/ts":
        return {};
      default:
        return null;
    }
  }

  private handleServerRequest(method: string, params: unknown): unknown {
    if (method === "workspace/workspaceFolders") {
      return [
        {
          uri: pathToFileURL(this.workspaceRoot).toString(),
          name: NodePath.basename(this.workspaceRoot),
        },
      ];
    }

    if (method === "workspace/configuration") {
      const items = Array.isArray((params as { readonly items?: unknown[] } | null)?.items)
        ? ((params as { readonly items?: unknown[] }).items ?? [])
        : [];
      return items.map((item) =>
        this.resolveWorkspaceConfiguration(
          typeof (item as { readonly section?: unknown } | null)?.section === "string"
            ? ((item as { readonly section?: string }).section ?? undefined)
            : undefined,
        ),
      );
    }

    if (
      method === "client/registerCapability" ||
      method === "client/unregisterCapability" ||
      method === "window/workDoneProgress/create"
    ) {
      return null;
    }

    return null;
  }

  private sessionEvent(
    status: ProjectLanguageServerSessionStatus,
    detail?: string,
  ): ProjectLanguageServerSessionEvent {
    return {
      type: "session",
      session: {
        cwd: this.publicWorkspaceRoot,
        serverId: this.serverId,
      },
      status,
      capabilities: this.capabilities,
      ...(detail ? { detail } : {}),
    };
  }

  async start(): Promise<ProjectLanguageServerStartResult> {
    if (this.status === "running") {
      return {
        session: { cwd: this.publicWorkspaceRoot, serverId: this.serverId },
        status: this.status,
        capabilities: this.capabilities,
      };
    }
    if (this.startingPromise) {
      return this.startingPromise;
    }

    this.startingPromise = this.startInternal();
    try {
      return await this.startingPromise;
    } finally {
      this.startingPromise = null;
    }
  }

  private async startInternal(): Promise<ProjectLanguageServerStartResult> {
    if (!this.descriptor) {
      this.status = "failed";
      const detail = `Unsupported language server id: ${this.serverId}`;
      console.warn(`[lsp] ${detail}`);
      this.publish(this.sessionEvent(this.status, detail));
      return {
        session: { cwd: this.publicWorkspaceRoot, serverId: this.serverId },
        status: this.status,
        capabilities: this.capabilities,
        detail,
      };
    }

    this.stopRequested = false;
    this.status = "starting";
    this.publish(this.sessionEvent(this.status));

    const launchConfig = await this.resolveLaunchConfig(this.workspaceRoot, this.serverId);
    if (!launchConfig.enabled) {
      this.status = "stopped";
      const detail = `${this.serverId} is disabled in server settings.`;
      this.publish(this.sessionEvent(this.status, detail));
      return {
        session: { cwd: this.publicWorkspaceRoot, serverId: this.serverId },
        status: this.status,
        capabilities: this.capabilities,
        detail,
      };
    }

    const command = launchConfig.command;
    const args = [...launchConfig.args];
    const launchDetail = launchConfig.detail;

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd: this.workspaceRoot,
        env: process.env,
        stdio: "pipe",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to spawn language server.";
      this.status = "failed";
      console.error(`[lsp] ${this.serverId} spawn failed: ${detail}`);
      this.publish(this.sessionEvent(this.status, detail));
      return {
        session: { cwd: this.publicWorkspaceRoot, serverId: this.serverId },
        status: this.status,
        capabilities: this.capabilities,
        detail,
      };
    }

    this.child = child;

    return new Promise<ProjectLanguageServerStartResult>((resolve) => {
      let settled = false;

      const settle = (result: ProjectLanguageServerStartResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const failStartup = (status: ProjectLanguageServerSessionStatus, detail: string) => {
        this.stopRequested = true;
        this.capabilities = EMPTY_CAPABILITIES;
        this.status = status;
        if (status === "missingBinary") {
          console.warn(`[lsp] ${this.serverId} missing: ${detail}`);
        } else {
          console.error(`[lsp] ${this.serverId} failed: ${detail}`);
        }
        this.publish(this.sessionEvent(status, detail));
        settle({
          session: { cwd: this.publicWorkspaceRoot, serverId: this.serverId },
          status,
          capabilities: this.capabilities,
          detail,
        });
      };

      const startupTimeout = setTimeout(() => {
        failStartup("failed", `Timed out starting ${this.serverId}.`);
        void this.forceKill();
      }, START_TIMEOUT_MS);

      child.once("error", (error) => {
        clearTimeout(startupTimeout);
        const missingBinary = (error as NodeJS.ErrnoException).code === "ENOENT";
        failStartup(missingBinary ? "missingBinary" : "failed", error.message);
      });

      child.once("exit", (code, signal) => {
        if (!settled) {
          clearTimeout(startupTimeout);
          failStartup(
            "failed",
            `Server exited during startup (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
          );
          return;
        }
        this.handleExit(code, signal);
      });

      this.rpc = new StdioJsonRpcClient(
        child,
        (method, params) => {
          if (method === "textDocument/publishDiagnostics") {
            this.handleDiagnostics(params);
          }
        },
        (method, params) => this.handleServerRequest(method, params),
      );

      void this.rpc
        .request(
          "initialize",
          {
            processId: process.pid,
            rootUri: pathToFileURL(this.workspaceRoot).toString(),
            capabilities: {
              textDocument: {
                hover: { dynamicRegistration: false },
                definition: { dynamicRegistration: false },
                references: { dynamicRegistration: false },
                rename: { dynamicRegistration: false },
                completion: { dynamicRegistration: false },
                codeAction: { dynamicRegistration: false },
                publishDiagnostics: { relatedInformation: true },
                synchronization: {
                  dynamicRegistration: false,
                  willSave: false,
                  didSave: true,
                  willSaveWaitUntil: false,
                },
              },
              workspace: {
                workspaceFolders: true,
              },
            },
            workspaceFolders: [
              {
                uri: pathToFileURL(this.workspaceRoot).toString(),
                name: NodePath.basename(this.workspaceRoot),
              },
            ],
            initializationOptions: {},
          },
          START_TIMEOUT_MS,
        )
        .then(async (response) => {
          clearTimeout(startupTimeout);
          this.capabilities = summarizeCapabilities((response as any)?.capabilities ?? {});
          this.status = "running";
          this.restartAttempts = 0;
          this.rpc?.notify("initialized", {});
          await this.reopenDocuments();
          this.publish(this.sessionEvent(this.status, launchDetail));
          settle({
            session: { cwd: this.publicWorkspaceRoot, serverId: this.serverId },
            status: this.status,
            capabilities: this.capabilities,
            ...(launchDetail ? { detail: launchDetail } : {}),
          });
        })
        .catch((error: unknown) => {
          clearTimeout(startupTimeout);
          failStartup("failed", error instanceof Error ? error.message : "Initialization failed.");
          void this.forceKill();
        });
    });
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    const child = this.child;
    const rpc = this.rpc;
    this.child = null;
    this.rpc = null;
    this.capabilities = EMPTY_CAPABILITIES;

    if (!child || !rpc) {
      this.status = "stopped";
      this.publish(this.sessionEvent(this.status));
      return;
    }

    try {
      await rpc.request("shutdown", {}, SHUTDOWN_TIMEOUT_MS).catch(() => undefined);
      rpc.notify("exit", {});
    } finally {
      rpc.dispose();
      if (!child.killed) {
        child.kill();
      }
      this.status = "stopped";
      this.publish(this.sessionEvent(this.status));
    }
  }

  async syncDocument(input: {
    readonly publicWorkspaceRoot: string;
    readonly absolutePath: string;
    readonly relativePath: string;
    readonly languageId: string;
    readonly version: number;
    readonly action: ProjectLanguageServerDocumentSyncInput["action"];
    readonly text?: string;
  }): Promise<void> {
    this.publicWorkspaceRoot = input.publicWorkspaceRoot;
    const startResult = await this.start();
    if (startResult.status !== "running" || !this.rpc) {
      return;
    }

    const uri = pathToFileURL(input.absolutePath).toString();
    const existing = this.openDocuments.get(uri);

    if (input.action === "close") {
      if (existing) {
        this.rpc.notify("textDocument/didClose", {
          textDocument: { uri },
        });
        this.openDocuments.delete(uri);
      }
      return;
    }

    const text = input.text ?? existing?.text ?? "";
    const nextState: OpenDocumentState = {
      absolutePath: input.absolutePath,
      relativePath: input.relativePath,
      uri,
      languageId: input.languageId,
      version: input.version,
      text,
    };

    if (!existing || input.action === "open") {
      this.openDocuments.set(uri, nextState);
      this.rpc.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: input.languageId,
          version: input.version,
          text,
        },
      });
      return;
    }

    this.openDocuments.set(uri, nextState);

    if (input.action === "save") {
      this.rpc.notify("textDocument/didSave", {
        textDocument: { uri },
        text,
      });
      return;
    }

    this.rpc.notify("textDocument/didChange", {
      textDocument: {
        uri,
        version: input.version,
      },
      contentChanges: [{ text }],
    });
  }

  async hover(input: {
    readonly publicWorkspaceRoot: string;
    readonly absolutePath: string;
    readonly line: number;
    readonly column: number;
  }): Promise<ProjectLanguageServerHoverResult> {
    this.publicWorkspaceRoot = input.publicWorkspaceRoot;
    const startResult = await this.start();
    if (startResult.status !== "running" || !this.capabilities.hover || !this.rpc) {
      return {};
    }

    const response = await this.rpc.request("textDocument/hover", {
      textDocument: { uri: pathToFileURL(input.absolutePath).toString() },
      position: toLspPosition(input.line, input.column),
    });
    const contents = markdownToString((response as any)?.contents);
    const range = (response as any)?.range ? toRange((response as any).range) : undefined;
    return {
      ...(contents ? { contents } : {}),
      ...(range ? { range } : {}),
    };
  }

  async definition(input: {
    readonly publicWorkspaceRoot: string;
    readonly absolutePath: string;
    readonly line: number;
    readonly column: number;
  }): Promise<ProjectLanguageServerDefinitionResult> {
    await this.start();
    if (this.status !== "running" || !this.capabilities.definition || !this.rpc) {
      return { locations: [] };
    }

    const response = await this.rpc.request("textDocument/definition", {
      textDocument: { uri: pathToFileURL(input.absolutePath).toString() },
      position: toLspPosition(input.line, input.column),
    });
    return {
      locations: this.normalizeLocations(response, input.publicWorkspaceRoot),
    };
  }

  async references(input: {
    readonly publicWorkspaceRoot: string;
    readonly absolutePath: string;
    readonly line: number;
    readonly column: number;
  }): Promise<ProjectLanguageServerReferencesResult> {
    await this.start();
    if (this.status !== "running" || !this.capabilities.references || !this.rpc) {
      return { locations: [] };
    }

    const response = await this.rpc.request("textDocument/references", {
      textDocument: { uri: pathToFileURL(input.absolutePath).toString() },
      position: toLspPosition(input.line, input.column),
      context: { includeDeclaration: true },
    });
    return {
      locations: this.normalizeLocations(response, input.publicWorkspaceRoot),
    };
  }

  async completion(input: {
    readonly publicWorkspaceRoot: string;
    readonly absolutePath: string;
    readonly line: number;
    readonly column: number;
  }): Promise<ProjectLanguageServerCompletionResult> {
    await this.start();
    if (this.status !== "running" || !this.capabilities.completion || !this.rpc) {
      return { items: [] };
    }

    const response = await this.rpc.request("textDocument/completion", {
      textDocument: { uri: pathToFileURL(input.absolutePath).toString() },
      position: toLspPosition(input.line, input.column),
    });
    const items = Array.isArray(response) ? response : ((response as any)?.items ?? []);
    return {
      items: items
        .map((item: any): ProjectLanguageServerCompletionItem | null => {
          const label = typeof item?.label === "string" ? item.label.trim() : "";
          if (label.length === 0) return null;
          const textEdit =
            item?.textEdit && typeof item.textEdit.newText === "string" ? item.textEdit : null;
          const textEditRange = textEdit?.range ?? textEdit?.replace ?? textEdit?.insert;
          return {
            label,
            ...(typeof item?.insertText === "string"
              ? { insertText: item.insertText }
              : textEdit
                ? { insertText: textEdit.newText }
                : {}),
            ...(item?.insertTextFormat === 2
              ? { insertTextFormat: "snippet" as const }
              : item?.insertTextFormat === 1
                ? { insertTextFormat: "plainText" as const }
                : {}),
            ...(textEditRange ? { range: toRange(textEditRange) } : {}),
            ...(typeof item?.detail === "string" ? { detail: item.detail } : {}),
            ...(markdownToString(item?.documentation)
              ? { documentation: markdownToString(item.documentation) }
              : {}),
            ...(item?.kind !== undefined ? { kind: String(item.kind) } : {}),
          };
        })
        .filter(
          (
            item: ProjectLanguageServerCompletionItem | null,
          ): item is ProjectLanguageServerCompletionItem => item !== null,
        ),
    };
  }

  async rename(input: {
    readonly publicWorkspaceRoot: string;
    readonly absolutePath: string;
    readonly line: number;
    readonly column: number;
    readonly newName: string;
  }): Promise<ProjectLanguageServerRenameResult> {
    await this.start();
    if (this.status !== "running" || !this.capabilities.rename || !this.rpc) {
      return { edits: [] };
    }

    const response = await this.rpc.request("textDocument/rename", {
      textDocument: { uri: pathToFileURL(input.absolutePath).toString() },
      position: toLspPosition(input.line, input.column),
      newName: input.newName,
    });
    return {
      edits: this.normalizeWorkspaceEdit(response, input.publicWorkspaceRoot),
    };
  }

  async codeActions(input: {
    readonly absolutePath: string;
    readonly range: ProjectLanguageServerRange;
  }): Promise<ProjectLanguageServerCodeActionsResult> {
    await this.start();
    if (this.status !== "running" || !this.capabilities.codeAction || !this.rpc) {
      return { actions: [] };
    }

    const response = await this.rpc.request("textDocument/codeAction", {
      textDocument: { uri: pathToFileURL(input.absolutePath).toString() },
      range: {
        start: {
          line: input.range.startLine - 1,
          character: input.range.startColumn - 1,
        },
        end: {
          line: input.range.endLine - 1,
          character: input.range.endColumn - 1,
        },
      },
      context: {
        diagnostics: [],
      },
    });

    const actions = Array.isArray(response) ? response : [];
    return {
      actions: actions
        .map((action: any): ProjectLanguageServerCodeAction | null => {
          const title = typeof action?.title === "string" ? action.title.trim() : "";
          if (title.length === 0) return null;
          return {
            title,
            ...(typeof action?.kind === "string" ? { kind: action.kind } : {}),
            diagnostics: [],
          };
        })
        .filter((action): action is ProjectLanguageServerCodeAction => action !== null),
    };
  }

  private async reopenDocuments(): Promise<void> {
    if (!this.rpc) return;
    for (const document of this.openDocuments.values()) {
      this.rpc.notify("textDocument/didOpen", {
        textDocument: {
          uri: document.uri,
          languageId: document.languageId,
          version: document.version,
          text: document.text,
        },
      });
    }
  }

  private normalizeLocations(
    response: unknown,
    publicWorkspaceRoot: string,
  ): ProjectLanguageServerLocation[] {
    const rawLocations = Array.isArray(response) ? response : response ? [response] : [];

    return rawLocations
      .map((location: any) => {
        const uri = location?.uri ?? location?.targetUri;
        const range = location?.range ?? location?.targetSelectionRange ?? location?.targetRange;
        if (typeof uri !== "string" || !range) {
          return null;
        }
        const relativePath = this.relativePathFromUri(uri, publicWorkspaceRoot);
        if (!relativePath) {
          return null;
        }
        return {
          relativePath,
          range: toRange(range),
        } satisfies ProjectLanguageServerLocation;
      })
      .filter((location): location is ProjectLanguageServerLocation => location !== null);
  }

  private normalizeWorkspaceEdit(
    response: unknown,
    publicWorkspaceRoot: string,
  ): ProjectLanguageServerRenameResult["edits"] {
    const edits: ProjectLanguageServerTextEdit[] = [];
    const changes = (response as any)?.changes;
    if (changes && typeof changes === "object") {
      for (const [uri, uriEdits] of Object.entries(changes)) {
        const relativePath = this.relativePathFromUri(uri, publicWorkspaceRoot);
        if (!relativePath || !Array.isArray(uriEdits)) {
          continue;
        }
        for (const edit of uriEdits) {
          edits.push({
            relativePath,
            range: toRange(edit.range),
            newText: typeof edit.newText === "string" ? edit.newText : "",
          });
        }
      }
    }
    return edits;
  }

  private relativePathFromUri(
    uri: string,
    publicWorkspaceRoot = this.publicWorkspaceRoot,
  ): string | null {
    try {
      const absolutePath = fileURLToPath(uri);
      const knownOpenDocument = this.openDocuments.get(uri);
      if (knownOpenDocument) {
        return knownOpenDocument.relativePath;
      }
      const relativePath = NodePath.relative(publicWorkspaceRoot, absolutePath)
        .split(NodePath.sep)
        .join("/");
      if (
        relativePath.startsWith("../") ||
        relativePath === ".." ||
        NodePath.isAbsolute(relativePath)
      ) {
        return null;
      }
      return relativePath;
    } catch {
      return null;
    }
  }

  private handleDiagnostics(params: unknown): void {
    const uri = (params as any)?.uri;
    const relativePath = typeof uri === "string" ? this.relativePathFromUri(uri) : null;
    if (!relativePath) {
      return;
    }

    const diagnostics = Array.isArray((params as any)?.diagnostics)
      ? (params as any).diagnostics.map(
          (diagnostic: any): ProjectDiagnostic => ({
            relativePath,
            severity: toDiagnosticSeverity(diagnostic?.severity),
            source:
              typeof diagnostic?.source === "string" && diagnostic.source.trim().length > 0
                ? diagnostic.source.trim()
                : this.serverId,
            message:
              typeof diagnostic?.message === "string" && diagnostic.message.trim().length > 0
                ? diagnostic.message.trim()
                : "Language server diagnostic.",
            line: Math.max(1, (diagnostic?.range?.start?.line ?? 0) + 1),
            column: Math.max(1, (diagnostic?.range?.start?.character ?? 0) + 1),
            endLine: Math.max(1, (diagnostic?.range?.end?.line ?? 0) + 1),
            endColumn: Math.max(1, (diagnostic?.range?.end?.character ?? 0) + 1),
            ...(diagnostic?.code !== undefined ? { code: String(diagnostic.code) } : {}),
          }),
        )
      : [];

    this.publish({
      type: "diagnostics",
      session: {
        cwd: this.publicWorkspaceRoot,
        serverId: this.serverId,
      },
      relativePath,
      diagnostics,
    } satisfies ProjectLanguageServerDiagnosticsEvent);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.rpc?.dispose();
    this.rpc = null;
    this.child = null;

    if (this.stopRequested) {
      this.status = "stopped";
      this.publish(this.sessionEvent(this.status));
      return;
    }

    const detail = `Server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
    if (this.restartAttempts < MAX_RESTART_ATTEMPTS) {
      this.restartAttempts += 1;
      this.status = "restartScheduled";
      console.warn(
        `[lsp] ${this.serverId} ${detail} Restart ${this.restartAttempts}/${MAX_RESTART_ATTEMPTS}.`,
      );
      this.publish(this.sessionEvent(this.status, detail));
      void delay(500 * this.restartAttempts).then(() => this.start());
      return;
    }

    this.status = "failed";
    console.error(`[lsp] ${this.serverId} ${detail}`);
    this.publish(this.sessionEvent(this.status, detail));
  }

  private async forceKill(): Promise<void> {
    this.rpc?.dispose();
    this.rpc = null;
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
  }
}

function matchesSubscription(
  input: ProjectLanguageServerSubscribeInput,
  event: ProjectLanguageServerStreamEvent,
): boolean {
  if (input.cwd && event.session.cwd !== input.cwd) {
    return false;
  }
  if (input.serverId && event.session.serverId !== input.serverId) {
    return false;
  }
  return true;
}

function toWorkspaceLanguageServersError(input: {
  readonly cwd: string;
  readonly serverId?: string;
  readonly relativePath?: string;
  readonly operation: string;
  readonly cause: unknown;
  readonly fallbackDetail: string;
}): WorkspaceLanguageServersError {
  return new WorkspaceLanguageServersError({
    cwd: input.cwd,
    ...(input.serverId ? { serverId: input.serverId } : {}),
    ...(input.relativePath ? { relativePath: input.relativePath } : {}),
    operation: input.operation,
    detail: input.cause instanceof Error ? input.cause.message : input.fallbackDetail,
    cause: input.cause,
  });
}

export const makeWorkspaceLanguageServers = Effect.gen(function* () {
  const workspacePaths = yield* WorkspacePaths;
  const serverSettings = yield* ServerSettingsService;
  let currentSettings = yield* serverSettings.getSettings;
  yield* serverSettings.streamChanges.pipe(
    Stream.runForEach((settings) =>
      Effect.sync(() => {
        currentSettings = settings;
      }),
    ),
    Effect.forkScoped,
  );
  const pubsub = yield* PubSub.unbounded<ProjectLanguageServerStreamEvent>();
  const sessions = new Map<string, LanguageServerSession>();
  const publish = (event: ProjectLanguageServerStreamEvent) => {
    Effect.runFork(PubSub.publish(pubsub, event));
  };

  const resolveLaunchConfig = async (workspaceRoot: string, serverId: string) => {
    const descriptor = SERVER_DESCRIPTORS[serverId];

    if (serverId === "typescript-language-server") {
      const tsSettings = currentSettings.languageServers.typescript;
      const args = tsSettings.launchArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return {
        enabled: tsSettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, tsSettings.binaryPath),
        args: args.length > 0 ? args : ["--stdio"],
      };
    }

    if (serverId === "rust-analyzer") {
      const rustSettings = currentSettings.languageServers.rust;
      const args = rustSettings.launchArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return {
        enabled: rustSettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, rustSettings.binaryPath),
        args,
      };
    }

    if (serverId === "pyright-langserver") {
      const pythonSettings = currentSettings.languageServers.python;
      const args = pythonSettings.launchArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return {
        enabled: pythonSettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, pythonSettings.binaryPath),
        args: args.length > 0 ? args : ["--stdio"],
      };
    }

    if (serverId === "solidity-language-server") {
      const soliditySettings = currentSettings.languageServers.solidity;
      const args = soliditySettings.launchArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return {
        enabled: soliditySettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, soliditySettings.binaryPath),
        args: args.length > 0 ? args : ["--stdio"],
      };
    }

    if (serverId === "clangd") {
      const cppSettings = currentSettings.languageServers.cpp;
      const args = cppSettings.launchArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      const compileCommandsDirectory = cppSettings.compileCommandsDirectory.trim();
      const resolvedCompileCommandsDirectory =
        compileCommandsDirectory.length > 0
          ? NodePath.resolve(workspaceRoot, compileCommandsDirectory)
          : null;
      const hasExplicitCompileCommandsDirectory =
        resolvedCompileCommandsDirectory !== null &&
        ((await pathExists(
          NodePath.join(resolvedCompileCommandsDirectory, "compile_commands.json"),
        )) ||
          (await pathExists(NodePath.join(resolvedCompileCommandsDirectory, "compile_flags.txt"))));
      const detectedCompileDatabasePath = await findUpwards(workspaceRoot, workspaceRoot, [
        "compile_commands.json",
        "compile_flags.txt",
      ]);
      const effectiveCompileCommandsDirectory = hasExplicitCompileCommandsDirectory
        ? resolvedCompileCommandsDirectory
        : detectedCompileDatabasePath
          ? NodePath.dirname(detectedCompileDatabasePath)
          : null;

      return {
        enabled: cppSettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, cppSettings.binaryPath),
        args: [
          ...(args.length > 0 ? args : []),
          ...(effectiveCompileCommandsDirectory
            ? [`--compile-commands-dir=${effectiveCompileCommandsDirectory}`]
            : []),
        ],
        ...(effectiveCompileCommandsDirectory
          ? {}
          : {
              detail:
                "clangd started without compile_commands.json or compile_flags.txt; diagnostics and navigation may be limited.",
            }),
      };
    }

    if (serverId === "jdtls") {
      const javaSettings = currentSettings.languageServers.java;
      const jvmArgs = javaSettings.jvmArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      const configuredWorkspaceStoragePath = javaSettings.workspaceStoragePath.trim();
      const workspaceStorageRoot =
        configuredWorkspaceStoragePath.length > 0
          ? NodePath.resolve(workspaceRoot, configuredWorkspaceStoragePath)
          : NodePath.join(
              process.env.HOME ?? workspaceRoot,
              ".t3delta",
              "jdtls-workspaces",
              toWorkspaceStorageSlug(workspaceRoot),
            );
      await fs.promises.mkdir(workspaceStorageRoot, { recursive: true });

      return {
        enabled: javaSettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, javaSettings.binaryPath),
        args: [...jvmArgs, "-data", workspaceStorageRoot],
      };
    }

    if (serverId === "csharp-ls") {
      const csharpSettings = currentSettings.languageServers.csharp;
      const args = csharpSettings.launchArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return {
        enabled: csharpSettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, csharpSettings.binaryPath),
        args,
      };
    }

    if (serverId === "vscode-html-language-server") {
      const htmlSettings = currentSettings.languageServers.html;
      const args = htmlSettings.launchArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return {
        enabled: htmlSettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, htmlSettings.binaryPath),
        args: args.length > 0 ? args : ["--stdio"],
      };
    }

    if (serverId === "vscode-css-language-server") {
      const cssSettings = currentSettings.languageServers.css;
      const args = cssSettings.launchArgs
        .split(/\s+/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return {
        enabled: cssSettings.enabled,
        command: await resolveCommand(workspaceRoot, serverId, cssSettings.binaryPath),
        args: args.length > 0 ? args : ["--stdio"],
      };
    }

    return {
      enabled: true,
      command: await resolveCommand(workspaceRoot, serverId),
      args: [...(descriptor?.args ?? [])],
    };
  };

  const resolveSession = Effect.fn("WorkspaceLanguageServers.resolveSession")(function* (input: {
    readonly cwd: string;
    readonly serverId: string;
    readonly absolutePath?: string;
  }) {
    const normalizedCwd = yield* workspacePaths.normalizeWorkspaceRoot(input.cwd).pipe(
      Effect.mapError((cause) =>
        toWorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          operation: "resolveSession",
          cause,
          fallbackDetail: "Failed to normalize workspace root.",
        }),
      ),
    );
    const workspaceRoot = yield* Effect.tryPromise({
      try: () =>
        detectWorkspaceRootForServer({
          cwd: normalizedCwd,
          serverId: input.serverId,
          ...(input.absolutePath !== undefined ? { absolutePath: input.absolutePath } : {}),
        }),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          operation: "resolveSession",
          detail: cause instanceof Error ? cause.message : "Failed to detect language server root.",
          cause,
        }),
    });
    const sessionKey = `${workspaceRoot}::${input.serverId}`;
    const existing = sessions.get(sessionKey);
    if (existing) {
      return { workspaceRoot, session: existing };
    }

    const session = new LanguageServerSession(
      workspaceRoot,
      input.serverId,
      resolveLaunchConfig,
      publish,
      normalizedCwd,
    );
    sessions.set(sessionKey, session);
    return { workspaceRoot, session };
  });

  const resolveDocument = Effect.fn("WorkspaceLanguageServers.resolveDocument")(function* (
    input: Pick<ProjectLanguageServerDocumentSyncInput, "cwd" | "relativePath">,
  ) {
    const workspaceRoot = yield* workspacePaths.normalizeWorkspaceRoot(input.cwd).pipe(
      Effect.mapError((cause) =>
        toWorkspaceLanguageServersError({
          cwd: input.cwd,
          relativePath: input.relativePath,
          operation: "resolveDocument",
          cause,
          fallbackDetail: "Failed to normalize workspace root.",
        }),
      ),
    );
    const resolved = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot,
      relativePath: input.relativePath,
    });
    return {
      cwd: input.cwd,
      workspaceRoot,
      ...resolved,
    };
  });

  const startSession: WorkspaceLanguageServersShape["startSession"] = Effect.fn(
    "WorkspaceLanguageServers.startSession",
  )(function* (input) {
    const { session } = yield* resolveSession(input);
    return yield* Effect.tryPromise({
      try: () => session.start(),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          operation: "startSession",
          detail: cause instanceof Error ? cause.message : "Failed to start language server.",
          cause,
        }),
    });
  });

  const stopSession: WorkspaceLanguageServersShape["stopSession"] = Effect.fn(
    "WorkspaceLanguageServers.stopSession",
  )(function* (input) {
    const { workspaceRoot, session } = yield* resolveSession(input);
    yield* Effect.tryPromise({
      try: () => session.stop(),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          operation: "stopSession",
          detail: cause instanceof Error ? cause.message : "Failed to stop language server.",
          cause,
        }),
    });
    sessions.delete(`${workspaceRoot}::${input.serverId}`);
    return {
      session: {
        cwd: input.cwd,
        serverId: input.serverId,
      },
      stopped: true,
    };
  });

  const syncDocument: WorkspaceLanguageServersShape["syncDocument"] = Effect.fn(
    "WorkspaceLanguageServers.syncDocument",
  )(function* (input) {
    const resolvedDocument = yield* resolveDocument(input);
    const { session } = yield* resolveSession({
      cwd: input.cwd,
      serverId: input.serverId,
      absolutePath: resolvedDocument.absolutePath,
    });

    return yield* Effect.tryPromise({
      try: () =>
        session.syncDocument({
          publicWorkspaceRoot: resolvedDocument.cwd,
          absolutePath: resolvedDocument.absolutePath,
          relativePath: resolvedDocument.relativePath,
          languageId: input.languageId,
          version: input.version,
          action: input.action,
          ...(input.text !== undefined ? { text: input.text } : {}),
        }),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          relativePath: input.relativePath,
          operation: "syncDocument",
          detail: cause instanceof Error ? cause.message : "Failed to sync LSP document.",
          cause,
        }),
    });
  });

  const hover: WorkspaceLanguageServersShape["hover"] = Effect.fn("WorkspaceLanguageServers.hover")(
    function* (input) {
      const resolvedDocument = yield* resolveDocument(input);
      const { session } = yield* resolveSession({
        cwd: input.cwd,
        serverId: input.serverId,
        absolutePath: resolvedDocument.absolutePath,
      });
      return yield* Effect.tryPromise({
        try: () =>
          session.hover({
            publicWorkspaceRoot: resolvedDocument.cwd,
            absolutePath: resolvedDocument.absolutePath,
            line: input.line,
            column: input.column,
          }),
        catch: (cause) =>
          new WorkspaceLanguageServersError({
            cwd: input.cwd,
            serverId: input.serverId,
            relativePath: input.relativePath,
            operation: "hover",
            detail: cause instanceof Error ? cause.message : "Failed to request hover.",
            cause,
          }),
      });
    },
  );

  const definition: WorkspaceLanguageServersShape["definition"] = Effect.fn(
    "WorkspaceLanguageServers.definition",
  )(function* (input) {
    const resolvedDocument = yield* resolveDocument(input);
    const { session } = yield* resolveSession({
      cwd: input.cwd,
      serverId: input.serverId,
      absolutePath: resolvedDocument.absolutePath,
    });
    return yield* Effect.tryPromise({
      try: () =>
        session.definition({
          publicWorkspaceRoot: resolvedDocument.cwd,
          absolutePath: resolvedDocument.absolutePath,
          line: input.line,
          column: input.column,
        }),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          relativePath: input.relativePath,
          operation: "definition",
          detail: cause instanceof Error ? cause.message : "Failed to request definition.",
          cause,
        }),
    });
  });

  const references: WorkspaceLanguageServersShape["references"] = Effect.fn(
    "WorkspaceLanguageServers.references",
  )(function* (input) {
    const resolvedDocument = yield* resolveDocument(input);
    const { session } = yield* resolveSession({
      cwd: input.cwd,
      serverId: input.serverId,
      absolutePath: resolvedDocument.absolutePath,
    });
    return yield* Effect.tryPromise({
      try: () =>
        session.references({
          publicWorkspaceRoot: resolvedDocument.cwd,
          absolutePath: resolvedDocument.absolutePath,
          line: input.line,
          column: input.column,
        }),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          relativePath: input.relativePath,
          operation: "references",
          detail: cause instanceof Error ? cause.message : "Failed to request references.",
          cause,
        }),
    });
  });

  const completion: WorkspaceLanguageServersShape["completion"] = Effect.fn(
    "WorkspaceLanguageServers.completion",
  )(function* (input) {
    const resolvedDocument = yield* resolveDocument(input);
    const { session } = yield* resolveSession({
      cwd: input.cwd,
      serverId: input.serverId,
      absolutePath: resolvedDocument.absolutePath,
    });
    return yield* Effect.tryPromise({
      try: () =>
        session.completion({
          publicWorkspaceRoot: resolvedDocument.cwd,
          absolutePath: resolvedDocument.absolutePath,
          line: input.line,
          column: input.column,
        }),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          relativePath: input.relativePath,
          operation: "completion",
          detail: cause instanceof Error ? cause.message : "Failed to request completion.",
          cause,
        }),
    });
  });

  const rename: WorkspaceLanguageServersShape["rename"] = Effect.fn(
    "WorkspaceLanguageServers.rename",
  )(function* (input) {
    const resolvedDocument = yield* resolveDocument(input);
    const { session } = yield* resolveSession({
      cwd: input.cwd,
      serverId: input.serverId,
      absolutePath: resolvedDocument.absolutePath,
    });
    return yield* Effect.tryPromise({
      try: () =>
        session.rename({
          publicWorkspaceRoot: resolvedDocument.cwd,
          absolutePath: resolvedDocument.absolutePath,
          line: input.line,
          column: input.column,
          newName: input.newName,
        }),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          relativePath: input.relativePath,
          operation: "rename",
          detail: cause instanceof Error ? cause.message : "Failed to request rename.",
          cause,
        }),
    });
  });

  const codeActions: WorkspaceLanguageServersShape["codeActions"] = Effect.fn(
    "WorkspaceLanguageServers.codeActions",
  )(function* (input) {
    const resolvedDocument = yield* resolveDocument(input);
    const { session } = yield* resolveSession({
      cwd: input.cwd,
      serverId: input.serverId,
      absolutePath: resolvedDocument.absolutePath,
    });
    return yield* Effect.tryPromise({
      try: () =>
        session.codeActions({
          absolutePath: resolvedDocument.absolutePath,
          range: input.range,
        }),
      catch: (cause) =>
        new WorkspaceLanguageServersError({
          cwd: input.cwd,
          serverId: input.serverId,
          relativePath: input.relativePath,
          operation: "codeActions",
          detail: cause instanceof Error ? cause.message : "Failed to request code actions.",
          cause,
        }),
    });
  });

  const subscribeEvents: WorkspaceLanguageServersShape["subscribeEvents"] = (input) =>
    Stream.fromPubSub(pubsub).pipe(Stream.filter((event) => matchesSubscription(input, event)));

  return {
    startSession,
    stopSession,
    syncDocument,
    hover,
    definition,
    references,
    completion,
    rename,
    codeActions,
    subscribeEvents,
  } satisfies WorkspaceLanguageServersShape;
});

export const WorkspaceLanguageServersLive = Layer.effect(
  WorkspaceLanguageServers,
  makeWorkspaceLanguageServers,
);
