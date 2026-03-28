import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

import { ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const sessionLib = await import("../lib/session.js");

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

test("session store config is pinned to platform.sessions and migration-managed provisioning", () => {
  const storeConfig = sessionLib.getSessionStoreConfig();

  assert.equal(storeConfig.schemaName, "platform");
  assert.equal(storeConfig.tableName, "sessions");
  assert.equal(storeConfig.createTableIfMissing, false);
});

test("logout-others query targets platform.sessions via shared helper", () => {
  assert.match(sessionLib.getDeleteOtherSessionsSql(), /DELETE FROM platform\.sessions/);
});

test("session lifecycle uses shared destroy helper instead of ad hoc req.session.destroy", () => {
  const runtimeFiles = collectFiles(resolve(process.cwd(), "src")).filter((file) =>
    file.includes("/routes/") || file.includes("/middlewares/") || file.includes("/lib/")
  );

  for (const file of runtimeFiles) {
    const source = readFileSync(file, "utf8");

    if (file.endsWith("/lib/session.ts")) {
      continue;
    }

    assert.equal(source.includes("req.session.destroy("), false, `Found req.session.destroy in ${file}`);
  }
});

test("runtime-critical source has no stale public.sessions assumptions", () => {
  const runtimeFiles = collectFiles(resolve(process.cwd(), "src")).filter((file) =>
    file.includes("/routes/") || file.includes("/middlewares/") || file.includes("/lib/")
  );

  for (const file of runtimeFiles) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("public.sessions"), false, `Found stale public.sessions in ${file}`);
  }
});
