import { test } from "node:test";
import assert from "node:assert/strict";

process.env["DATABASE_URL"] ??= "postgres://postgres:postgres@localhost:5432/ayni_test";

const { buildDbPoolConfig } = await import("@workspace/db");

test("production db pool config enforces certificate validation by default", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("production db pool config honors explicit sslmode=require with strict cert validation", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test?sslmode=require",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("production db pool config ignores sslmode=no-verify downgrade", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test?sslmode=no-verify",
    NODE_ENV: "production",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("non-production db pool config behavior is explicit", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "test",
  });

  assert.equal(config.ssl, false);
});

test("production db pool config keeps certificate validation enabled on Render runtime", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "production",
    RENDER: "true",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("production db pool config respects explicit verify-full on Render runtime", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test?sslmode=verify-full",
    NODE_ENV: "production",
    RENDER: "true",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});


test("ci db pool config enforces certificate validation", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test",
    NODE_ENV: "test",
    CI: "true",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});

test("non-production db pool config enables ssl when sslmode requires it", () => {
  const config = buildDbPoolConfig({
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/ayni_test?sslmode=require",
    NODE_ENV: "test",
  });

  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
});
