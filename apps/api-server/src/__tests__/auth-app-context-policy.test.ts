import assert from "node:assert/strict";
import test from "node:test";

import { ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const {
  deriveAuthContextPolicy,
  resolveAppContextForAuth,
} = await import("../lib/authContextPolicy.js");

function buildReq(seed: Record<string, unknown> = {}) {
  return {
    body: {},
    query: {},
    session: {},
    ...seed,
  } as any;
}

test("resolveAppContextForAuth fails with app_slug_missing when no app context candidates are present", async () => {
  const prevOriginMap = process.env["APP_SLUG_BY_ORIGIN"];
  const prevGroupMap = process.env["SESSION_GROUP_APP_SLUGS"];
  delete process.env["APP_SLUG_BY_ORIGIN"];
  delete process.env["SESSION_GROUP_APP_SLUGS"];

  try {
    const result = await resolveAppContextForAuth({
      req: buildReq(),
      origin: "http://localhost:5173",
      sessionGroup: "default",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected failed app context resolution");
    assert.equal(result.reason, "app_slug_missing");
  } finally {
    if (prevOriginMap === undefined) delete process.env["APP_SLUG_BY_ORIGIN"];
    else process.env["APP_SLUG_BY_ORIGIN"] = prevOriginMap;
    if (prevGroupMap === undefined) delete process.env["SESSION_GROUP_APP_SLUGS"];
    else process.env["SESSION_GROUP_APP_SLUGS"] = prevGroupMap;
  }
});

test("resolveAppContextForAuth fails closed on conflicting origin and session-group defaults", async () => {
  const prevOriginMap = process.env["APP_SLUG_BY_ORIGIN"];
  const prevGroupMap = process.env["SESSION_GROUP_APP_SLUGS"];
  process.env["APP_SLUG_BY_ORIGIN"] = "http://localhost:5173=ayni";
  process.env["SESSION_GROUP_APP_SLUGS"] = "default=shipibo";

  try {
    const result = await resolveAppContextForAuth({
      req: buildReq(),
      origin: "http://localhost:5173",
      sessionGroup: "default",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected failed app context resolution");
    assert.equal(result.reason, "app_context_ambiguous");
  } finally {
    if (prevOriginMap === undefined) delete process.env["APP_SLUG_BY_ORIGIN"];
    else process.env["APP_SLUG_BY_ORIGIN"] = prevOriginMap;
    if (prevGroupMap === undefined) delete process.env["SESSION_GROUP_APP_SLUGS"];
    else process.env["SESSION_GROUP_APP_SLUGS"] = prevGroupMap;
  }
});

test("resolveAppContextForAuth fails closed when explicit body appSlug has no canonical app row", async () => {
  const result = await resolveAppContextForAuth({
    req: buildReq({ body: { appSlug: "admin" } }),
    sessionGroup: "default",
    origin: "http://localhost:5173",
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("Expected failed app context resolution");
  assert.equal(result.reason, "app_not_found");
});

test("deriveAuthContextPolicy sets admin privileges only from canonical superadmin access mode", () => {
  const adminPolicy = deriveAuthContextPolicy({
    slug: "admin",
    accessMode: "superadmin",
    metadata: { sessionGroup: "admin" },
  } as any);
  assert.ok(adminPolicy);
  assert.equal(adminPolicy?.applyAdminPrivileges, true);
  assert.equal(adminPolicy?.sessionGroup, "admin");
  assert.equal(adminPolicy?.accessMode, "superadmin");

  const orgPolicy = deriveAuthContextPolicy({
    slug: "admin",
    accessMode: "organization",
    metadata: { sessionGroup: "admin" },
  } as any);
  assert.ok(orgPolicy);
  assert.equal(orgPolicy?.applyAdminPrivileges, false);
  assert.equal(orgPolicy?.accessMode, "organization");
});
