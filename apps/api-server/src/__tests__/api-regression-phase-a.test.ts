import test from "node:test";
import assert from "node:assert/strict";
import { createMountedSessionApp, performJsonRequest, patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();
process.env["NODE_ENV"] = "development";
process.env["TURNSTILE_ENABLED"] = "false";

const { db } = await import("@workspace/db");
const { default: authRouter } = await import("../routes/auth.js");
const { default: usersRouter } = await import("../routes/users.js");
const { default: organizationsRouter } = await import("../routes/organizations.js");
const { default: invitationsRouter } = await import("../routes/invitations.js");
const { default: adminRouter } = await import("../routes/admin.js");
const { default: shipiboRouter } = await import("../routes/shipibo.js");
const { default: ayniRouter } = await import("../routes/ayni.js");
const { createSecurityEnforcementMiddleware } = await import("../lib/securityPolicy.js");

function user(id: string, extras: Record<string, unknown> = {}) {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    avatarUrl: null,
    isSuperAdmin: false,
    activeOrgId: "org-a",
    active: true,
    suspended: false,
    deletedAt: null,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    ...extras,
  };
}

function selectCountMock(countValue = 1) {
  const rows = [{ count: countValue }];
  return () => ({
    from: () => {
      const chain = {
        where: async () => rows,
        innerJoin: () => ({ where: async () => [] }),
        then: (resolve: (value: typeof rows) => unknown) => Promise.resolve(resolve(rows)),
      };
      return chain as unknown;
    },
  });
}


function insertMock(rows: unknown[] = []) {
  return () => ({
    values: () => {
      const promise = Promise.resolve(rows);
      return {
        returning: async () => rows,
        then: promise.then.bind(promise),
        catch: promise.catch.bind(promise),
      };
    },
  });
}

function teardown(restores: Array<() => void>) {
  restores.reverse().forEach((restore) => restore());
}

test("A: auth/session protections and logout flow", async () => {
  let destroyed = false;
  const priorSessionCookieDomain = process.env["SESSION_COOKIE_DOMAIN"];
  process.env["SESSION_COOKIE_DOMAIN"] = "admin.test.local";
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user("user-auth")),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a" })),
    patchProperty(db, "select", selectCountMock()),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
    patchProperty(db, "insert", insertMock()),
  ];

  try {
    const loggedIn = createMountedSessionApp(
      [
        { path: "/api/auth", router: authRouter },
        { path: "/api/users", router: usersRouter },
      ],
      {
        userId: "user-auth",
        destroy: (cb) => {
          destroyed = true;
          cb?.();
        },
      },
    );

    const unauth = await performJsonRequest(createMountedSessionApp([{ path: "/api/users", router: usersRouter }], {}), "GET", "/api/users/me");
    assert.equal(unauth.status, 401);

    const me = await performJsonRequest(loggedIn, "GET", "/api/auth/me");
    assert.equal(me.status, 200);

    const logout = await performJsonRequest(loggedIn, "POST", "/api/auth/logout");
    assert.equal(logout.status, 200);
    assert.equal(destroyed, true);
    const clearedCookies = logout.headers.get("set-cookie") ?? "";
    assert.match(clearedCookies, /saas\.sid=;/);
    assert.match(clearedCookies, /Domain=admin\.test\.local/i);
    assert.match(clearedCookies, /Path=\//i);

    const after = await performJsonRequest(createMountedSessionApp([{ path: "/api/users", router: usersRouter }], {}), "GET", "/api/users/me");
    assert.equal(after.status, 401);
  } finally {
    if (priorSessionCookieDomain === undefined) {
      delete process.env["SESSION_COOKIE_DOMAIN"];
    } else {
      process.env["SESSION_COOKIE_DOMAIN"] = priorSessionCookieDomain;
    }
    teardown(restores);
  }
});

test("B: user profile and org switching paths", async () => {
  let allowed = false;
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user("user-profile")),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () =>
      allowed
        ? { id: "m-1", userId: "user-profile", orgId: "22222222-2222-4222-8222-222222222222", membershipStatus: "active", role: "staff" }
        : null,
    ),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: () => ({ returning: async () => [user("user-profile", { name: "Updated Name" })] }),
      }),
    } as never)),
    patchProperty(db, "insert", insertMock()),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/users", router: usersRouter }], {
      userId: "user-profile",
      regenerate: (cb) => cb?.(),
      save: (cb) => cb?.(),
    });

    assert.equal((await performJsonRequest(app, "GET", "/api/users/me")).status, 200);
    assert.equal((await performJsonRequest(app, "PATCH", "/api/users/me", { name: "Updated Name" })).status, 200);
    assert.equal((await performJsonRequest(app, "PATCH", "/api/users/me", { name: "x" })).status, 400);

    allowed = true;
    assert.equal((await performJsonRequest(app, "POST", "/api/users/me/switch-org", { orgId: "22222222-2222-4222-8222-222222222222" })).status, 200);

    allowed = false;
    assert.equal((await performJsonRequest(app, "POST", "/api/users/me/switch-org", { orgId: "33333333-3333-4333-8333-333333333333" })).status, 403);
  } finally {
    teardown(restores);
  }
});

test("C: organizations visibility, validation, and role-gated update", async () => {
  let role: "org_admin" | "staff" | null = "org_admin";
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user("user-orgs")),
    patchProperty(db.query.organizationsTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () =>
      role ? { id: "m-role", userId: "user-orgs", orgId: "org-a", membershipStatus: "active", role } : null,
    ),
    patchProperty(db, "select", () => ({
      from: () => ({
        innerJoin: () => ({ where: async () => [{ id: "org-a", name: "Org A", slug: "org-a" }] }),
        where: async () => [{ count: 2 }],
      }),
    } as never)),
    patchProperty(db, "insert", insertMock([{ id: "org-new", name: "New Org", slug: "new-org" }]) as never),
    patchProperty(db, "update", () => ({
      set: () => ({ where: () => ({ returning: async () => [{ id: "org-a", name: "Renamed", slug: "org-a" }] }) }),
    } as never)),
  ];

  try {
    const app = createMountedSessionApp([{ path: "/api/organizations", router: organizationsRouter }], { userId: "user-orgs" });
    assert.equal((await performJsonRequest(app, "GET", "/api/organizations/")).status, 200);
    assert.equal((await performJsonRequest(app, "POST", "/api/organizations/", { name: "New Org", slug: "new-org" })).status, 201);
    assert.equal((await performJsonRequest(app, "POST", "/api/organizations/", { name: "n", slug: "BAD" })).status, 400);
    role = null;
    assert.equal((await performJsonRequest(app, "GET", "/api/organizations/org-b")).status, 403);

    role = "org_admin";
    assert.equal((await performJsonRequest(app, "PATCH", "/api/organizations/org-a", { name: "Renamed" })).status, 200);

    role = "staff";
    assert.equal((await performJsonRequest(app, "PATCH", "/api/organizations/org-a", { name: "Nope" })).status, 403);

    role = null;
    assert.equal((await performJsonRequest(app, "PATCH", "/api/organizations/org-a", { name: "Nope" })).status, 403);
  } finally {
    teardown(restores);
  }
});

test("D: members and invitations role/org checks and invitation acceptance states", async () => {
  let role: "org_admin" | "staff" | null = "org_admin";
  let inviteState: "pending" | "expired" | "accepted" | "missing" = "pending";
  let invitationCreateMode = false;
  let membershipCallCount = 0;

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user("user-inv", { email: "member@example.com" })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a" })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () =>
      role
        ? (() => {
            if (invitationCreateMode) {
              membershipCallCount += 1;
              if (membershipCallCount % 2 === 0) return null;
            }
            return { id: "m-1", userId: "user-inv", orgId: "org-a", membershipStatus: "active", role };
          })()
        : null,
    ),
    patchProperty(db.query.invitationsTable, "findFirst", async () => {
      if (inviteState === "missing") return null;
      if (inviteState === "expired") return { id: "inv-1", email: "member@example.com", orgId: "org-a", invitedRole: "staff", invitationStatus: "pending", expiresAt: new Date(Date.now() - 60000) };
      if (inviteState === "accepted") return { id: "inv-1", email: "member@example.com", orgId: "org-a", invitedRole: "staff", invitationStatus: "accepted", expiresAt: new Date(Date.now() + 60000) };
      return { id: "inv-1", email: "member@example.com", orgId: "org-a", invitedRole: "staff", invitationStatus: "pending", expiresAt: new Date(Date.now() + 60000) };
    }),
    patchProperty(db, "select", () => ({
      from: () => ({
        innerJoin: () => ({ where: async () => [{ userId: "member-1", orgId: "org-a", role: "staff", email: "m@example.com", name: "M", avatarUrl: null, joinedAt: new Date() }] }),
      }),
    } as never)),
    patchProperty(db, "insert", insertMock([{ id: "inv-created", email: "invitee@example.com", invitedRole: "staff", orgId: "org-a", invitationStatus: "pending", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) }]) as never),
    patchProperty(db, "update", () => ({ set: () => ({ where: () => ({ returning: async () => [{ userId: "member-1", orgId: "org-a", role: "org_admin", createdAt: new Date() }] }) }) } as never)),
    patchProperty(db, "delete", () => ({ where: async () => undefined } as never)),
  ];

  try {
    const orgApp = createMountedSessionApp([{ path: "/api/organizations", router: organizationsRouter }], { userId: "user-inv" });
    const inviteApp = createMountedSessionApp([{ path: "/api", router: invitationsRouter }], { userId: "user-inv" });

    assert.equal((await performJsonRequest(orgApp, "GET", "/api/organizations/org-a/members")).status, 200);
    role = null;
    assert.equal((await performJsonRequest(orgApp, "GET", "/api/organizations/org-a/members")).status, 403);

    role = "org_admin";
    assert.equal((await performJsonRequest(orgApp, "PATCH", "/api/organizations/org-a/members/member-1", { role: "org_admin" })).status, 200);
    role = "staff";
    assert.equal((await performJsonRequest(orgApp, "PATCH", "/api/organizations/org-a/members/member-1", { role: "org_admin" })).status, 403);

    role = "org_admin";
    invitationCreateMode = true;
    membershipCallCount = 0;
    assert.equal((await performJsonRequest(inviteApp, "POST", "/api/organizations/org-a/invitations", { email: "invitee@example.com", role: "staff" })).status, 201);
    invitationCreateMode = false;
    assert.equal((await performJsonRequest(inviteApp, "POST", "/api/organizations/org-a/invitations", { email: "bad", role: "x" })).status, 400);
    role = "staff";
    assert.equal((await performJsonRequest(inviteApp, "POST", "/api/organizations/org-a/invitations", { email: "invitee@example.com", role: "staff" })).status, 403);
    role = null;
    assert.equal((await performJsonRequest(inviteApp, "POST", "/api/organizations/org-a/invitations", { email: "invitee@example.com", role: "staff" })).status, 403);

    role = "org_admin";
    inviteState = "pending";
    assert.equal((await performJsonRequest(inviteApp, "POST", "/api/invitations/token/accept", {})).status, 200);
    inviteState = "expired";
    assert.equal((await performJsonRequest(inviteApp, "POST", "/api/invitations/token/accept", {})).status, 410);
    inviteState = "accepted";
    assert.equal((await performJsonRequest(inviteApp, "POST", "/api/invitations/token/accept", {})).status, 409);
    inviteState = "missing";
    assert.equal((await performJsonRequest(inviteApp, "POST", "/api/invitations/token/accept", {})).status, 404);
  } finally {
    teardown(restores);
  }
});

test("E: super admin endpoints are super-admin only (no app/subscription dependency)", async () => {
  let isSuper = false;
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user("admin-user", { isSuperAdmin: isSuper })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => {
      throw new Error("requireSuperAdmin should not query userAppAccessTable");
    }),
    patchProperty(db, "select", selectCountMock()),
    patchProperty(db.query.organizationsTable, "findMany", async () => []),
    patchProperty(db.query.usersTable, "findMany", async () => []),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
    patchProperty(db, "insert", insertMock()),
  ];

  try {
    const app = createMountedSessionApp([], { userId: "admin-user" });
    app.use(createSecurityEnforcementMiddleware());
    app.use("/api/admin", adminRouter);

    assert.equal((await performJsonRequest(app, "GET", "/api/admin/stats")).status, 403);

    isSuper = true;
    assert.equal((await performJsonRequest(app, "GET", "/api/admin/stats")).status, 200);
    assert.equal((await performJsonRequest(app, "GET", "/api/admin/organizations")).status, 200);
    assert.equal((await performJsonRequest(app, "GET", "/api/admin/users")).status, 200);
  } finally {
    teardown(restores);
  }
});

test("Optional: starter tenant/app access checks for ayni + shipibo", async () => {
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => user("apps-user")),
    patchProperty(db.query.appsTable, "findFirst", async () => ({ id: "app-1", slug: "ayni", isActive: true, accessMode: "restricted", tenancyMode: "organization", onboardingMode: "enabled" })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a" })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db, "update", () => ({ set: () => ({ where: async () => undefined }) } as never)),
  ];

  try {
    const ayniApp = createMountedSessionApp([{ path: "/api/ayni", router: ayniRouter }], { userId: "apps-user" });
    const shipiboApp = createMountedSessionApp([{ path: "/api/shipibo", router: shipiboRouter }], { userId: "apps-user" });
    assert.equal((await performJsonRequest(ayniApp, "GET", "/api/ayni/ceremonies?orgId=org-b")).status, 403);
    assert.equal((await performJsonRequest(shipiboApp, "POST", "/api/shipibo/words", { word: "a", translation: "b" })).status, 403);
  } finally {
    teardown(restores);
  }
});
