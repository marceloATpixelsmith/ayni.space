import test from "node:test";
import assert from "node:assert/strict";

import { db } from "@workspace/db";
import { resolvePostAuthFlowDecision } from "../lib/postAuthFlow.js";
import { patchProperty } from "./helpers.js";

test("organization profile returns onboarding destination when app context requires organization onboarding", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-org",
      slug: "workspace",
      accessMode: "organization",
      isActive: true,
      staffInvitesEnabled: true,
      customerRegistrationEnabled: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "member@example.com",
      isSuperAdmin: false,
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: null,
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => []),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
  ];

  try {
    const flow = await resolvePostAuthFlowDecision({
      userId: "user-1",
      appSlug: "workspace",
      isSuperAdmin: false,
      normalizedAccessProfile: "organization",
    });
    assert.ok(flow);
    assert.equal(flow.requiredOnboarding, "organization");
    assert.equal(flow.destination, "/onboarding/organization");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});

test("superadmin profile denies non-superadmin through shared destination resolver", async () => {
  const flow = await resolvePostAuthFlowDecision({
    userId: "user-2",
    appSlug: "admin",
    isSuperAdmin: false,
    normalizedAccessProfile: "superadmin",
  });

  assert.ok(flow);
  assert.equal(flow.canAccess, false);
  assert.equal(flow.destination, "/login?error=access_denied");
});

test("solo profile resolves user onboarding destination when profile is incomplete", async () => {
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-solo",
      slug: "workspace-solo",
      accessMode: "solo",
      isActive: true,
      staffInvitesEnabled: false,
      customerRegistrationEnabled: false,
    })),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-3",
      email: "solo@example.com",
      name: null,
      isSuperAdmin: false,
      active: true,
      suspended: false,
      deletedAt: null,
      activeOrgId: null,
    })),
    patchProperty(db.query.userAppAccessTable, "findFirst", async () => null),
  ];

  try {
    const flow = await resolvePostAuthFlowDecision({
      userId: "user-3",
      appSlug: "workspace-solo",
      isSuperAdmin: false,
      normalizedAccessProfile: "solo",
    });
    assert.ok(flow);
    assert.equal(flow.requiredOnboarding, "user");
    assert.equal(flow.destination, "/onboarding/user");
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
