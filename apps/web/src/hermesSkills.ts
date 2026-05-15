export interface HermesSkillSummary {
  readonly name: string;
  readonly description: string;
  readonly category: string;
}

export type HermesSkillTrustTier = "Official" | "Verified" | "Community";

export interface HermesHubSkill {
  readonly identifier: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly trustTier: HermesSkillTrustTier;
}

export type HermesSlashCommandKind = "builtin" | "skill";

export interface HermesSlashCommand {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: HermesSlashCommandKind;
  readonly skill?: HermesSkillSummary;
}

export const builtInHermesCommands: readonly HermesSlashCommand[] = [
  {
    id: "model",
    name: "/model",
    description: "Open the Hermes model picker.",
    kind: "builtin",
  },
  {
    id: "new",
    name: "/new",
    description: "Start a new Hermes session.",
    kind: "builtin",
  },
  {
    id: "clear",
    name: "/clear",
    description: "Clear the current composer draft.",
    kind: "builtin",
  },
];

export const hermesSkillsHubCatalog: readonly HermesHubSkill[] = [
  {
    identifier: "web-research",
    name: "web-research",
    description: "Research public web sources and synthesize concise findings.",
    category: "research",
    trustTier: "Official",
  },
  {
    identifier: "image-generation",
    name: "image-generation",
    description: "Create and refine image generation prompts and workflows.",
    category: "creative",
    trustTier: "Official",
  },
  {
    identifier: "figma-to-react",
    name: "figma-to-react",
    description: "Translate Figma component specs into React implementation notes.",
    category: "design",
    trustTier: "Verified",
  },
  {
    identifier: "video-storyboard",
    name: "video-storyboard",
    description: "Plan short video concepts, scenes, and shot lists.",
    category: "creative",
    trustTier: "Community",
  },
];

export function normalizeHermesSkills(body: unknown): HermesSkillSummary[] {
  const raw = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { skills?: unknown }).skills)
      ? (body as { skills: unknown[] }).skills
      : [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return undefined;
      const candidate = entry as {
        name?: unknown;
        description?: unknown;
        category?: unknown;
      };
      if (typeof candidate.name !== "string" || !candidate.name.trim()) return undefined;
      return {
        name: candidate.name.trim(),
        description:
          typeof candidate.description === "string" && candidate.description.trim()
            ? candidate.description.trim()
            : "No description provided.",
        category:
          typeof candidate.category === "string" && candidate.category.trim()
            ? candidate.category.trim()
            : "uncategorized",
      } satisfies HermesSkillSummary;
    })
    .filter((skill): skill is HermesSkillSummary => Boolean(skill))
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

export function buildHermesSlashCommands(
  installedSkills: readonly HermesSkillSummary[],
): HermesSlashCommand[] {
  return [
    ...builtInHermesCommands,
    ...installedSkills.map((skill) => ({
      id: `skill:${skill.name}`,
      name: `/${skill.name}`,
      description: skill.description || `Run the ${skill.name} Hermes skill.`,
      kind: "skill" as const,
      skill,
    })),
  ];
}

export function filterHermesSlashCommands(
  commands: readonly HermesSlashCommand[],
  query: string,
): HermesSlashCommand[] {
  const normalized = query.trim().replace(/^\//, "").toLowerCase();
  if (!normalized) return [...commands];
  return commands.filter((command) => {
    const haystack = `${command.name} ${command.description} ${command.skill?.category ?? ""}`
      .toLowerCase()
      .replace(/^\//, "");
    return haystack.includes(normalized);
  });
}

export function filterHermesSkills(
  skills: readonly HermesSkillSummary[],
  query: string,
): HermesSkillSummary[] {
  const normalized = query.trim().replace(/^\$/, "").toLowerCase();
  if (!normalized) return [...skills];
  return skills.filter((skill) =>
    `${skill.name} ${skill.description} ${skill.category}`.toLowerCase().includes(normalized),
  );
}
