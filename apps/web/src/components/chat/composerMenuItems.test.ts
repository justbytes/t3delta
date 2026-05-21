import type { ServerProvider } from "@t3delta/contracts";
import { describe, expect, it } from "vitest";

import { buildComposerMenuItems } from "./composerMenuItems";
import type { ComposerTrigger } from "../../composer-logic";

const hermesProviderStatus: ServerProvider = {
  provider: "hermes",
  enabled: true,
  installed: true,
  version: "0.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [],
  slashCommands: [
    { name: "skill", description: "Load a skill", input: { hint: "<name>" } },
    { name: "tools", description: "Manage tools" },
  ],
  skills: [
    {
      name: "task-planning",
      path: "/Users/example/.hermes/skills/task-planning/SKILL.md",
      enabled: true,
      scope: "software-development",
      shortDescription: "Plan implementation work packs",
    },
    {
      name: "github-pr-workflow",
      path: "/Users/example/.hermes/skills/github/github-pr-workflow/SKILL.md",
      enabled: true,
      scope: "github",
      shortDescription: "Open, review, and merge GitHub pull requests",
    },
    {
      name: "github-issues",
      path: "/Users/example/.hermes/skills/github/github-issues/SKILL.md",
      enabled: true,
      scope: "github",
      shortDescription: "Create and triage GitHub issues",
    },
    {
      name: "imessage",
      path: "/Users/example/.hermes/skills/apple/imessage/SKILL.md",
      enabled: true,
      scope: "apple",
      shortDescription: "Send and receive iMessage and SMS",
    },
  ],
};

const slashTrigger = (query: string): ComposerTrigger => ({
  kind: "slash-command",
  query,
  rangeStart: 0,
  rangeEnd: query.length + 1,
});

const skillTrigger = (query: string): ComposerTrigger => ({
  kind: "skill",
  query,
  rangeStart: 0,
  rangeEnd: query.length + 1,
});

describe("buildComposerMenuItems", () => {
  it("keeps Hermes installed skills out of the slash command menu", () => {
    const items = buildComposerMenuItems({
      composerTrigger: slashTrigger("task"),
      selectedProvider: "hermes",
      selectedProviderStatus: hermesProviderStatus,
      searchableModelOptions: [],
      workspaceEntries: [],
    });

    expect(items.map((item) => item.label)).not.toContain("/skill task-planning");
    expect(items.map((item) => item.label)).toEqual([]);
  });

  it("shows Hermes installed skills from the $ skill trigger", () => {
    const items = buildComposerMenuItems({
      composerTrigger: skillTrigger("task"),
      selectedProvider: "hermes",
      selectedProviderStatus: hermesProviderStatus,
      searchableModelOptions: [],
      workspaceEntries: [],
    });

    const skillItems = items.filter((item) => item.type === "skill");
    expect(skillItems).toHaveLength(1);
    expect(skillItems[0]).toMatchObject({
      id: "skill:hermes:task-planning",
      type: "skill",
      label: "Task Planning",
      description: "Plan implementation work packs",
    });
  });

  it("shows selectable categories before skills when browsing the $ skill menu", () => {
    const items = buildComposerMenuItems({
      composerTrigger: skillTrigger(""),
      selectedProvider: "hermes",
      selectedProviderStatus: hermesProviderStatus,
      searchableModelOptions: [],
      workspaceEntries: [],
    });

    expect(items.slice(0, 3).map((item) => item.label)).toEqual([
      "Apple",
      "GitHub",
      "Software Development",
    ]);
    expect(items[1]).toMatchObject({
      id: "skill-category:hermes:github",
      type: "skill-category",
      category: "github",
      description: "2 skills",
    });
  });

  it("filters skills to a selected category with $category/", () => {
    const items = buildComposerMenuItems({
      composerTrigger: skillTrigger("github/"),
      selectedProvider: "hermes",
      selectedProviderStatus: hermesProviderStatus,
      searchableModelOptions: [],
      workspaceEntries: [],
    });

    expect(items.map((item) => item.label)).toEqual(["GitHub Issues", "GitHub Pr Workflow"]);
    expect(items.every((item) => item.type === "skill")).toBe(true);
  });

  it("searches within a selected category after $category/query", () => {
    const items = buildComposerMenuItems({
      composerTrigger: skillTrigger("github/pr"),
      selectedProvider: "hermes",
      selectedProviderStatus: hermesProviderStatus,
      searchableModelOptions: [],
      workspaceEntries: [],
    });

    expect(items.map((item) => item.label)).toEqual(["GitHub Pr Workflow"]);
  });

  it("does not mix generic T3 slash commands into the Hermes slash menu", () => {
    const items = buildComposerMenuItems({
      composerTrigger: slashTrigger(""),
      selectedProvider: "hermes",
      selectedProviderStatus: hermesProviderStatus,
      searchableModelOptions: [],
      workspaceEntries: [],
    });

    expect(items.map((item) => item.label)).toEqual(["/skill", "/tools"]);
  });
});
