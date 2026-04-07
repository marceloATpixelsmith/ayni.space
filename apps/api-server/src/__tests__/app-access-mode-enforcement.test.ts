import test from "node:test";
import assert from "node:assert/strict";

import { patchProperty, ensureTestDatabaseEnv } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { getAppContext } = await import("../lib/appAccess.js");

function teardown(restores: Array<() => void>) {
  restores.reverse().forEach((restore) => restore());
}

test("superadmin apps require super-admin even when app entitlement exists", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-admin",
      slug: "admin",
      isActive: true,
      accessMode: "superadmin",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: true,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-non-super",
      email: "member@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => ({
      id: "uaa-1",
      userId: "user-non-super",
      appId: "app-admin",
      accessStatus: "active",
    })),
  ];

  try {
    const context = await getAppContext("user-non-super", "admin");
    assert.ok(context);
    assert.equal(context?.canAccess, false);
    assert.equal(context?.requiredOnboarding, "none");
  } finally {
    teardown(restores);
  }
});

test("solo apps remain directly accessible for valid users", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-solo",
      slug: "shipibo",
      isActive: true,
      accessMode: "solo",
      staffInvitesEnabled: false,
      customerRegistrationEnabled: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-solo",
      email: "solo@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: null,
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
  ];

  try {
    const context = await getAppContext("user-solo", "shipibo");
    assert.ok(context);
    assert.equal(context?.normalizedAccessProfile, "solo");
    assert.equal(context?.canAccess, true);
  } finally {
    teardown(restores);
  }
});

test("organization mode allows active membership + org_app_access without user_app_access", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-org",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: false,
      metadata: {},
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-org-member",
      email: "member@example.com",
      name: "Member",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => ([
      {
        id: "m-member",
        userId: "user-org-member",
        orgId: "org-a",
        membershipStatus: "active",
        role: "staff",
      },
    ])),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a", isActive: true })),
    patchProperty(db.query.orgAppAccessTable, "findFirst", async () => ({ id: "oa-1", orgId: "org-a", appId: "app-org", enabled: true })),
  ];

  try {
    const context = await getAppContext("user-org-member", "ayni");
    assert.ok(context);
    assert.equal(context?.canAccess, true);
    assert.equal(context?.requiredOnboarding, "none");
  } finally {
    teardown(restores);
  }
});

test("organization mode denies when membership exists but org_app_access is missing", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-org",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-org-member",
      email: "member@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => ([
      {
        id: "m-member",
        userId: "user-org-member",
        orgId: "org-a",
        membershipStatus: "active",
        role: "staff",
      },
    ])),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a", isActive: true })),
    patchProperty(db.query.orgAppAccessTable, "findFirst", async () => null),
  ];

  try {
    const context = await getAppContext("user-org-member", "ayni");
    assert.ok(context);
    assert.equal(context?.canAccess, false);
    assert.equal(context?.requiredOnboarding, "organization");
  } finally {
    teardown(restores);
  }
});

test("organization mode denies when org_app_access exists but membership is missing", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-org",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-org-member",
      email: "member@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => []),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
  ];

  try {
    const context = await getAppContext("user-org-member", "ayni");
    assert.ok(context);
    assert.equal(context?.canAccess, false);
    assert.equal(context?.requiredOnboarding, "organization");
  } finally {
    teardown(restores);
  }
});

test("same org membership can authorize the same user to multiple apps via org_app_access", async () => {
  let appLookupCount = 0;
  let orgAppAccessLookupCount = 0;
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => {
      appLookupCount += 1;
      if (appLookupCount === 2) {
        return { id: "app-shipibo", slug: "shipibo", isActive: true, accessMode: "organization", staffInvitesEnabled: true, customerRegistrationEnabled: false };
      }
      return { id: "app-ayni", slug: "ayni", isActive: true, accessMode: "organization", staffInvitesEnabled: true, customerRegistrationEnabled: false };
    }),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-org-member",
      email: "member@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => ([
      { id: "m-member", userId: "user-org-member", orgId: "org-a", membershipStatus: "active", role: "staff" },
    ])),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a", isActive: true })),
    patchProperty(db.query.orgAppAccessTable, "findFirst", async () => {
      orgAppAccessLookupCount += 1;
      if (orgAppAccessLookupCount === 1) return { id: "oa-ayni", orgId: "org-a", appId: "app-ayni", enabled: true };
      return { id: "oa-shipibo", orgId: "org-a", appId: "app-shipibo", enabled: true };
    }),
  ];

  try {
    const ayniContext = await getAppContext("user-org-member", "ayni");
    const shipiboContext = await getAppContext("user-org-member", "shipibo");
    assert.equal(ayniContext?.canAccess, true);
    assert.equal(shipiboContext?.canAccess, true);
  } finally {
    teardown(restores);
  }
});
