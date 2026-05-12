import test from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";

const EXPECTED_AUTH_REGRESSION_TESTS = [
  "auth-entry-regression-guards.test.ts",
  "auth-session-group-hardening.test.ts",
  "post-auth-routing-regression.test.ts",
];

test(
  "auth security regression suite contains all required auth regression test files",
  async () =>
  {
    const testsDirectory = path.resolve(
      process.cwd(),
      "src/__tests__",
    );

    const files = await readdir(
      testsDirectory,
    );

    for (const expectedFile of EXPECTED_AUTH_REGRESSION_TESTS)
    {
      assert.equal(
        files.includes(expectedFile),
        true,
        `Missing required auth regression file: ${expectedFile}`,
      );
    }
  },
);
