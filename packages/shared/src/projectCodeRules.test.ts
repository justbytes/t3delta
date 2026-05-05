import { describe, expect, it } from "vitest";

import {
  evaluateBuiltInJavaScriptTypeScriptCodeRules,
  isBuiltInJavaScriptTypeScriptRuleConfigFile,
} from "./projectCodeRules.js";

describe("projectCodeRules", () => {
  it("suppresses built-in fallback rules only for ESLint config files", () => {
    expect(isBuiltInJavaScriptTypeScriptRuleConfigFile("eslint.config.js")).toBe(true);
    expect(isBuiltInJavaScriptTypeScriptRuleConfigFile(".eslintrc.json")).toBe(true);
    expect(isBuiltInJavaScriptTypeScriptRuleConfigFile("biome.json")).toBe(false);
    expect(isBuiltInJavaScriptTypeScriptRuleConfigFile("biome.jsonc")).toBe(false);
  });

  it("evaluates built-in JS/TS rules for explicit any, unused imports, and unused variables", () => {
    const diagnostics = evaluateBuiltInJavaScriptTypeScriptCodeRules({
      relativePath: "src/demo.ts",
      sourceText: [
        'import { unusedThing } from "./unused";',
        "const value: any = 1;",
        "const neverRead = 2;",
        "export const demo = value;",
      ].join("\n"),
      rules: {
        maxFileLines: 500,
        maxFileLinesSeverity: "off",
        explicitAny: "warning",
        unusedImports: "error",
        unusedVariables: "error",
      },
    });

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "no-explicit-any", severity: "warning" }),
        expect.objectContaining({ code: "no-unused-imports", severity: "error" }),
        expect.objectContaining({ code: "no-unused-variables", severity: "error" }),
      ]),
    );
  });
});
