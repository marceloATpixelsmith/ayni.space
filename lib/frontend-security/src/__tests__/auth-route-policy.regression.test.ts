import test from "node:test";
import assert from "node:assert/strict";

import { deriveAppAuthRoutePolicy } from "../index";

test("superadmin profile always fail-closes signup even if payload policy is permissive", () => {
  const policy = deriveAppAuthRoutePolicy({
    slug: "admin",
    normalizedAccessProfile: "superadmin",
    authRoutePolicy: {
      allowOnboarding: false,
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

test("solo profile enforces fixed signup/onboarding policy even if payload policy differs", () => {
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
    allowOnboarding: false,
    allowInvitations: false,
    allowCustomerRegistration: true,
  });
});

test("organization profile enforces fixed policy independent of payload toggles", () => {
  const enabledPolicy = deriveAppAuthRoutePolicy({
    slug: "org",
    normalizedAccessProfile: "organization",
    authRoutePolicy: {
      allowOnboarding: false,
      allowInvitations: true,
      allowCustomerRegistration: true,
    },
  });

  const disabledPolicy = deriveAppAuthRoutePolicy({
    slug: "org",
    normalizedAccessProfile: "organization",
    authRoutePolicy: {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration: false,
    },
  });

  assert.deepEqual(enabledPolicy, {
    allowOnboarding: true,
    allowInvitations: true,
    allowCustomerRegistration: true,
  });
  assert.deepEqual(disabledPolicy, {
    allowOnboarding: true,
    allowInvitations: true,
    allowCustomerRegistration: true,
  });
});
