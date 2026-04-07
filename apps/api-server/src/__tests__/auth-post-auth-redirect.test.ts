import test from "node:test";
import assert from "node:assert/strict";

import { getPostAuthRedirectPath } from "../lib/postAuthRedirect.js";

test("superadmin profile denies non-super-admin callback destination", () => {
  const destination = getPostAuthRedirectPath({
    appSlug: "admin",
    isSuperAdmin: false,
    normalizedAccessProfile: "superadmin",
    requiredOnboarding: "none",
  });

  assert.equal(destination, "/login?error=access_denied");
});

test("organization profile routes post-auth users to onboarding when required", () => {
  const destination = getPostAuthRedirectPath({
    appSlug: "workspace",
    isSuperAdmin: false,
    normalizedAccessProfile: "organization",
    requiredOnboarding: "organization",
  });

  assert.equal(destination, "/onboarding/organization");
});

test("authorized callback destination remains dashboard when onboarding not required", () => {
  assert.equal(
    getPostAuthRedirectPath({
      appSlug: "admin",
      isSuperAdmin: true,
      normalizedAccessProfile: "superadmin",
      requiredOnboarding: "none",
    }),
    "/dashboard",
  );

  assert.equal(
    getPostAuthRedirectPath({
      appSlug: "workspace-solo",
      isSuperAdmin: false,
      normalizedAccessProfile: "solo",
      requiredOnboarding: "none",
    }),
    "/dashboard",
  );
});

test("user onboarding destination is explicit when required", () => {
  const destination = getPostAuthRedirectPath({
    appSlug: "workspace-solo",
    isSuperAdmin: false,
    normalizedAccessProfile: "solo",
    requiredOnboarding: "user",
  });

  assert.equal(destination, "/onboarding/user");
});

test("client/public registrant resolves to user onboarding", () => {
  const destination = getPostAuthRedirectPath({
    appSlug: "public-client",
    isSuperAdmin: false,
    normalizedAccessProfile: "organization",
    requiredOnboarding: "user",
  });

  assert.equal(destination, "/onboarding/user");
});

test("invited org member resolves to user onboarding after auth success", () => {
  const destination = getPostAuthRedirectPath({
    appSlug: "admin",
    isSuperAdmin: false,
    normalizedAccessProfile: "organization",
    requiredOnboarding: "user",
  });

  assert.equal(destination, "/onboarding/user");
});

test("organization profile onboarding redirect never includes /admin prefix", () => {
  const destination = getPostAuthRedirectPath({
    appSlug: "admin",
    isSuperAdmin: false,
    normalizedAccessProfile: "organization",
    requiredOnboarding: "organization",
  });

  assert.equal(destination, "/onboarding/organization");
  assert.equal(destination.includes("/admin/"), false);
});

test("default post-auth redirect remains dashboard when no onboarding is required", () => {
  const destination = getPostAuthRedirectPath({
    appSlug: "workspace",
    isSuperAdmin: false,
    normalizedAccessProfile: "organization",
    requiredOnboarding: "none",
  });

  assert.equal(destination, "/dashboard");
});
