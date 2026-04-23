import assert from "node:assert/strict";
import test from "node:test";

import { ensureTestDatabaseEnv, patchProperty } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
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

test("resolveAppContextForAuth fails closed when explicit appSlug conflicts with trusted origin-derived appSlug", async () => {
  const prevOriginMap = process.env["APP_SLUG_BY_ORIGIN"];
  const prevGroupMap = process.env["SESSION_GROUP_APP_SLUGS"];
  process.env["APP_SLUG_BY_ORIGIN"] = "http://localhost:5173=ayni";

  try {
    const result = await resolveAppContextForAuth({
      req: buildReq({ body: { appSlug: "shipibo" } }),
      origin: "http://localhost:5173",
      sessionGroup: "default",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected failed app context resolution");
    assert.equal(result.reason, "app_context_unavailable");
  } finally {
    if (prevOriginMap === undefined) delete process.env["APP_SLUG_BY_ORIGIN"];
    else process.env["APP_SLUG_BY_ORIGIN"] = prevOriginMap;
    if (prevGroupMap === undefined) delete process.env["SESSION_GROUP_APP_SLUGS"];
    else process.env["SESSION_GROUP_APP_SLUGS"] = prevGroupMap;
  }
});

test("resolveAppContextForAuth fails closed when trusted-origin and canonical-origin app slugs conflict", async () => {
  const prevOriginMap = process.env["APP_SLUG_BY_ORIGIN"];
  process.env["APP_SLUG_BY_ORIGIN"] = "http://localhost:5173=ayni";
  const restoreFindFirst = patchProperty(db.query.appsTable, "findFirst", async (query?: unknown) => {
    if (query && typeof query === "object" && "columns" in (query as Record<string, unknown>)) {
      return { slug: "shipibo" };
    }
    return null;
  });
  try {
    const result = await resolveAppContextForAuth({
      req: buildReq(),
      origin: "http://localhost:5173",
      sessionGroup: "default",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected failed app context resolution");
    assert.equal(result.reason, "app_context_unavailable");
  } finally {
    restoreFindFirst();
    if (prevOriginMap === undefined) delete process.env["APP_SLUG_BY_ORIGIN"];
    else process.env["APP_SLUG_BY_ORIGIN"] = prevOriginMap;
  }
});

test("resolveAppContextForAuth fails closed when explicit body appSlug has no canonical app row", async () => {
  const restoreFindFirst = patchProperty(db.query.appsTable, "findFirst", async () => null);
  const restoreSelect = patchProperty(db, "select", () => ({
    from: () => ({
      innerJoin: () => ({
        where: async () => [],
      }),
    }),
  }) as never);
  try {
    const result = await resolveAppContextForAuth({
      req: buildReq({ body: { appSlug: "admin" } }),
      sessionGroup: "default",
      origin: "http://localhost:5173",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected failed app context resolution");
    assert.equal(result.reason, "app_not_found");
  } finally {
    restoreSelect();
    restoreFindFirst();
  }
});

test("resolveAppContextForAuth maps canonical lookup exception from request source to app_context_unavailable", async () => {
  const restoreFindFirst = patchProperty(db.query.appsTable, "findFirst", async () => {
    throw new Error("boom");
  });
  try {
    const result = await resolveAppContextForAuth({
      req: buildReq({ body: { appSlug: "admin" } }),
      origin: "http://localhost:5173",
      sessionGroup: "default",
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected failed app context resolution");
    assert.equal(result.reason, "app_context_unavailable");
  } finally {
    restoreFindFirst();
  }
});

test("resolveAppContextForAuth maps canonical lookup exception from session_group source to app_not_found", async () => {
  const prevGroupMap = process.env["SESSION_GROUP_APP_SLUGS"];
  process.env["SESSION_GROUP_APP_SLUGS"] = "default=workspace";
  const restoreFindFirst = patchProperty(db.query.appsTable, "findFirst", async () => {
    throw new Error("boom");
  });
  try {
    const result = await resolveAppContextForAuth({
      req: buildReq(),
      sessionGroup: "default",
      origin: null,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected failed app context resolution");
    assert.equal(result.reason, "app_not_found");
  } finally {
    restoreFindFirst();
    if (prevGroupMap === undefined) delete process.env["SESSION_GROUP_APP_SLUGS"];
    else process.env["SESSION_GROUP_APP_SLUGS"] = prevGroupMap;
  }
});

test("resolveAppContextForAuth resolves canonical app through VITE_APP_SLUG mapping", async () => {
  const restoreSelect = patchProperty(db, "select", () => ({
    from: () => ({
      innerJoin: () => ({
        where: async () => ([
          {
            app: {
              id: "app-1",
              slug: "ayni",
              accessMode: "organization",
              metadata: {},
              isActive: true,
            },
          },
        ]),
      }),
    }),
  }) as never);

  const restoreFindFirst = patchProperty(db.query.appsTable, "findFirst", async () => null);
  try {
    const result = await resolveAppContextForAuth({
      req: buildReq({ body: { appSlug: "workspace" } }),
      origin: "http://workspace.local",
      sessionGroup: "default",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Expected app context resolution to succeed");
    assert.ok(result.app, "Expected canonical app to be resolved");
    assert.equal(result.resolvedAppSlug, "workspace");
    assert.equal(result.app.slug, "ayni");
  } finally {
    restoreFindFirst();
    restoreSelect();
  }
});

test("resolveAppContextForAuth accepts trusted origin-derived app slug without explicit body appSlug", async () => {
  const restoreFindFirst = patchProperty(db.query.appsTable, "findFirst", async () => ({
    id: "app-admin",
    slug: "admin",
    accessMode: "superadmin",
    metadata: { sessionGroup: "admin" },
    isActive: true,
    domain: "admin.local",
  }));
  try {
    const result = await resolveAppContextForAuth({
      req: buildReq(),
      origin: "http://admin.local",
      sessionGroup: "admin",
    });
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Expected app context resolution to succeed");
    assert.equal(result.resolvedAppSlug, "admin");
    assert.equal(result.source, "origin");
  } finally {
    restoreFindFirst();
  }
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
