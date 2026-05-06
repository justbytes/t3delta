import { describe, expect, it } from "vitest";
import {
  evaluateGenericCodeRules,
  evaluateJavaScriptCodeRules,
  evaluateTypeScriptCodeRules,
  isBuiltInJavaScriptTypeScriptRuleConfigFile,
} from "./projectCodeRules.js";

describe("projectCodeRules", () => {
  describe("isBuiltInJavaScriptTypeScriptRuleConfigFile", () => {
    it("recognizes ESLint config files", () => {
      expect(isBuiltInJavaScriptTypeScriptRuleConfigFile("eslint.config.js")).toBe(true);
      expect(isBuiltInJavaScriptTypeScriptRuleConfigFile(".eslintrc.json")).toBe(true);
      expect(isBuiltInJavaScriptTypeScriptRuleConfigFile("biome.json")).toBe(false);
      expect(isBuiltInJavaScriptTypeScriptRuleConfigFile("biome.jsonc")).toBe(false);
    });
  });

  describe("JavaScript rules", () => {
    it("detects unused variables and unused imports in .js files", () => {
      const diagnostics = evaluateJavaScriptCodeRules({
        relativePath: "test.js",
        sourceText: [
          "import { unused } from 'mod';",
          "const x = 1;",
          "const y = 2;",
          "console.log(y);",
        ].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "warning",
          unusedVariables: "warning",
          noConsole: "off",
        },
      });
      expect(diagnostics.length).toBeGreaterThanOrEqual(2);
      expect(diagnostics.some((d) => d.code === "no-unused-imports")).toBe(true);
      expect(diagnostics.some((d) => d.code === "no-unused-variables")).toBe(true);
    });

    it("detects console statements when noConsole is enabled", () => {
      const diagnostics = evaluateJavaScriptCodeRules({
        relativePath: "test.js",
        sourceText: ["const x = 1;", "console.log(x);"].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "off",
          unusedVariables: "off",
          noConsole: "warning",
        },
      });
      expect(diagnostics.some((d) => d.code === "no-console")).toBe(true);
    });

    it("skips .ts files", () => {
      const diagnostics = evaluateJavaScriptCodeRules({
        relativePath: "test.ts",
        sourceText: "const x = 1;",
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "warning",
          unusedVariables: "warning",
          noConsole: "off",
        },
      });
      expect(diagnostics).toHaveLength(0);
    });
  });

  describe("TypeScript rules", () => {
    it("detects explicit any, unused imports, and unused variables in .ts files", () => {
      const diagnostics = evaluateTypeScriptCodeRules({
        relativePath: "test.ts",
        sourceText: [
          "import { unused } from 'mod';",
          "const x: any = 1;",
          "const y = 2;",
          "console.log(y);",
        ].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          explicitAny: "warning",
          unusedImports: "warning",
          unusedVariables: "warning",
          noConsole: "off",
        },
      });
      expect(diagnostics.length).toBeGreaterThanOrEqual(3);
      expect(diagnostics.some((d) => d.code === "no-explicit-any")).toBe(true);
      expect(diagnostics.some((d) => d.code === "no-unused-imports")).toBe(true);
      expect(diagnostics.some((d) => d.code === "no-unused-variables")).toBe(true);
    });

    it("detects console statements when noConsole is enabled", () => {
      const diagnostics = evaluateTypeScriptCodeRules({
        relativePath: "test.ts",
        sourceText: ["const x = 1;", "console.warn(x);"].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          explicitAny: "off",
          unusedImports: "off",
          unusedVariables: "off",
          noConsole: "warning",
        },
      });
      expect(diagnostics.some((d) => d.code === "no-console")).toBe(true);
    });

    it("skips .js files", () => {
      const diagnostics = evaluateTypeScriptCodeRules({
        relativePath: "test.js",
        sourceText: "const x: any = 1;",
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          explicitAny: "warning",
          unusedImports: "off",
          unusedVariables: "off",
          noConsole: "off",
        },
      });
      expect(diagnostics).toHaveLength(0);
    });
  });

  describe("Rust rules", () => {
    it("detects unused variables and unused imports in .rs files", () => {
      const diagnostics = evaluateGenericCodeRules({
        relativePath: "test.rs",
        sourceText: [
          "use std::collections::HashMap;",
          "let x = 5;",
          "let y = 10;",
          'println!("{}", y);',
        ].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "warning",
          unusedVariables: "warning",
          unwrapUsage: "off",
        },
        language: "rust",
      });
      expect(diagnostics.some((d) => d.code === "no-unused-imports")).toBe(true);
      expect(diagnostics.some((d) => d.code === "no-unused-variables")).toBe(true);
    });

    it("detects unwrap/expect when unwrapUsage is enabled", () => {
      const diagnostics = evaluateGenericCodeRules({
        relativePath: "test.rs",
        sourceText: [
          "let result = some_operation();",
          "let value = result.unwrap();",
          'let other = result.expect("must succeed");',
        ].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "off",
          unusedVariables: "off",
          unwrapUsage: "warning",
        },
        language: "rust",
      });
      expect(diagnostics.filter((d) => d.code === "no-unwrap").length).toBe(2);
    });
  });

  describe("Python rules", () => {
    it("detects unused variables and unused imports in .py files", () => {
      const diagnostics = evaluateGenericCodeRules({
        relativePath: "test.py",
        sourceText: ["import os", "x = 1", "y = 2", "print(y)"].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "warning",
          unusedVariables: "warning",
          bareExcept: "off",
        },
        language: "python",
      });
      expect(diagnostics.some((d) => d.code === "no-unused-imports")).toBe(true);
      expect(diagnostics.some((d) => d.code === "no-unused-variables")).toBe(true);
    });

    it("detects bare except when bareExcept is enabled", () => {
      const diagnostics = evaluateGenericCodeRules({
        relativePath: "test.py",
        sourceText: ["try:", "    x = 1", "except:", "    pass"].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "off",
          unusedVariables: "off",
          bareExcept: "warning",
        },
        language: "python",
      });
      expect(diagnostics.some((d) => d.code === "no-bare-except")).toBe(true);
    });
  });

  describe("Solidity rules", () => {
    it("detects unused variables and unused imports in .sol files", () => {
      const diagnostics = evaluateGenericCodeRules({
        relativePath: "test.sol",
        sourceText: [
          'import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";',
          "uint256 x = 1;",
          "uint256 y = 2;",
          "function foo() public { return y; }",
        ].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "warning",
          unusedVariables: "warning",
          txOriginUsage: "off",
        },
        language: "solidity",
      });
      expect(diagnostics.some((d) => d.code === "no-unused-imports")).toBe(true);
      expect(diagnostics.some((d) => d.code === "no-unused-variables")).toBe(true);
    });

    it("detects tx.origin when txOriginUsage is enabled", () => {
      const diagnostics = evaluateGenericCodeRules({
        relativePath: "test.sol",
        sourceText: ["function foo() public {", "  require(tx.origin == owner);", "}"].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "off",
          unusedVariables: "off",
          txOriginUsage: "warning",
        },
        language: "solidity",
      });
      expect(diagnostics.some((d) => d.code === "no-tx-origin")).toBe(true);
    });
  });

  describe("C# rules", () => {
    it("detects unused variables and unused imports in .cs files", () => {
      const diagnostics = evaluateGenericCodeRules({
        relativePath: "test.cs",
        sourceText: [
          "using System.Collections.Generic;",
          "var x = 1;",
          "var y = 2;",
          "Console.WriteLine(y);",
        ].join("\n"),
        rules: {
          maxFileLines: 500,
          maxFileLinesSeverity: "off",
          unusedImports: "warning",
          unusedVariables: "warning",
        },
        language: "csharp",
      });
      expect(diagnostics.some((d) => d.code === "no-unused-imports")).toBe(true);
      expect(diagnostics.some((d) => d.code === "no-unused-variables")).toBe(true);
    });
  });
});
