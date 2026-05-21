import type {
  ProjectEntry,
  ProviderKind,
  ServerProvider,
  ServerProviderSkill,
} from "@t3delta/contracts";
import type { HermesSkillCategorySettings } from "@t3delta/contracts/settings";

import type { ComposerTrigger } from "../../composer-logic";
import {
  normalizeProviderSkillCategory,
  resolveProviderSkillCategoryId,
  resolveProviderSkillCategoryLabel,
} from "../../providerSkillCategories";
import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import { searchProviderSkills } from "../../providerSkillSearch";
import { basenameOfPath } from "../../vscode-icons";
import { searchSlashCommandItems } from "./composerSlashCommandSearch";
import type { ComposerCommandItem } from "./ComposerCommandMenu";

type SearchableModelOption = {
  provider: ProviderKind;
  providerLabel: string;
  slug: string;
  name: string;
  searchSlug: string;
  searchName: string;
  searchProvider: string;
};

function buildSkillCategoryItems(
  provider: ProviderKind,
  skills: ReadonlyArray<ServerProviderSkill>,
  query: string,
  skillCategorySettings: HermesSkillCategorySettings | undefined,
): ComposerCommandItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  const categories = new Map<string, number>();
  for (const skill of skills) {
    if (!skill.enabled) continue;
    const category = resolveProviderSkillCategoryId(skill, skillCategorySettings);
    categories.set(category, (categories.get(category) ?? 0) + 1);
  }
  for (const category of skillCategorySettings?.categories ?? []) {
    const categoryId = normalizeProviderSkillCategory(category.id);
    if (!categories.has(categoryId)) categories.set(categoryId, 0);
  }

  return Array.from(categories.entries())
    .map(([category, count]) => ({
      id: `skill-category:${provider}:${category}`,
      type: "skill-category" as const,
      provider,
      category,
      label: resolveProviderSkillCategoryLabel(category, skillCategorySettings),
      description: `${count.toLocaleString()} ${count === 1 ? "skill" : "skills"}`,
    }))
    .filter((item) => {
      if (!normalizedQuery) return true;
      return (
        item.category.includes(normalizedQuery) ||
        item.label.toLowerCase().includes(normalizedQuery)
      );
    })
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

function buildSkillItems(
  provider: ProviderKind,
  skills: ReadonlyArray<ServerProviderSkill>,
  query: string,
): ComposerCommandItem[] {
  const items = searchProviderSkills(skills, query).map((skill) => ({
    id: `skill:${provider}:${skill.name}`,
    type: "skill" as const,
    provider,
    skill,
    label: formatProviderSkillDisplayName(skill),
    description:
      skill.shortDescription ??
      skill.description ??
      (skill.scope ? `${skill.scope} skill` : "Run provider skill"),
  }));
  return query.trim()
    ? items
    : items.toSorted((left, right) => left.label.localeCompare(right.label));
}

function splitSkillCategoryQuery(query: string): { category: string; query: string } | null {
  const slashIndex = query.indexOf("/");
  if (slashIndex < 0) return null;
  const category = normalizeProviderSkillCategory(query.slice(0, slashIndex));
  if (!category || category === "other") return null;
  return { category, query: query.slice(slashIndex + 1) };
}

export function buildComposerMenuItems(input: {
  composerTrigger: ComposerTrigger | null;
  workspaceEntries: ReadonlyArray<ProjectEntry>;
  selectedProvider: ProviderKind;
  selectedProviderStatus: ServerProvider | undefined;
  skillCategorySettings?: HermesSkillCategorySettings | undefined;
  searchableModelOptions: ReadonlyArray<SearchableModelOption>;
}): ComposerCommandItem[] {
  const {
    composerTrigger,
    workspaceEntries,
    selectedProvider,
    selectedProviderStatus,
    skillCategorySettings,
    searchableModelOptions,
  } = input;
  if (!composerTrigger) return [];
  if (composerTrigger.kind === "path") {
    return workspaceEntries.map((entry) => ({
      id: `path:${entry.kind}:${entry.path}`,
      type: "path",
      path: entry.path,
      pathKind: entry.kind,
      label: basenameOfPath(entry.path),
      description: entry.parentPath ?? "",
    }));
  }
  if (composerTrigger.kind === "slash-command") {
    const builtInSlashCommandItems = (
      selectedProvider === "hermes"
        ? []
        : [
            {
              id: "slash:model",
              type: "slash-command",
              command: "model",
              label: "/model",
              description: "Switch response model for this thread",
            },
            {
              id: "slash:plan",
              type: "slash-command",
              command: "plan",
              label: "/plan",
              description: "Switch this thread into plan mode",
            },
            {
              id: "slash:default",
              type: "slash-command",
              command: "default",
              label: "/default",
              description: "Switch this thread back to normal build mode",
            },
          ]
    ) satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: "slash-command" }>>;
    const providerSlashCommandItems = (selectedProviderStatus?.slashCommands ?? []).map(
      (command) => ({
        id: `provider-slash-command:${selectedProvider}:${command.name}`,
        type: "provider-slash-command" as const,
        provider: selectedProvider,
        command,
        label: `/${command.name}`,
        description: command.description ?? command.input?.hint ?? "Run provider command",
      }),
    );
    const query = composerTrigger.query.trim().toLowerCase();
    const slashCommandItems = [...builtInSlashCommandItems, ...providerSlashCommandItems];
    if (!query) {
      return slashCommandItems;
    }
    return searchSlashCommandItems(slashCommandItems, query);
  }
  if (composerTrigger.kind === "skill") {
    const skills = selectedProviderStatus?.skills ?? [];
    const categoryQuery = splitSkillCategoryQuery(composerTrigger.query);
    if (categoryQuery) {
      const categorySkills = skills.filter(
        (skill) =>
          resolveProviderSkillCategoryId(skill, skillCategorySettings) === categoryQuery.category,
      );
      return buildSkillItems(selectedProvider, categorySkills, categoryQuery.query);
    }
    return [
      ...buildSkillCategoryItems(
        selectedProvider,
        skills,
        composerTrigger.query,
        skillCategorySettings,
      ),
      ...buildSkillItems(selectedProvider, skills, composerTrigger.query),
    ];
  }
  return searchableModelOptions
    .filter(({ searchSlug, searchName, searchProvider }) => {
      const query = composerTrigger.query.trim().toLowerCase();
      if (!query) return true;
      return (
        searchSlug.includes(query) || searchName.includes(query) || searchProvider.includes(query)
      );
    })
    .map(({ provider, providerLabel, slug, name }) => ({
      id: `model:${provider}:${slug}`,
      type: "model",
      provider,
      model: slug,
      label: name,
      description: `${providerLabel} · ${slug}`,
    }));
}
