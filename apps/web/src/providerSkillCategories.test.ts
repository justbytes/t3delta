import { describe, expect, it } from "vitest";
import type { ServerProviderSkill } from "@t3delta/contracts";

import {
  GENERAL_PROVIDER_SKILL_CATEGORY_ID,
  deleteProviderSkillCategory,
  resolveProviderSkillCategories,
  resolveProviderSkillCategoryId,
  resolveProviderSkillCategoryLabel,
  setProviderSkillCategoryAssignment,
  upsertProviderSkillCategory,
} from "./providerSkillCategories";

const skills: ServerProviderSkill[] = [
  {
    name: "github-pr-workflow",
    path: "/skills/github/github-pr-workflow/SKILL.md",
    scope: "github",
    enabled: true,
  },
  {
    name: "imessage",
    path: "/skills/apple/imessage/SKILL.md",
    scope: "apple",
    enabled: true,
  },
];

describe("provider skill categories", () => {
  it("uses custom labels for default categories", () => {
    const settings = {
      categories: [{ id: "github", label: "Source Control" }],
      assignments: {},
    };

    expect(resolveProviderSkillCategoryLabel("github", settings)).toBe("Source Control");
    expect(
      resolveProviderSkillCategories(skills, settings).map((category) => category.label),
    ).toEqual(["Apple", "Source Control"]);
  });

  it("lets users assign a skill to a custom category", () => {
    const settings = upsertProviderSkillCategory(
      { categories: [], assignments: {} },
      "personal-comms",
      "Personal Comms",
    );
    const next = setProviderSkillCategoryAssignment(settings, "imessage", "personal-comms");

    expect(resolveProviderSkillCategoryId(skills[1]!, next)).toBe("personal-comms");
    expect(resolveProviderSkillCategories(skills, next).map((category) => category.label)).toEqual([
      "GitHub",
      "Personal Comms",
    ]);
  });

  it("uses General as the fallback category for uncategorized skills", () => {
    expect(resolveProviderSkillCategoryId({ name: "loose-skill", scope: "" }, undefined)).toBe(
      GENERAL_PROVIDER_SKILL_CATEGORY_ID,
    );
    expect(resolveProviderSkillCategoryLabel(GENERAL_PROVIDER_SKILL_CATEGORY_ID, undefined)).toBe(
      "General",
    );
  });

  it("moves skills from a deleted category into General", () => {
    const next = deleteProviderSkillCategory({ categories: [], assignments: {} }, "apple", skills);

    expect(resolveProviderSkillCategoryId(skills[1]!, next)).toBe(
      GENERAL_PROVIDER_SKILL_CATEGORY_ID,
    );
    expect(resolveProviderSkillCategories(skills, next).map((category) => category.label)).toEqual([
      "General",
      "GitHub",
    ]);
  });
});
