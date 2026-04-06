import test from "node:test";
import assert from "node:assert/strict";

import { validatePasswordConfirmationInput, validatePasswordInput } from "../pages/auth/authValidation";

test("confirm password validation requires a value", () => {
  assert.equal(validatePasswordConfirmationInput("Password1!", ""), "Confirm password is required.");
});

test("confirm password validation rejects mismatch", () => {
  assert.equal(validatePasswordConfirmationInput("Password1!", "Password2!"), "Passwords do not match.");
});

test("matching passwords satisfy confirmation and existing password rules still apply", () => {
  assert.equal(validatePasswordConfirmationInput("Password1!", "Password1!"), null);
  assert.equal(validatePasswordInput("Password1!"), null);
});

