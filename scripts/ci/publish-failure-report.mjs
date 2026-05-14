#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const sourceDir = process.argv[2];

if (!sourceDir)
  {
    console.error('Usage: node scripts/ci/publish-failure-report.mjs <ci-output-dir>');
    process.exit(1);
  }

const repository = process.env.GITHUB_REPOSITORY || '';
const workflow = process.env.GITHUB_WORKFLOW || 'unknown-workflow';
const job = process.env.GITHUB_JOB || 'unknown-job';
const runId = process.env.GITHUB_RUN_ID || 'unknown-run';
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';
const sha = process.env.GITHUB_SHA || 'unknown-sha';
const ref = process.env.GITHUB_REF || 'unknown-ref';
const actor = process.env.GITHUB_ACTOR || 'unknown-actor';

const reportsBranch = 'ci-failure-logs';
const safeWorkflow = workflow.replace(/[^A-Za-z0-9._-]+/g, '-');
const safeJob = job.replace(/[^A-Za-z0-9._-]+/g, '-');
const targetDir = path.join(
  'ci-failures',
  safeWorkflow,
  runId,
  `attempt-${runAttempt}`,
  safeJob,
);

const runGit = (args, options = {}) =>
  execFileSync('git', args, {
    stdio: 'inherit',
    ...options,
  });

const readGit = (args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();

if (!fs.existsSync(sourceDir))
  {
    console.error(`CI output directory does not exist: ${sourceDir}`);
    process.exit(1);
  }

const files = fs.readdirSync(sourceDir)
  .filter((fileName) =>
    fileName.endsWith('.summary.txt') ||
    fileName.endsWith('.metadata.txt') ||
    fileName.endsWith('.log')
  );

if (files.length === 0)
  {
    console.error(`No CI report files found in: ${sourceDir}`);
    process.exit(1);
  }

runGit(['config', 'user.name', 'github-actions[bot]']);
runGit(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);

runGit(['fetch', 'origin', '+refs/heads/*:refs/remotes/origin/*']);

const originalRef = readGit(['rev-parse', '--abbrev-ref', 'HEAD']);

try
  {
    const existingReportsBranch = readGit([
      'branch',
      '--list',
      '--remotes',
      `origin/${reportsBranch}`,
    ]);

    if (existingReportsBranch)
      {
        runGit(['checkout', '-B', reportsBranch, `origin/${reportsBranch}`]);
      }
    else
      {
        runGit(['checkout', '--orphan', reportsBranch]);
        runGit(['rm', '-rf', '.']);
      }

    fs.mkdirSync(targetDir, { recursive: true });

    for (const fileName of files)
      {
        fs.copyFileSync(
          path.join(sourceDir, fileName),
          path.join(targetDir, fileName),
        );
      }

    const indexPath = path.join(targetDir, 'README.md');
    const reportIndex = [
      '# CI Failure Report',
      '',
      `Workflow: ${workflow}`,
      `Job: ${job}`,
      `Run ID: ${runId}`,
      `Run attempt: ${runAttempt}`,
      `SHA: ${sha}`,
      `Ref: ${ref}`,
      `Actor: ${actor}`,
      `Repository: ${repository}`,
      '',
      'Files:',
      ...files.map((fileName) => `- ${fileName}`),
      '',
    ].join('\n');

    fs.writeFileSync(indexPath, reportIndex, 'utf8');

    runGit(['add', targetDir]);

    const hasChanges = readGit(['status', '--short']);

    if (!hasChanges)
      {
        console.log('No CI failure report changes to publish.');
        return;
      }

    runGit([
      'commit',
      '-m',
      `ci: publish failure report for ${safeWorkflow}/${safeJob} run ${runId}`,
    ]);

    runGit(['push', 'origin', reportsBranch]);
  }
finally
  {
    try
      {
        runGit(['checkout', originalRef]);
      }
    catch
      {
        // NOOP
      }
  }
