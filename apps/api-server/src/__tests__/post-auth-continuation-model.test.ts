import test from "node:test";
import assert from "node:assert/strict";

import { resolvePostAuthContinuation } from "../lib/postAuthContinuation.js";

test("continuation resolver maps invitation acceptance", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/invitations/token-1/accept",
  });

  assert.equal(continuation?.type, "invitation_acceptance");
  assert.equal(continuation?.resourceId, "token-1");
});

test("continuation resolver maps event registration", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/events/event-22/register",
  });

  assert.equal(continuation?.type, "event_registration");
  assert.equal(continuation?.resourceId, "event-22");
});

test("continuation resolver maps client/public registration", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/register/client",
  });

  assert.equal(continuation?.type, "client_registration");
});

test("continuation resolver falls back to default app entry", () => {
  const continuation = resolvePostAuthContinuation({
    appSlug: "admin",
    returnPath: "/dashboard/apps",
  });

  assert.equal(continuation?.type, "default_app_entry");
});
