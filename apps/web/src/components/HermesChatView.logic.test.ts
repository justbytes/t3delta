import { describe, expect, it } from "vitest";

import { normalizeWorkspaceFileResults } from "./HermesChatView";

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
