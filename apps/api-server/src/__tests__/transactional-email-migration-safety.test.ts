import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(TEST_DIR, "../../../../lib/db/migrations/20260403_lane2_webhook_correlation_status.sql");

test("correlation_status migration is additive and non-destructive", async () => {
  const sql = await readFile(MIGRATION_PATH, "utf8");
  assert.match(sql, /create type email_webhook_correlation_status/i);
  assert.match(sql, /add column correlation_status/i);
  assert.match(sql, /default 'linked'/i);
  assert.match(sql, /create index email_webhook_events_correlation_status_idx/i);

  assert.doesNotMatch(sql, /\bdrop\s+table\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+column\b/i);
  assert.doesNotMatch(sql, /\btruncate\b/i);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
});
