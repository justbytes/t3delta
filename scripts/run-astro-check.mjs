#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import Path from "node:path";
import process from "node:process";

const repoRoot = Path.resolve(import.meta.dirname, "..");
const bunPackagesDir = Path.join(repoRoot, "node_modules", ".bun");

function compareVersionsDesc(a, b) {
  const normalize = (value) =>
    value
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(Number);
  const aParts = normalize(a);
  const bParts = normalize(b);
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const left = aParts[index] ?? 0;
    const right = bParts[index] ?? 0;
    if (left !== right) {
      return right - left;
    }
  }
  return 0;
}

function resolveAstroCliPath() {
  const packageDirs = readdirSync(bunPackagesDir)
    .filter((entry) => entry.startsWith("astro@"))
    .sort((left, right) =>
      compareVersionsDesc(left.slice("astro@".length), right.slice("astro@".length)),
    );

  for (const entry of packageDirs) {
    const candidate = Path.join(
      bunPackagesDir,
      entry,
      "node_modules",
      "astro",
      "dist",
      "cli",
      "index.js",
    );
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not locate Astro CLI under node_modules/.bun. Run bun install first.");
}

const astroCliPath = resolveAstroCliPath();
const astroArgs = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  [astroCliPath, ...(astroArgs.length > 0 ? astroArgs : ["check"])],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
