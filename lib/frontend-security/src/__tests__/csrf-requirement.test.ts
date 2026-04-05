import test from "node:test";
import assert from "node:assert/strict";
import { requireCsrfToken } from "../index.tsx";

test("requireCsrfToken returns existing token without refresh", async () => {
  let refreshed = false;
  const token = await requireCsrfToken("existing-token", async () => {
    refreshed = true;
    return "new-token";
  }, "missing");

  assert.equal(token, "existing-token");
  assert.equal(refreshed, false);
});

test("requireCsrfToken refreshes when current token is missing", async () => {
  const token = await requireCsrfToken(null, async () => "refreshed-token", "missing");
  assert.equal(token, "refreshed-token");
});

test("requireCsrfToken throws with custom message when refresh fails", async () => {
  await assert.rejects(
    () => requireCsrfToken(null, async () => null, "Security token is not ready."),
    /Security token is not ready\./,
  );
});
