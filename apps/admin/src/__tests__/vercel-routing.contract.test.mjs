import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vercelConfigPath = path.resolve(__dirname, "../../vercel.json");

test("vercel rewrites all routes to SPA index", () => {
  const vercelConfig = JSON.parse(fs.readFileSync(vercelConfigPath, "utf8"));
  assert.ok(Array.isArray(vercelConfig.rewrites));
  assert.deepEqual(vercelConfig.rewrites, [
    { source: "/(.*)", destination: "/index.html" },
  ]);
});
