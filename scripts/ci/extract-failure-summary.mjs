#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/ci/extract-failure-summary.mjs <log-file>');
  process.exit(1);
}

const raw = fs.readFileSync(filePath, 'utf8');
const lines = raw.split(/\r?\n/);

const redact = (text) => text
  .replace(/(DATABASE_URL|SESSION_SECRET|GOOGLE_CLIENT_SECRET)\s*[=:]\s*[^\s"']+/gi, '$1=[REDACTED_SECRET]')
  .replace(/(authorization\s*[:=]\s*)(bearer\s+[^\s"']+)/gi, '$1[REDACTED_SECRET]')
  .replace(/(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED_SECRET]')
  .replace(/(cookie\s*[:=]\s*)[^\n]+/gi, '$1[REDACTED_SECRET]')
  .replace(/(api[_-]?key\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED_SECRET]')
  .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, '$1[REDACTED_SECRET]')
  .replace(/(mongodb(?:\+srv)?:\/\/)[^\s"']+/gi, '$1[REDACTED_SECRET]')
  .replace(/([A-Za-z_]*(?:secret|token|password)[A-Za-z_]*\s*[=:]\s*)[^\s"']+/gi, '$1[REDACTED_SECRET]');

const text = redact(raw);
const safeLines = text.split(/\r?\n/);

const normalizeField = (value) => String(value ?? 'N/A').split(/\r?\n/)[0].trim() || 'N/A';

const firstMatch = (regexes) => {
  for (const rx of regexes) {
    const m = text.match(rx);
    if (m) return normalizeField(m[1] || m[0]);
  }
  return 'N/A';
};

const workflow = process.env.GITHUB_WORKFLOW || 'N/A';
const job = process.env.GITHUB_JOB || 'N/A';
const command = firstMatch([/Failing command:\s*(.+)/i]);
const exitCode = firstMatch([/Exit code:\s*(\d+)/i]);
const failingTest = firstMatch([
  /✖\s+(.+)/,
  /×\s+(.+)/,
  /FAIL\s+(.+)/,
  /failing test:?\s*(.+)/i,
]);

const failureType = firstMatch([
  /(AssertionError[\s\S]{0,140})/,
  /(ERR_PNPM_[A-Z_]+)/,
  /(TS\d{4}:[^\n]+)/,
  /(Type error:[^\n]+)/,
  /(Error:[^\n]+)/,
]);

const actual = firstMatch([
  /Actual:\s*(.+)/i,
  /actual\s*[:=]\s*(.+)/i,
  /\+\s+actual\s+-\s+expected[\s\S]*?\n\+\s*(.+)/i,
]);
const expected = firstMatch([
  /Expected:\s*(.+)/i,
  /expected\s*[:=]\s*(.+)/i,
  /\+\s+actual\s+-\s+expected[\s\S]*?\n-\s*(.+)/i,
]);

const fileLine = firstMatch([
  /(apps\/[\w\-/\.]+:\d+:\d+)/,
  /(lib\/[\w\-/\.]+:\d+:\d+)/,
  /(scripts\/[\w\-/\.]+:\d+:\d+)/,
  /((?:[A-Za-z]:)?[^\s:]+\.(?:ts|tsx|js|mjs|cjs|yml):\d+:\d+)/,
]);

const likelyArea = fileLine !== 'N/A' ? fileLine.split(':')[0] : firstMatch([
  /(apps\/api-server\/src\/[\w\-/\.]+)/,
  /(lib\/[\w\-/\.]+)/,
  /(scripts\/ci\/[\w\-/\.]+)/,
]);

const relevance = /(AssertionError|ERR_PNPM|\bTS\d{4}\b|Type error|Error:|✖|×|FAIL|failed|Exit code|at\s+.+:\d+:\d+)/i;
const relevantLines = safeLines.filter((line) => relevance.test(line));
const excerptLines = (relevantLines.length ? relevantLines : safeLines).slice(-80);

const out = [
  '==================================================',
  'CI FAILURE SUMMARY',
  '==================================================',
  `Workflow: ${workflow}`,
  `Job: ${job}`,
  `Command: ${command}`,
  `Failure type: ${failureType}`,
  `Failing test: ${failingTest}`,
  `Actual: ${actual}`,
  `Expected: ${expected}`,
  `File/line: ${fileLine}`,
  `Likely source area: ${likelyArea}`,
  `Exit code: ${exitCode}`,
  'Relevant log excerpt:',
  excerptLines.join('\n'),
  '==================================================',
].join('\n');

console.log(out);
