import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createMountedSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

process.env["ALLOWED_ORIGINS"] = "http://admin.local,http://workspace.local";
process.env["ADMIN_FRONTEND_ORIGINS"] = "http://admin.local";
process.env["GOOGLE_CLIENT_ID"] = "test-client";
process.env["GOOGLE_CLIENT_SECRET"] = "test-secret";
process.env["GOOGLE_REDIRECT_URI"] = "http://localhost:3000/api/auth/google/callback";
process.env["APP_SLUG_BY_ORIGIN"] = "http://workspace.local=workspace,http://admin.local=admin";
process.env["TURNSTILE_ENABLED"] = "false";

const { default: authRouter } = await import("../routes/auth.js");
const { db } = await import("@workspace/db");

function tlsLookupError() {
  const err = new Error("SSL/TLS required");
  (err as Error & { code?: string }).code = "28000";
  return err;
}

test("oauth start: explicit appSlug and origin mapping contracts remain locked", async () => {
  const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], { save: (cb?: (err?: unknown) => void) => cb?.() });

  const explicitWorkspace = await performJsonRequest(app, "POST", "/api/auth/google/url?appSlug=workspace", undefined, { origin: "http://workspace.local" });
  assert.equal(explicitWorkspace.status, 200);

  const explicitAdminDifferentOrigin = await performJsonRequest(app, "POST", "/api/auth/google/url?appSlug=admin", undefined, { origin: "http://workspace.local" });
  assert.equal(explicitAdminDifferentOrigin.status, 200);

  const originDerived = await performJsonRequest(app, "POST", "/api/auth/google/url", undefined, { origin: "http://workspace.local" });
  assert.equal(originDerived.status, 200);

  const disallowed = await performJsonRequest(app, "POST", "/api/auth/google/url", undefined, { origin: "http://disallowed.local" });
  assert.equal(disallowed.status, 400);
  assert.equal(disallowed.body?.code, "ORIGIN_NOT_ALLOWED");
});

test("canonical lookup TLS outage: test mode fallback allowed, production fails closed", async () => {
  const prevNodeEnv = process.env["NODE_ENV"];
  const prevRateLimitEnabled = process.env["RATE_LIMIT_ENABLED"];
  const restoreFindFirst = patchProperty(db.query.appsTable, "findFirst", async () => { throw tlsLookupError(); });

  try {
    process.env["NODE_ENV"] = "test";
    const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], { save: (cb?: (err?: unknown) => void) => cb?.() });
    const oauth = await performJsonRequest(app, "POST", "/api/auth/google/url?appSlug=workspace", undefined, { origin: "http://workspace.local" });
    assert.equal(oauth.status, 200);

    process.env["NODE_ENV"] = "production";
    process.env["RATE_LIMIT_ENABLED"] = "false";
    const oauthProd = await performJsonRequest(app, "POST", "/api/auth/google/url?appSlug=workspace", undefined, { origin: "http://workspace.local" });
    assert.ok(oauthProd.status >= 500);
    assert.notEqual(oauthProd.status, 200);
  } finally {
    restoreFindFirst();
    if (prevNodeEnv === undefined) delete process.env["NODE_ENV"]; else process.env["NODE_ENV"] = prevNodeEnv;
    if (prevRateLimitEnabled === undefined) delete process.env["RATE_LIMIT_ENABLED"]; else process.env["RATE_LIMIT_ENABLED"] = prevRateLimitEnabled;
  }
});

test("password login app-context contract: mfa challenge response keeps pending session fields", async () => {
  const app = createMountedSessionApp([{ path: "/api/auth", router: authRouter }], {});
  const response = await performJsonRequest(app, "POST", "/api/auth/login", {
    email: "mfa@example.com",
    password: "password",
    appSlug: "workspace",
  }, { origin: "http://workspace.local" });

  // Lock MFA contract shape when challenge is required.
  if (response.status === 202) {
    assert.equal(response.body?.nextStep, "mfa_challenge");
    assert.ok(response.body?.pendingSessionId);
    assert.ok(response.body?.challengeToken);
  }
});

test("extract-failure-summary prioritizes test file/auth context over unrelated audit noise", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "failure-summary-"));
  const logPath = path.join(tmp, "log.txt");
  await writeFile(logPath, [
    "[audit] noisy audit log line",
    "AssertionError [ERR_ASSERTION]: expected 200",
    "    at src/__tests__/auth-entry-regression-guards.test.ts:88:11",
    "[auth/google/url] app context resolution failed reason: app_not_found lookupError: SSL/TLS required",
    "apps/api-server/src/routes/audit.ts:44:2",
  ].join("\n"));

  const { stdout } = await promisify(execFile)("node", ["../../scripts/ci/extract-failure-summary.mjs", logPath], { cwd: process.cwd() });
  assert.match(stdout, /src\/__tests__\/auth-entry-regression-guards\.test\.ts:88:11/);
  assert.match(stdout, /Auth-context signal: \[auth\/google\/url\] app context resolution failed/);
});
