import test from "node:test";
import assert from "node:assert/strict";

import { getPostAuthRedirectPath } from "../lib/postAuthRedirect.js";

test("non-super-admin OAuth callback destination is login with access-denied error", () => {
  const destination = getPostAuthRedirectPath(false);

  assert.equal(destination, "/login?error=access_denied");
  assert.notEqual(destination, "/unauthorized");
  assert.notEqual(destination, "/app");
});

test("super admin OAuth callback destination remains dashboard", () => {
  assert.equal(getPostAuthRedirectPath(true), "/dashboard");
});
