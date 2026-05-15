import { describe, expect, it } from "vitest";

import {
  buildHermesSlashCommands,
  filterHermesSkills,
  filterHermesSlashCommands,
  normalizeHermesSkills,
} from "./hermesSkills";

describe("normalizeHermesSkills", () => {
  it("normalizes installed skills from relay responses", () => {
    expect(
      normalizeHermesSkills([
        { name: "research", description: "Research things", category: "analysis" },
        { name: "draft" },
        { description: "missing name" },
      ]),
    ).toEqual([
      { name: "draft", description: "No description provided.", category: "uncategorized" },
      { name: "research", description: "Research things", category: "analysis" },
    ]);
  });
});

describe("buildHermesSlashCommands", () => {
  it("keeps built-ins available and appends installed Hermes skills", () => {
    const commands = buildHermesSlashCommands([
      { name: "research", description: "Research things", category: "analysis" },
    ]);

    expect(commands.map((command) => command.name)).toEqual([
      "/model",
      "/new",
      "/clear",
      "/research",
    ]);
    expect(commands.at(-1)).toMatchObject({ kind: "skill", id: "skill:research" });
  });
});

describe("filterHermesSlashCommands", () => {
  it("filters built-ins and skills by command text or description", () => {
    const commands = buildHermesSlashCommands([
      { name: "storyboard", description: "Plan shots", category: "creative" },
    ]);

    expect(filterHermesSlashCommands(commands, "/mod").map((command) => command.name)).toEqual([
      "/model",
    ]);
    expect(filterHermesSlashCommands(commands, "creative").map((command) => command.name)).toEqual([
      "/storyboard",
    ]);
  });
});

describe("filterHermesSkills", () => {
  it("filters $ skill search by name, description, or category", () => {
    const skills = [
      { name: "research", description: "Find sources", category: "analysis" },
      { name: "storyboard", description: "Plan shots", category: "creative" },
    ];

    expect(filterHermesSkills(skills, "$story").map((skill) => skill.name)).toEqual(["storyboard"]);
    expect(filterHermesSkills(skills, "sources").map((skill) => skill.name)).toEqual(["research"]);
  });
});
