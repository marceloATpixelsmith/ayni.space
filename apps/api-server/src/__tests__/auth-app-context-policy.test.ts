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

test("deriveAuthContextPolicy marks admin metadata as explicit admin policy", () => {
  const policy = deriveAuthContextPolicy({
    slug: "admin",
    accessMode: "superadmin",
    metadata: { sessionGroup: "admin" },
  } as any);
  assert.ok(policy);
  assert.equal(policy?.applyAdminPrivileges, true);
  assert.equal(policy?.sessionGroup, "admin");
  assert.equal(policy?.accessMode, "superadmin");
});
