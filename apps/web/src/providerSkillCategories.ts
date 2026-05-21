import type { ServerProviderSkill } from "@t3delta/contracts";
import type { HermesSkillCategorySettings } from "@t3delta/contracts/settings";

export const GENERAL_PROVIDER_SKILL_CATEGORY_ID = "general";

const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  apple: "Apple",
  general: "General",
  github: "GitHub",
  ios: "iOS",
  macos: "macOS",
  mcp: "MCP",
  mlops: "MLOps",
  ui: "UI",
};

export type ResolvedProviderSkillCategory = {
  id: string;
  label: string;
  skillCount: number;
};

export function normalizeProviderSkillCategory(category: string | undefined): string {
  const normalized = category?.trim().toLowerCase().replaceAll(" ", "-");
  return normalized ? normalized : GENERAL_PROVIDER_SKILL_CATEGORY_ID;
}

export function formatProviderSkillCategoryLabel(category: string | undefined): string {
  const normalized = normalizeProviderSkillCategory(category);
  const knownLabel = CATEGORY_LABELS[normalized];
  if (knownLabel) return knownLabel;
  return normalized
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function resolveProviderSkillCategoryId(
  skill: Pick<ServerProviderSkill, "name" | "scope">,
  settings: HermesSkillCategorySettings | undefined,
): string {
  return normalizeProviderSkillCategory(settings?.assignments[skill.name] ?? skill.scope);
}

export function resolveProviderSkillCategoryLabel(
  categoryId: string,
  settings: HermesSkillCategorySettings | undefined,
): string {
  const normalized = normalizeProviderSkillCategory(categoryId);
  const custom = settings?.categories.find(
    (category) => normalizeProviderSkillCategory(category.id) === normalized,
  );
  return custom?.label.trim() || formatProviderSkillCategoryLabel(normalized);
}

export function resolveProviderSkillCategories(
  skills: ReadonlyArray<ServerProviderSkill>,
  settings: HermesSkillCategorySettings | undefined,
): ResolvedProviderSkillCategory[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    if (!skill.enabled) continue;
    const categoryId = resolveProviderSkillCategoryId(skill, settings);
    counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
  }
  for (const category of settings?.categories ?? []) {
    const categoryId = normalizeProviderSkillCategory(category.id);
    if (!counts.has(categoryId)) counts.set(categoryId, 0);
  }
  return Array.from(counts.entries())
    .map(([id, skillCount]) => ({
      id,
      label: resolveProviderSkillCategoryLabel(id, settings),
      skillCount,
    }))
    .toSorted((left, right) => {
      if (left.id === GENERAL_PROVIDER_SKILL_CATEGORY_ID) return -1;
      if (right.id === GENERAL_PROVIDER_SKILL_CATEGORY_ID) return 1;
      return left.label.localeCompare(right.label);
    });
}

export function setProviderSkillCategoryAssignment(
  settings: HermesSkillCategorySettings,
  skillName: string,
  categoryId: string,
): HermesSkillCategorySettings {
  const normalizedCategoryId = normalizeProviderSkillCategory(categoryId);
  return {
    ...settings,
    assignments: {
      ...settings.assignments,
      [skillName]: normalizedCategoryId,
    },
  };
}

export function upsertProviderSkillCategory(
  settings: HermesSkillCategorySettings,
  categoryId: string,
  label: string,
): HermesSkillCategorySettings {
  const normalizedCategoryId = normalizeProviderSkillCategory(categoryId);
  const trimmedLabel = label.trim() || formatProviderSkillCategoryLabel(normalizedCategoryId);
  const categories = settings.categories.filter(
    (category) => normalizeProviderSkillCategory(category.id) !== normalizedCategoryId,
  );
  return {
    ...settings,
    categories: [...categories, { id: normalizedCategoryId, label: trimmedLabel }].toSorted(
      (left, right) => left.label.localeCompare(right.label),
    ),
  };
}

export function deleteProviderSkillCategory(
  settings: HermesSkillCategorySettings,
  categoryId: string,
  skills: ReadonlyArray<Pick<ServerProviderSkill, "enabled" | "name" | "scope">>,
): HermesSkillCategorySettings {
  const normalizedCategoryId = normalizeProviderSkillCategory(categoryId);
  if (normalizedCategoryId === GENERAL_PROVIDER_SKILL_CATEGORY_ID) return settings;

  const assignments = { ...settings.assignments };
  for (const skill of skills) {
    if (!skill.enabled) continue;
    if (resolveProviderSkillCategoryId(skill, settings) === normalizedCategoryId) {
      assignments[skill.name] = GENERAL_PROVIDER_SKILL_CATEGORY_ID;
    }
  }

  return {
    categories: settings.categories.filter(
      (category) => normalizeProviderSkillCategory(category.id) !== normalizedCategoryId,
    ),
    assignments,
  };
}
