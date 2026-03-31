import test from "node:test";
import assert from "node:assert/strict";

import { getPostAuthRedirectPath } from "../lib/postAuthRedirect.js";

test("superadmin profile denies non-super-admin callback destination", () => {
  const destination = getPostAuthRedirectPath({
    isSuperAdmin: false,
    normalizedAccessProfile: "superadmin",
    requiredOnboarding: "none",
  });

  assert.equal(destination, "/login?error=access_denied");
});

test("organization profile routes post-auth users to onboarding when required", () => {
  const destination = getPostAuthRedirectPath({
    isSuperAdmin: false,
    normalizedAccessProfile: "organization",
    requiredOnboarding: "organization",
  });

  assert.equal(destination, "/onboarding");
});

test("authorized callback destination remains dashboard when onboarding not required", () => {
  assert.equal(getPostAuthRedirectPath({
    isSuperAdmin: true,
    normalizedAccessProfile: "superadmin",
    requiredOnboarding: "none",
  }), "/dashboard");

  assert.equal(getPostAuthRedirectPath({
    isSuperAdmin: false,
    normalizedAccessProfile: "solo",
    requiredOnboarding: "none",
  }), "/dashboard");
});
