import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const sessionLib = await import("../lib/session.js");

test("session store config is pinned to platform.sessions and migration-managed provisioning", () => {
  const storeConfig = sessionLib.getSessionStoreConfig();

  assert.equal(storeConfig.schemaName, "platform");
  assert.equal(storeConfig.tableName, "sessions");
  assert.equal(storeConfig.createTableIfMissing, false);
});

test("logout-others query targets platform.sessions", () => {
  const usersSource = readFileSync(resolve(process.cwd(), "src/routes/users.ts"), "utf8");
  assert.match(usersSource, /DELETE FROM platform\.sessions/);
});

test("session SQL references do not rely on unqualified sessions table names", () => {
  const usersSource = readFileSync(resolve(process.cwd(), "src/routes/users.ts"), "utf8");
  assert.equal(usersSource.includes("DELETE FROM sessions"), false);
});
