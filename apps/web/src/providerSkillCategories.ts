const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  apple: "Apple",
  github: "GitHub",
  ios: "iOS",
  macos: "macOS",
  mcp: "MCP",
  mlops: "MLOps",
  ui: "UI",
};

export function normalizeProviderSkillCategory(category: string | undefined): string {
  const normalized = category?.trim().toLowerCase();
  return normalized ? normalized : "other";
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
