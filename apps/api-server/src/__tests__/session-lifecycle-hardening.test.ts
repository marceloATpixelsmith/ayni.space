import test from "node:test";
import assert from "node:assert/strict";

import { ensureTestDatabaseEnv, patchProperty, createSessionApp, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const sessionLib = await import("../lib/session.js");
const { db, pool } = await import("@workspace/db");
const { default: usersRouter } = await import("../routes/users.js");

test("revokeOtherSessionsForUser executes explicit platform.sessions query", async () => {
  let capturedSql = "";
  let capturedParams: unknown[] = [];

  const restore = patchProperty(pool, "query", async (sql: string, params: unknown[]) => {
    capturedSql = sql;
    capturedParams = params;
    return { rowCount: 1 } as never;
  });

  try {
    await sessionLib.revokeOtherSessionsForUser("user-123", "sid-abc", "admin");

    assert.equal(capturedSql, sessionLib.getDeleteOtherSessionsSql());
    assert.match(capturedSql, /^DELETE FROM platform\.sessions/);
    assert.deepEqual(capturedParams, ["user-123", "sid-abc", "admin"]);
  } finally {
    restore();
  }
});

test("requireAuth fail-closed path clears cookie when session user is missing from DB", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => null),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const app = createSessionApp(usersRouter, { userId: "missing-user" });
    const response = await performJsonRequest(app, "GET", "/api/me");

    assert.equal(response.status, 401);
    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${sessionLib.getSessionCookieName()}=;`, "i"));
    assert.match(setCookie, /HttpOnly/i);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
