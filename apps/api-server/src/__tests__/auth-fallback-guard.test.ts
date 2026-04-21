import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");

const scopedRoots = [
  path.resolve(repoRoot, "apps/api-server/src/routes"),
  path.resolve(repoRoot, "lib/frontend-security/src"),
  path.resolve(repoRoot, "apps/admin/src/pages/auth"),
] as const;

const sourceFilePattern = /\.(ts|tsx|js|mjs)$/;
const bannedFallbackPatterns: Array<{ regex: RegExp; message: string }> = [
  { regex: /fallbackPath\s*:\s*["'`]\/dashboard["'`]/g, message: "fallbackPath must not hardcode /dashboard." },
  { regex: /defaultPath\s*:\s*["'`]\/dashboard["'`]/g, message: "defaultPath must not hardcode /dashboard." },
  { regex: /nextPath\s*\?\?\s*["'`]\/dashboard["'`]/g, message: "nextPath fallback must not hardcode /dashboard." },
  { regex: /setLocation\(\s*["'`]\/dashboard(?:\/[^"'`]*)?["'`]\s*\)/g, message: "Auth route code must not navigate to /dashboard as a fallback shortcut." },
  { regex: /window\.location\.(?:assign|replace)\(\s*["'`]\/dashboard(?:\/[^"'`]*)?["'`]\s*\)/g, message: "Auth route code must not use /dashboard fallback redirects." },
];

function collectSourceFiles(rootDir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (sourceFilePattern.test(entry.name) && !entry.name.includes(".test.")) {
      files.push(fullPath);
    }
  }
  return files;
}

test("global fallback guard blocks /dashboard fallback shortcuts in auth routing surfaces", () => {
  const scopedFiles = scopedRoots.flatMap(collectSourceFiles);
  const violations: string[] = [];

  for (const filePath of scopedFiles) {
    const relativePath = path.relative(repoRoot, filePath);
    const source = readFileSync(filePath, "utf8");
    for (const pattern of bannedFallbackPatterns) {
      if (pattern.regex.test(source)) {
        violations.push(`${relativePath}: ${pattern.message}`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Fallback guard found forbidden shortcuts:\n${violations.join("\n")}`,
  );
});
