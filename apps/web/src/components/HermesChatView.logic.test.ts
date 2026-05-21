import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  HermesContextUsageMeter,
  formatElapsedTime,
  normalizeHermesJobs,
  normalizeHermesMemory,
  normalizeHermesModels,
  normalizeWorkspaceFileResults,
} from "./HermesChatView";

describe("normalizeWorkspaceFileResults", () => {
  it("reads file mention results from the relay files array", () => {
    expect(
      normalizeWorkspaceFileResults({ files: ["README.md", "apps/web/src/main.tsx"] }),
    ).toEqual(["README.md", "apps/web/src/main.tsx"]);
  });

  it("accepts entry-shaped workspace file results", () => {
    expect(
      normalizeWorkspaceFileResults({
        entries: [
          { path: "package.json" },
          { relativePath: "apps/server/src/hermesRelay.ts" },
          { name: "fallback.txt" },
          { path: 12 },
        ],
      }),
    ).toEqual(["package.json", "apps/server/src/hermesRelay.ts", "fallback.txt"]);
  });
});

describe("HermesContextUsageMeter", () => {
  it("renders token counts and warning styling near the context limit", () => {
    const markup = renderToStaticMarkup(
      createElement(HermesContextUsageMeter, {
        usage: { usedTokens: 8_500, maxTokens: 10_000 },
      }),
    );

    expect(markup).toContain("8,500 / 10,000");
    expect(markup).toContain("bg-amber-400");
  });
});

describe("formatElapsedTime", () => {
  it("formats seconds, minutes, and hours for the composer status rail", () => {
    expect(formatElapsedTime(12_500)).toBe("12s");
    expect(formatElapsedTime(125_000)).toBe("2m 5s");
    expect(formatElapsedTime(7_500_000)).toBe("2h 5m");
  });
});

describe("normalizeHermesModels", () => {
  it("groups provider/model metadata and marks the Hermes default", () => {
    expect(
      normalizeHermesModels({
        default_model: "openai-codex/gpt-5.5",
        data: [
          { id: "openai-codex/gpt-5.5", owned_by: "openai-codex" },
          { id: "anthropic/claude-sonnet-4.5", provider: "anthropic", name: "Claude Sonnet" },
        ],
      }),
    ).toEqual([
      {
        id: "openai-codex/gpt-5.5",
        provider: "openai-codex",
        name: "gpt-5.5",
        isDefault: true,
      },
      {
        id: "anthropic/claude-sonnet-4.5",
        provider: "anthropic",
        name: "Claude Sonnet",
        isDefault: false,
      },
    ]);
  });
});

describe("normalizeHermesMemory", () => {
  it("returns MEMORY.md and USER.md documents with empty placeholders", () => {
    expect(normalizeHermesMemory({ memory: "# Agent", user: "" })).toEqual([
      {
        file: "memory",
        title: "Agent memory",
        filename: "MEMORY.md",
        content: "# Agent",
      },
      {
        file: "user",
        title: "User profile",
        filename: "USER.md",
        content: "",
      },
    ]);
  });
});

describe("normalizeHermesJobs", () => {
  it("normalizes job list status, output, errors, and config", () => {
    expect(
      normalizeHermesJobs({
        jobs: [
          {
            id: "daily",
            name: "Daily cleanup",
            cron: "0 9 * * *",
            status: "active",
            last_output: "done",
            last_error: "",
            config: { prompt: "clean" },
          },
        ],
      }),
    ).toMatchObject([
      {
        id: "daily",
        name: "Daily cleanup",
        schedule: "0 9 * * *",
        status: "running",
        output: "done",
        error: "",
      },
    ]);
  });

  it("does not expose the full raw job record as config when config is missing", () => {
    expect(
      normalizeHermesJobs({
        jobs: [
          {
            id: "without-config",
            name: "Without config",
            status: "completed",
            output: "done",
          },
        ],
      }),
    ).toMatchObject([
      {
        id: "without-config",
        config: "{}",
        output: "done",
      },
    ]);
  });
});
