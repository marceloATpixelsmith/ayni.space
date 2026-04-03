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
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a" })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "m-1",
      userId: "user-non-super",
      orgId: "org-a",
      membershipStatus: "active",
      role: "staff",
    })),
  ];

  try {
    const context = await getAppContext("user-non-super", "admin");
    assert.ok(context);
    assert.equal(context?.canAccess, false);
    assert.equal(context?.requiredOnboarding, "none");
    assert.deepEqual(context?.authRoutePolicy, {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration: false,
    });
  } finally {
    teardown(restores);
  }
});

test("superadmin apps allow super-admin without org membership/app entitlement", async () => {
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
      id: "user-super",
      email: "admin@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: true,
      activeOrgId: null,
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.organizationsTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
  ];

  try {
    const context = await getAppContext("user-super", "admin");
    assert.ok(context);
    assert.equal(context?.canAccess, true);
    assert.equal(context?.requiredOnboarding, "none");
    assert.equal(context?.defaultRoute, "/dashboard");
  } finally {
    teardown(restores);
  }
});

test("solo apps auto-self-onboard and allow valid users without app entitlement", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-solo",
      slug: "shipibo",
      isActive: true,
      accessMode: "solo",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: true,
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
    patchProperty(db.query.organizationsTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
  ];

  try {
    const context = await getAppContext("user-solo", "shipibo");
    assert.ok(context);
    assert.equal(context?.normalizedAccessProfile, "solo");
    assert.equal(context?.requiredOnboarding, "none");
    assert.equal(context?.canAccess, true);
    assert.equal(context?.defaultRoute, "/shipibo");
    assert.deepEqual(context?.authRoutePolicy, {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration: false,
    });
  } finally {
    teardown(restores);
  }
});

test("organization mode requires organization onboarding for non-member user", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-org",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: false,
      customerRegistrationEnabled: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-org",
      email: "org@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: null,
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.organizationsTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
  ];

  try {
    const context = await getAppContext("user-org", "ayni");
    assert.ok(context);
    assert.equal(context?.normalizedAccessProfile, "organization");
    assert.equal(context?.requiredOnboarding, "organization");
    assert.equal(context?.canAccess, false);
    assert.deepEqual(context?.authRoutePolicy, {
      allowOnboarding: true,
      allowInvitations: false,
      allowCustomerRegistration: false,
    });
  } finally {
    teardown(restores);
  }
});

test("organization auth route policy enables invites but keeps customer-registration fail-closed until implemented", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-org",
      slug: "ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      customerRegistrationEnabled: true,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-org",
      email: "org@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: "org-a",
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-a", name: "Org A", slug: "org-a" })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "m-1",
      userId: "user-org",
      orgId: "org-a",
      membershipStatus: "active",
      role: "org_admin",
    })),
  ];

  try {
    const context = await getAppContext("user-org", "ayni");
    assert.ok(context);
    assert.deepEqual(context?.authRoutePolicy, {
      allowOnboarding: true,
      allowInvitations: true,
      allowCustomerRegistration: false,
    });
  } finally {
    teardown(restores);
  }
});
