import test from "node:test";
import assert from "node:assert/strict";

import { deriveAppAuthRoutePolicy } from "../index";

test("superadmin profile always fail-closes signup even if payload policy is permissive", () => {
  const policy = deriveAppAuthRoutePolicy({
    slug: "admin",
    normalizedAccessProfile: "superadmin",
    authRoutePolicy: {
      allowOnboarding: true,
      allowInvitations: true,
      allowCustomerRegistration: true,
    },
  });

  assert.deepEqual(policy, {
    allowOnboarding: false,
    allowInvitations: false,
    allowCustomerRegistration: false,
  });
});

test("solo profile always allows signup even if payload policy is fail-closed", () => {
  const policy = deriveAppAuthRoutePolicy({
    slug: "solo",
    normalizedAccessProfile: "solo",
    authRoutePolicy: {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration: false,
    },
  });

  assert.deepEqual(policy, {
    allowOnboarding: true,
    allowInvitations: false,
    allowCustomerRegistration: true,
  });
});

test("organization profile honors customer-registration toggle", () => {
  const enabledPolicy = deriveAppAuthRoutePolicy({
    slug: "org",
    normalizedAccessProfile: "organization",
    authRoutePolicy: {
      allowOnboarding: true,
      allowInvitations: true,
      allowCustomerRegistration: true,
    },
  });

  const disabledPolicy = deriveAppAuthRoutePolicy({
    slug: "org",
    normalizedAccessProfile: "organization",
    authRoutePolicy: {
      allowOnboarding: true,
      allowInvitations: false,
      allowCustomerRegistration: false,
    },
  });

  assert.equal(enabledPolicy.allowCustomerRegistration, true);
  assert.equal(disabledPolicy.allowCustomerRegistration, false);
});
