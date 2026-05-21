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
  it("exposes Hermes built-ins without mixing installed skills into slash search", () => {
    const commands = buildHermesSlashCommands();

    expect(commands.map((command) => command.name)).toContain("/model");
    expect(commands.map((command) => command.name)).toContain("/skill");
    expect(commands.map((command) => command.name)).toContain("/usage");
    expect(commands.some((command) => command.id.startsWith("skill:"))).toBe(false);
  });
});

describe("filterHermesSlashCommands", () => {
  it("filters built-ins by command text, input hint, or description", () => {
    const commands = buildHermesSlashCommands();

    expect(filterHermesSlashCommands(commands, "/mod").map((command) => command.name)).toEqual([
      "/model",
    ]);
    expect(filterHermesSlashCommands(commands, "token").map((command) => command.name)).toContain(
      "/usage",
    );
    expect(filterHermesSlashCommands(commands, "<name>").map((command) => command.name)).toContain(
      "/skill",
    );
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
