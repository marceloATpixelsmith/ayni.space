import fs from 'node:fs';
import { pendingTrackedChecks, selectLatestTrackedRuns } from './pr-checks-summary-targeting.mjs';

const args = parseArgs(process.argv.slice(2));
const payload = JSON.parse(fs.readFileSync(args.input, 'utf8'));
const allowlist = fs
  .readFileSync(args.allowlistFile, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const trackedNames = args.trackedFile
  ? fs
      .readFileSync(args.trackedFile, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  : null;

const tracked = selectLatestTrackedRuns({
  checkRuns: payload.check_runs || [],
  allowlist,
  summaryCheckName: args.summaryCheck,
  headSha: args.headSha,
  trackedNames,
});

const pending = pendingTrackedChecks(tracked);

process.stdout.write(
  JSON.stringify(
    {
      tracked,
      pending,
      complete: pending.length === 0,
    },
    null,
    2,
  ),
);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key.startsWith('--')) continue;
    out[key.slice(2)] = value;
    i += 1;
  }

  const required = ['input', 'allowlistFile', 'summaryCheck', 'headSha'];
  for (const key of required) {
    if (!out[key]) {
      throw new Error(`Missing required argument --${key}`);
    }
  }

  return out;
}
