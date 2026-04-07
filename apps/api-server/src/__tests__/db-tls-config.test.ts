import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDbPoolConfig } from "@workspace/db";

test("production db pool config enforces certificate validation", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("production db pool config never permits rejectUnauthorized false", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "production",
  });

  assert.notDeepEqual(config.ssl, { rejectUnauthorized: false });
});

test("non-production db pool config behavior is explicit", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "test",
  });

  assert.equal(config.ssl, false);
});
