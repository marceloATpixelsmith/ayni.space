import test from "node:test";
import assert from "node:assert/strict";

import { getAuthRoutePolicyForProfile } from "../lib/appAccessProfile.js";

test("superadmin auth route policy disables registration, onboarding, and invitations", () => {
  const policy = getAuthRoutePolicyForProfile("superadmin", {
    staffInvitesEnabled: true,
    customerRegistrationEnabled: true,
  });

  assert.deepEqual(policy, {
    allowOnboarding: false,
    allowInvitations: false,
    allowCustomerRegistration: false,
  });
});

test("organization auth route policy enables registration, onboarding, and invitations", () => {
  const policy = getAuthRoutePolicyForProfile("organization", {
    staffInvitesEnabled: false,
    customerRegistrationEnabled: false,
  });

  assert.deepEqual(policy, {
    allowOnboarding: true,
    allowInvitations: true,
    allowCustomerRegistration: true,
  });
});

test("solo auth route policy enables registration and disables organization onboarding/invitations", () => {
  const policy = getAuthRoutePolicyForProfile("solo", {
    staffInvitesEnabled: true,
    customerRegistrationEnabled: true,
  });

  assert.deepEqual(policy, {
    allowOnboarding: false,
    allowInvitations: false,
    allowCustomerRegistration: true,
  });
});
