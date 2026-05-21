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

export type HermesSlashCommandKind = "builtin";

export interface HermesSlashCommand {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly kind: HermesSlashCommandKind;
  readonly inputHint?: string | undefined;
}

export const builtInHermesCommands: readonly HermesSlashCommand[] = [
  { id: "new", name: "/new", description: "Fresh session.", kind: "builtin" },
  { id: "reset", name: "/reset", description: "Alias for /new.", kind: "builtin" },
  {
    id: "clear",
    name: "/clear",
    description: "Clear screen and start a new CLI session.",
    kind: "builtin",
  },
  { id: "retry", name: "/retry", description: "Resend the last message.", kind: "builtin" },
  { id: "undo", name: "/undo", description: "Remove the last exchange.", kind: "builtin" },
  {
    id: "title",
    name: "/title",
    description: "Name the session.",
    kind: "builtin",
    inputHint: "[name]",
  },
  { id: "compress", name: "/compress", description: "Manually compress context.", kind: "builtin" },
  { id: "stop", name: "/stop", description: "Kill background processes.", kind: "builtin" },
  {
    id: "rollback",
    name: "/rollback",
    description: "Restore a filesystem checkpoint.",
    kind: "builtin",
    inputHint: "[N]",
  },
  {
    id: "background",
    name: "/background",
    description: "Run a prompt in the background.",
    kind: "builtin",
    inputHint: "<prompt>",
  },
  {
    id: "queue",
    name: "/queue",
    description: "Queue a prompt for the next turn.",
    kind: "builtin",
    inputHint: "<prompt>",
  },
  {
    id: "resume",
    name: "/resume",
    description: "Resume a named session.",
    kind: "builtin",
    inputHint: "[name]",
  },
  { id: "config", name: "/config", description: "Show Hermes config.", kind: "builtin" },
  {
    id: "model",
    name: "/model",
    description: "Open the Hermes model picker.",
    kind: "builtin",
    inputHint: "[name]",
  },
  {
    id: "personality",
    name: "/personality",
    description: "Set the active personality.",
    kind: "builtin",
    inputHint: "[name]",
  },
  {
    id: "reasoning",
    name: "/reasoning",
    description: "Set reasoning level or visibility.",
    kind: "builtin",
    inputHint: "[level]",
  },
  { id: "verbose", name: "/verbose", description: "Cycle verbose output modes.", kind: "builtin" },
  {
    id: "voice",
    name: "/voice",
    description: "Toggle voice mode.",
    kind: "builtin",
    inputHint: "[on|off|tts]",
  },
  { id: "yolo", name: "/yolo", description: "Toggle approval bypass.", kind: "builtin" },
  {
    id: "skin",
    name: "/skin",
    description: "Change the CLI theme.",
    kind: "builtin",
    inputHint: "[name]",
  },
  { id: "statusbar", name: "/statusbar", description: "Toggle CLI status bar.", kind: "builtin" },
  { id: "tools", name: "/tools", description: "Manage tools.", kind: "builtin" },
  { id: "toolsets", name: "/toolsets", description: "List toolsets.", kind: "builtin" },
  { id: "skills", name: "/skills", description: "Search or install skills.", kind: "builtin" },
  {
    id: "skill",
    name: "/skill",
    description: "Load a skill into this session.",
    kind: "builtin",
    inputHint: "<name>",
  },
  { id: "cron", name: "/cron", description: "Manage cron jobs.", kind: "builtin" },
  { id: "reload-mcp", name: "/reload-mcp", description: "Reload MCP servers.", kind: "builtin" },
  { id: "plugins", name: "/plugins", description: "List plugins.", kind: "builtin" },
  {
    id: "approve",
    name: "/approve",
    description: "Approve a pending gateway command.",
    kind: "builtin",
  },
  { id: "deny", name: "/deny", description: "Deny a pending gateway command.", kind: "builtin" },
  { id: "restart", name: "/restart", description: "Restart gateway.", kind: "builtin" },
  {
    id: "sethome",
    name: "/sethome",
    description: "Set current chat as home channel.",
    kind: "builtin",
  },
  { id: "update", name: "/update", description: "Update Hermes to latest.", kind: "builtin" },
  {
    id: "platforms",
    name: "/platforms",
    description: "Show platform connection status.",
    kind: "builtin",
  },
  { id: "gateway", name: "/gateway", description: "Alias for /platforms.", kind: "builtin" },
  { id: "branch", name: "/branch", description: "Branch the current session.", kind: "builtin" },
  { id: "fork", name: "/fork", description: "Alias for /branch.", kind: "builtin" },
  { id: "fast", name: "/fast", description: "Toggle priority processing.", kind: "builtin" },
  { id: "browser", name: "/browser", description: "Open CDP browser connection.", kind: "builtin" },
  { id: "history", name: "/history", description: "Show conversation history.", kind: "builtin" },
  { id: "save", name: "/save", description: "Save conversation to file.", kind: "builtin" },
  { id: "paste", name: "/paste", description: "Attach clipboard image.", kind: "builtin" },
  { id: "image", name: "/image", description: "Attach a local image file.", kind: "builtin" },
  { id: "help", name: "/help", description: "Show Hermes help.", kind: "builtin" },
  {
    id: "commands",
    name: "/commands",
    description: "Browse all commands.",
    kind: "builtin",
    inputHint: "[page]",
  },
  { id: "usage", name: "/usage", description: "Show token usage.", kind: "builtin" },
  {
    id: "insights",
    name: "/insights",
    description: "Show usage analytics.",
    kind: "builtin",
    inputHint: "[days]",
  },
  { id: "status", name: "/status", description: "Show session info.", kind: "builtin" },
  { id: "profile", name: "/profile", description: "Show active profile info.", kind: "builtin" },
  { id: "quit", name: "/quit", description: "Exit CLI.", kind: "builtin" },
  { id: "exit", name: "/exit", description: "Alias for /quit.", kind: "builtin" },
  { id: "q", name: "/q", description: "Alias for /quit.", kind: "builtin" },
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

export function buildHermesSlashCommands(): HermesSlashCommand[] {
  return [...builtInHermesCommands];
}

export function filterHermesSlashCommands(
  commands: readonly HermesSlashCommand[],
  query: string,
): HermesSlashCommand[] {
  const trimmed = query.trim();
  const normalized = trimmed.replace(/^\//, "").toLowerCase();
  if (!normalized) return [...commands];
  return commands.filter((command) => {
    const normalizedName = command.name.replace(/^\//, "").toLowerCase();
    if (trimmed.startsWith("/")) return normalizedName.startsWith(normalized);
    const haystack = `${command.name} ${command.inputHint ?? ""} ${command.description}`
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
