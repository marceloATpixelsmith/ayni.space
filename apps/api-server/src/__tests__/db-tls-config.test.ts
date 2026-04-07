import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDbPoolConfig } from "@workspace/db";

test("production db pool config enforces certificate validation by default", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("production db pool config honors explicit sslmode=require", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test?sslmode=require",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test("production db pool config honors explicit sslmode=no-verify", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test?sslmode=no-verify",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test("non-production db pool config behavior is explicit", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "test",
  });

  assert.equal(config.ssl, false);
});

test("production db pool config disables certificate validation on Render runtime", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "production",
    RENDER: "true",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
});

test("production db pool config respects explicit verify-full on Render runtime", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test?sslmode=verify-full",
    NODE_ENV: "production",
    RENDER: "true",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

