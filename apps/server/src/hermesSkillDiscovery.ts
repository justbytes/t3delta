import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";

import type { ServerProviderSkill } from "@t3delta/contracts";

export interface HermesSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly category: string;
}

export interface HermesSkillFile {
  readonly fullPath: string;
  readonly relativeDir: string;
  readonly summary: HermesSkillSummary;
}

export function resolveHermesRoot(input?: { readonly hermesDir?: string }): string {
  return input?.hermesDir ?? process.env.HERMES_HOME ?? join(homedir(), ".hermes");
}

async function fileExists(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isFile())
    .catch(() => false);
}

export async function directoryExists(path: string): Promise<boolean> {
  return stat(path)
    .then((value) => value.isDirectory())
    .catch(() => false);
}

export function parseSkillFrontmatter(markdown: string): Record<string, string> {
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

export function descriptionFromSkillMarkdown(markdown: string): string {
  const metadata = parseSkillFrontmatter(markdown);
  if (metadata.description) return metadata.description;
  const body = markdown.replace(/^---[\s\S]*?\n---\s*/, "");
  const heading = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  return heading ?? "";
}

export async function findHermesSkillFiles(
  skillsDir: string,
): Promise<ReadonlyArray<HermesSkillFile>> {
  async function walk(dir: string): Promise<ReadonlyArray<HermesSkillFile>> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: HermesSkillFile[] = [];
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (!entry.isDirectory()) continue;

      const skillPath = join(fullPath, "SKILL.md");
      if (await fileExists(skillPath)) {
        const content = await readFile(skillPath, "utf8");
        const metadata = parseSkillFrontmatter(content);
        const relativeDir = relative(skillsDir, fullPath);
        const parts = relativeDir.split(sep);
        files.push({
          fullPath: skillPath,
          relativeDir,
          summary: {
            name: metadata.name ?? basename(fullPath),
            description: metadata.description ?? descriptionFromSkillMarkdown(content),
            category: parts.length > 1 ? parts[0]! : "uncategorized",
          },
        });
        continue;
      }

      files.push(...(await walk(fullPath)));
    }
    return files;
  }

  return walk(skillsDir);
}

export async function listHermesProviderSkills(input?: {
  readonly hermesDir?: string;
}): Promise<ReadonlyArray<ServerProviderSkill>> {
  const skillsDir = join(resolveHermesRoot(input), "skills");
  if (!(await directoryExists(skillsDir))) return [];

  const seen = new Set<string>();
  const skills: ServerProviderSkill[] = [];
  for (const skill of await findHermesSkillFiles(skillsDir)) {
    if (seen.has(skill.summary.name)) continue;
    seen.add(skill.summary.name);
    skills.push({
      name: skill.summary.name,
      path: skill.fullPath,
      enabled: true,
      ...(skill.summary.description ? { description: skill.summary.description } : {}),
      ...(skill.summary.description ? { shortDescription: skill.summary.description } : {}),
      ...(skill.summary.category ? { scope: skill.summary.category } : {}),
    });
  }

  return skills.toSorted((left, right) => left.name.localeCompare(right.name));
}
