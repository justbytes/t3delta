import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { basename, isAbsolute, join, normalize, relative, sep } from "node:path";
import { promisify } from "node:util";

import { readdir, readFile, stat, writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const textEncoder = new TextEncoder();

export interface HermesFileAccessOptions {
  readonly hermesDir?: string;
  readonly commandRunner?: HermesCommandRunner;
}

export interface HermesSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly category: string;
}

export interface HermesSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly lastActivity: string;
}

export interface HermesCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export type HermesCommandRunner = (
  command: string,
  args: ReadonlyArray<string>,
) => Promise<HermesCommandResult>;

interface FileAccessErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

interface SkillFile {
  readonly fullPath: string;
  readonly relativeDir: string;
  readonly summary: HermesSkillSummary;
}

const memoryFiles = {
  memory: "MEMORY.md",
  user: "USER.md",
} as const;
const workspaceFileIgnoreDirs = new Set([
  ".git",
  ".turbo",
  "node_modules",
  "dist",
  "dist-electron",
  "coverage",
]);

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(
    init?.headers as ConstructorParameters<typeof Headers>[0] | undefined,
  );
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function textResponse(text: string, init?: ResponseInit): Response {
  const headers = new Headers(
    init?.headers as ConstructorParameters<typeof Headers>[0] | undefined,
  );
  headers.set("content-type", "text/markdown; charset=utf-8");
  return new Response(text, { ...init, headers });
}

function fileAccessError(status: number, code: string, message: string): Response {
  return jsonResponse({ error: { code, message } } satisfies FileAccessErrorBody, { status });
}

function hermesRoot(options: HermesFileAccessOptions): string {
  return options.hermesDir ?? join(homedir(), ".hermes");
}

function ensureRelativePath(input: string): string | undefined {
  const decoded = decodeURIComponent(input).replace(/^\/+/, "");
  if (!decoded || decoded.includes("\0") || isAbsolute(decoded)) return undefined;
  const normalized = normalize(decoded);
  if (normalized === "." || normalized.startsWith("..") || normalized.includes(`..${sep}`)) {
    return undefined;
  }
  return normalized;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function directoryExists(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isDirectory())
    .catch(() => false);
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isFile())
    .catch(() => false);
}

function parseFrontmatter(markdown: string): Record<string, string> {
  if (!markdown.startsWith("---")) return {};
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return {};
  const metadata: Record<string, string> = {};
  for (const line of markdown.slice(3, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.+?)\s*$/.exec(line);
    if (match) metadata[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return metadata;
}

function descriptionFromMarkdown(markdown: string): string {
  const metadata = parseFrontmatter(markdown);
  if (metadata.description) return metadata.description;
  const body = markdown.replace(/^---[\s\S]*?\n---\s*/, "");
  const heading = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return heading ?? "";
}

async function findSkillFiles(skillsDir: string): Promise<ReadonlyArray<SkillFile>> {
  async function walk(dir: string): Promise<ReadonlyArray<SkillFile>> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: Array<SkillFile> = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const skillPath = join(fullPath, "SKILL.md");
        if (await fileExists(skillPath)) {
          const content = await readFile(skillPath, "utf8");
          const metadata = parseFrontmatter(content);
          const relativeDir = relative(skillsDir, fullPath);
          const parts = relativeDir.split(sep);
          files.push({
            fullPath: skillPath,
            relativeDir,
            summary: {
              name: metadata.name ?? basename(fullPath),
              description: metadata.description ?? descriptionFromMarkdown(content),
              category: parts.length > 1 ? parts[0]! : "uncategorized",
            },
          });
          continue;
        }
        if (entry.isDirectory()) files.push(...(await walk(fullPath)));
      }
    }
    return files;
  }

  return walk(skillsDir);
}

async function listSkills(options: HermesFileAccessOptions): Promise<Response> {
  const skillsDir = join(hermesRoot(options), "skills");
  if (!(await directoryExists(skillsDir))) {
    return fileAccessError(404, "skills_not_found", "Hermes skills directory was not found");
  }

  const skills = (await findSkillFiles(skillsDir))
    .map((skill) => skill.summary)
    .sort((a, b) => a.name.localeCompare(b.name));
  return jsonResponse(skills);
}

async function readSkill(options: HermesFileAccessOptions, skillName: string): Promise<Response> {
  const safeName = ensureRelativePath(skillName);
  if (!safeName) return fileAccessError(400, "invalid_skill_name", "Invalid skill name");

  const skillsDir = join(hermesRoot(options), "skills");
  if (!(await directoryExists(skillsDir))) {
    return fileAccessError(404, "skills_not_found", "Hermes skills directory was not found");
  }

  const skills = await findSkillFiles(skillsDir);
  const skill = skills.find(
    (candidate) => candidate.summary.name === safeName || candidate.relativeDir === safeName,
  );
  if (!skill || !isWithin(skillsDir, skill.fullPath)) {
    return fileAccessError(404, "skill_not_found", `Hermes skill '${safeName}' was not found`);
  }

  return textResponse(await readFile(skill.fullPath, "utf8"));
}

async function readMemory(options: HermesFileAccessOptions): Promise<Response> {
  const memoriesDir = join(hermesRoot(options), "memories");
  if (!(await directoryExists(memoriesDir))) {
    return fileAccessError(404, "memory_not_found", "Hermes memories directory was not found");
  }

  const [memory, user] = await Promise.all([
    readFile(join(memoriesDir, memoryFiles.memory), "utf8").catch(() => ""),
    readFile(join(memoriesDir, memoryFiles.user), "utf8").catch(() => ""),
  ]);
  return jsonResponse({ memory, user });
}

async function writeMemory(
  options: HermesFileAccessOptions,
  file: string,
  request: Request,
): Promise<Response> {
  if (file !== "memory" && file !== "user") {
    return fileAccessError(400, "invalid_memory_file", "Memory file must be 'memory' or 'user'");
  }

  const memoriesDir = join(hermesRoot(options), "memories");
  if (!(await directoryExists(memoriesDir))) {
    return fileAccessError(404, "memory_not_found", "Hermes memories directory was not found");
  }

  const body = await request.text();
  const target = join(memoriesDir, memoryFiles[file]);
  if (!isWithin(memoriesDir, target)) {
    return fileAccessError(400, "invalid_memory_file", "Invalid memory file");
  }

  await writeFile(target, body, "utf8");
  return jsonResponse({ success: true, file, bytes: textEncoder.encode(body).byteLength });
}

function titleFromSession(session: Record<string, unknown>, fallback: string): string {
  const explicitTitle = session.title;
  if (typeof explicitTitle === "string" && explicitTitle.trim()) return explicitTitle.trim();
  const messages = session.messages;
  if (Array.isArray(messages)) {
    const userMessage = messages.find(
      (message): message is Record<string, unknown> =>
        typeof message === "object" &&
        message !== null &&
        (message as Record<string, unknown>).role === "user",
    );
    const content = userMessage?.content;
    if (typeof content === "string" && content.trim()) return content.trim().slice(0, 80);
  }
  return fallback;
}

async function sessionSummaries(options: HermesFileAccessOptions): Promise<Response> {
  const sessionsDir = join(hermesRoot(options), "sessions");
  if (!(await directoryExists(sessionsDir))) {
    return fileAccessError(404, "sessions_not_found", "Hermes sessions directory was not found");
  }

  const entries = await readdir(sessionsDir, { withFileTypes: true });
  const sessions: Array<HermesSessionSummary> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || !entry.name.startsWith("session_")) {
      continue;
    }
    const fullPath = join(sessionsDir, entry.name);
    try {
      const [content, stats] = await Promise.all([readFile(fullPath, "utf8"), stat(fullPath)]);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const id =
        typeof parsed.session_id === "string"
          ? parsed.session_id
          : entry.name.replace(/\.json$/, "");
      const fallbackTitle = id;
      const lastActivity =
        typeof parsed.last_updated === "string"
          ? parsed.last_updated
          : typeof parsed.session_start === "string"
            ? parsed.session_start
            : stats.mtime.toISOString();
      sessions.push({ id, title: titleFromSession(parsed, fallbackTitle), lastActivity });
    } catch {
      continue;
    }
  }

  sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return jsonResponse(sessions);
}

async function readSession(options: HermesFileAccessOptions, sessionId: string): Promise<Response> {
  const safeId = ensureRelativePath(sessionId);
  if (!safeId || safeId.includes(sep)) {
    return fileAccessError(400, "invalid_session_id", "Invalid session id");
  }

  const sessionsDir = join(hermesRoot(options), "sessions");
  if (!(await directoryExists(sessionsDir))) {
    return fileAccessError(404, "sessions_not_found", "Hermes sessions directory was not found");
  }

  const entries = await readdir(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || !entry.name.startsWith("session_")) {
      continue;
    }
    const fullPath = join(sessionsDir, entry.name);
    if (!isWithin(sessionsDir, fullPath)) continue;
    try {
      const content = await readFile(fullPath, "utf8");
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const parsedId =
        typeof parsed.session_id === "string"
          ? parsed.session_id
          : entry.name.replace(/\.json$/, "");
      if (parsedId === safeId || entry.name.replace(/\.json$/, "") === safeId) {
        return jsonResponse(parsed);
      }
    } catch {
      continue;
    }
  }

  return fileAccessError(404, "session_not_found", `Hermes session '${safeId}' was not found`);
}

async function runHermesCommand(
  command: string,
  args: ReadonlyArray<string>,
): Promise<HermesCommandResult> {
  const { stdout, stderr } = await execFileAsync(command, [...args], { timeout: 120_000 });
  return { stdout, stderr };
}

async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return { identifier: text.trim() };
  return JSON.parse(text) as Record<string, unknown>;
}

async function installSkill(options: HermesFileAccessOptions, request: Request): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = await parseJsonBody(request);
  } catch {
    return fileAccessError(400, "invalid_json", "Request body must be valid JSON");
  }

  const identifier =
    typeof payload.identifier === "string"
      ? payload.identifier
      : typeof payload.name === "string"
        ? payload.name
        : typeof payload.skill === "string"
          ? payload.skill
          : undefined;
  if (!identifier?.trim()) {
    return fileAccessError(400, "missing_skill_identifier", "Skill identifier is required");
  }

  const args = ["skills", "install", identifier.trim(), "--yes"];
  if (typeof payload.category === "string" && payload.category.trim()) {
    args.push("--category", payload.category.trim());
  }
  if (typeof payload.installName === "string" && payload.installName.trim()) {
    args.push("--name", payload.installName.trim());
  }
  if (payload.force === true) args.push("--force");

  try {
    const result = await (options.commandRunner ?? runHermesCommand)("hermes", args);
    return jsonResponse({ success: true, stdout: result.stdout, stderr: result.stderr });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

async function uninstallSkill(
  options: HermesFileAccessOptions,
  skillName: string,
): Promise<Response> {
  const safeName = ensureRelativePath(skillName);
  if (!safeName || safeName.includes(sep)) {
    return fileAccessError(400, "invalid_skill_name", "Invalid skill name");
  }

  try {
    const result = await (options.commandRunner ?? runHermesCommand)("hermes", [
      "skills",
      "uninstall",
      safeName,
    ]);
    return jsonResponse({ success: true, stdout: result.stdout, stderr: result.stderr });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

async function listWorkspaceFiles(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").toLowerCase();
  const cwd = process.cwd();
  const matches: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (matches.length >= 50 || depth > 5) return;
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (matches.length >= 50) return;
      if (entry.name.startsWith(".") && entry.name !== ".factory") continue;
      if (entry.isDirectory() && workspaceFileIgnoreDirs.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      const relativePath = relative(cwd, fullPath);
      if (!relativePath || relativePath.startsWith("..")) continue;
      if (!query || relativePath.toLowerCase().includes(query)) matches.push(relativePath);
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
    }
  }

  await walk(cwd, 0);
  return jsonResponse({ files: matches });
}

export async function handleHermesFileAccessRequest(
  request: Request,
  options: HermesFileAccessOptions = {},
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/skills") return listSkills(options);
  if (request.method === "POST" && path === "/api/skills/install") {
    return installSkill(options, request);
  }
  if (path.startsWith("/api/skills/")) {
    const skillName = path.slice("/api/skills/".length);
    if (request.method === "GET") return readSkill(options, skillName);
    if (request.method === "DELETE") return uninstallSkill(options, skillName);
  }

  if (request.method === "GET" && path === "/api/memory") return readMemory(options);
  if (request.method === "PUT" && path.startsWith("/api/memory/")) {
    return writeMemory(options, path.slice("/api/memory/".length), request);
  }

  if (request.method === "GET" && path === "/api/sessions") return sessionSummaries(options);
  if (request.method === "GET" && path.startsWith("/api/sessions/")) {
    return readSession(options, path.slice("/api/sessions/".length));
  }
  if (request.method === "GET" && path === "/api/workspace/files")
    return listWorkspaceFiles(request);

  return undefined;
}
