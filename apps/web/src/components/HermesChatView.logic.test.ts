import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HermesContextUsageMeter, normalizeWorkspaceFileResults } from "./HermesChatView";

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
