import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveAppAuthRoutePolicy,
  deriveLoginPageVisibilityPolicy,
} from "../index";

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

test("login page visibility allows only Google for superadmin profile", () => {
  const visibility = deriveLoginPageVisibilityPolicy({
    slug: "admin",
    normalizedAccessProfile: "superadmin",
  });

  assert.deepEqual(visibility, {
    allowGoogleLogin: true,
    allowEmailLogin: false,
    allowForgotPassword: false,
    allowCreateAccount: false,
  });
});

test("login page visibility enables all auth affordances for organization profile", () => {
  const visibility = deriveLoginPageVisibilityPolicy({
    slug: "admin",
    normalizedAccessProfile: "organization",
  });

  assert.deepEqual(visibility, {
    allowGoogleLogin: true,
    allowEmailLogin: true,
    allowForgotPassword: true,
    allowCreateAccount: true,
  });
});

test("login page visibility enables all auth affordances for solo profile", () => {
  const visibility = deriveLoginPageVisibilityPolicy({
    slug: "solo",
    normalizedAccessProfile: "solo",
  });

  assert.deepEqual(visibility, {
    allowGoogleLogin: true,
    allowEmailLogin: true,
    allowForgotPassword: true,
    allowCreateAccount: true,
  });
});

test("login page visibility fail-closes when metadata is unavailable", () => {
  const visibility = deriveLoginPageVisibilityPolicy(null);

  assert.deepEqual(visibility, {
    allowGoogleLogin: false,
    allowEmailLogin: false,
    allowForgotPassword: false,
    allowCreateAccount: false,
  });
});
