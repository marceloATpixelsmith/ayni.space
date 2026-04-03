#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

if (args.length < 1) {
  console.error(
    "Usage: summarize-backend-test-failures.mjs <logPath> [outputPath] [--step-name <name>] [--command <cmd>] [--step-summary <path>]"
  );
  process.exit(2);
}

const positional = [];
let stepName = "backend gate step";
let command = "(command unavailable)";
let stepSummaryPath = "";

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--step-name") {
    stepName = args[i + 1] ?? stepName;
    i += 1;
    continue;
  }
  if (arg === "--command") {
    command = args[i + 1] ?? command;
    i += 1;
    continue;
  }
  if (arg === "--step-summary") {
    stepSummaryPath = args[i + 1] ?? "";
    i += 1;
    continue;
  }
  positional.push(arg);
}

const [logPathArg, outputPathArg] = positional;
if (!logPathArg) {
  console.error("Missing required argument: <logPath>");
  process.exit(2);
}

const logPath = path.resolve(logPathArg);
if (!fs.existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(2);
}

const raw = fs.readFileSync(logPath, "utf8");
const lines = raw.split(/\r?\n/);

function dedupe(items) {
  return [...new Set(items.filter(Boolean))];
}

function trimBlock(block, maxLines = 24) {
  return block.map((line) => line.trimEnd()).filter(Boolean).slice(0, maxLines);
}

function extractNodeSpecFailures(allLines) {
  const failures = [];
  const failingSectionIdx = allLines.findIndex((line) => line.trim() === "✖ failing tests:");
  if (failingSectionIdx === -1) {
    return failures;
  }

  let i = failingSectionIdx + 1;
  while (i < allLines.length) {
    const line = allLines[i]?.trim() ?? "";
    if (!line) {
      i += 1;
      continue;
    }

    if (line.startsWith("undefined") || line.includes("ERR_PNPM_RECURSIVE_")) {
      break;
    }

    let fileRef = null;
    if (/^test at /.test(line)) {
      fileRef = line.replace(/^test at\s+/, "").trim();
      i += 1;
    }

    const testLine = allLines[i]?.trim() ?? "";
    const testMatch = testLine.match(/^✖\s+(.+?)\s+\([^)]*\)$/);
    if (!testMatch) {
      i += 1;
      continue;
    }

    const testName = testMatch[1];
    i += 1;

    const block = [];
    while (i < allLines.length) {
      const current = allLines[i] ?? "";
      const trimmed = current.trim();
      if (!trimmed) {
        const next = (allLines[i + 1] ?? "").trim();
        if (next.startsWith("test at ") || next === "") {
          i += 1;
          break;
        }
        block.push(current);
        i += 1;
        continue;
      }

      if (trimmed.startsWith("test at ") || trimmed.startsWith("undefined") || trimmed.includes("ERR_PNPM_RECURSIVE_")) {
        break;
      }

      block.push(current);
      i += 1;
    }

    const normalizedBlock = trimBlock(block, 18);
    const keyError =
      normalizedBlock
        .map((entry) => entry.trim())
        .find((entry) =>
          /(AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|Error:|ERR_[A-Z_]+|ELIFECYCLE|failed with exit code)/.test(entry)
        ) ?? "(error line unavailable)";

    failures.push({
      parser: "node-spec",
      testName,
      fileRef,
      keyError,
      block: normalizedBlock,
    });
  }

  return failures;
}

function extractTapFailures(allLines) {
  const failures = [];
  for (let i = 0; i < allLines.length; i += 1) {
    const tapMatch = allLines[i]?.match(/^not ok\s+\d+\s+-\s+(.+)$/);
    if (!tapMatch) continue;

    const testName = tapMatch[1].trim();
    const nearby = trimBlock(allLines.slice(i, i + 26), 26);
    const keyError =
      nearby
        .map((line) => line.trim())
        .find((line) => /(AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|Error:|ERR_[A-Z_]+)/.test(line)) ??
      "(error line unavailable)";

    failures.push({
      parser: "tap",
      testName,
      fileRef: null,
      keyError,
      block: nearby,
    });
  }
  return failures;
}

function extractLifecycleFailures(allLines) {
  const patterns = [
    /ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL/,
    /ELIFECYCLE/,
    /failed with exit code/i,
    /Process completed with exit code/i,
  ];

  const indices = [];
  for (let i = 0; i < allLines.length; i += 1) {
    if (patterns.some((pattern) => pattern.test(allLines[i] ?? ""))) {
      indices.push(i);
    }
  }

  return indices.slice(-3).map((idx) => {
    const block = trimBlock(allLines.slice(Math.max(0, idx - 4), idx + 14), 18);
    return {
      parser: "lifecycle",
      testName: "pnpm lifecycle / exit-code failure",
      fileRef: null,
      keyError: allLines[idx].trim(),
      block,
    };
  });
}

function extractStackFailures(allLines) {
  const stackStarters = [];
  for (let i = 0; i < allLines.length; i += 1) {
    const line = (allLines[i] ?? "").trim();
    if (/^(AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|Error:|UnhandledPromiseRejection)/.test(line)) {
      stackStarters.push(i);
    }
  }

  return stackStarters.slice(-2).map((idx) => {
    const block = trimBlock(allLines.slice(idx, idx + 20), 20);
    return {
      parser: "stack-trace",
      testName: "runtime stack trace",
      fileRef: null,
      keyError: allLines[idx].trim(),
      block,
    };
  });
}

function extractNodeSummary(allLines) {
  const summaryPatterns = [/^ℹ\s+(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/, /^#\s+(tests|pass|fail)\b/i, /^Test Suites?:/i];
  return dedupe(
    allLines
      .map((line) => line.trim())
      .filter((line) => summaryPatterns.some((pattern) => pattern.test(line)))
      .slice(-10)
  );
}

function makeFallbackExcerpt(allLines, maxLines = 220) {
  const markerPatterns = [
    /\bnot ok\b/i,
    /(^|\s)FAIL(\s|:|$)/,
    /\bError:/,
    /\bAssertionError\b/,
    /\bERR_[A-Z_]+\b/,
    /Process completed with exit code/i,
    /failed with exit code/i,
  ];
  let start = -1;
  for (let i = allLines.length - 1; i >= 0; i -= 1) {
    if (markerPatterns.some((pattern) => pattern.test(allLines[i] ?? ""))) {
      start = i;
      break;
    }
  }

  let excerpt = [];
  let reason = "tail";
  if (start >= 0) {
    excerpt = allLines.slice(start);
    reason = `from marker line ${start + 1}`;
  } else {
    excerpt = allLines.slice(-maxLines);
  }

  const meaningful = excerpt.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
  if (meaningful.length > maxLines) {
    return {
      reason: `${reason}, truncated to last ${maxLines} meaningful lines`,
      lines: meaningful.slice(-maxLines),
    };
  }

  return { reason, lines: meaningful };
}

const nodeFailures = extractNodeSpecFailures(lines);
const tapFailures = nodeFailures.length === 0 ? extractTapFailures(lines) : [];
const lifecycleFailures = extractLifecycleFailures(lines);
const stackFailures = extractStackFailures(lines);

const structuredFailures = [...nodeFailures, ...tapFailures, ...lifecycleFailures, ...stackFailures];
const runSummary = extractNodeSummary(lines);
const fallback = makeFallbackExcerpt(lines);

let output = "";
output += `BACKEND GATE FAILURE SUMMARY — ${stepName}\n`;
output += "============================================================\n";
output += `log file: ${logPathArg}\n`;
output += `command: ${command}\n`;

if (structuredFailures.length > 0) {
  output += "\nstructured parse: success\n";
  output += "\nparsed failure highlights:\n";

  structuredFailures.slice(0, 8).forEach((failure, idx) => {
    output += `\n${idx + 1}. [${failure.parser}] ${failure.testName}\n`;
    output += `   file: ${failure.fileRef ?? "(not found in reporter output)"}\n`;
    output += `   key error: ${failure.keyError}\n`;
    output += "   block:\n";
    for (const line of failure.block) {
      output += `     ${line}\n`;
    }
  });
} else {
  output += "\nstructured parse: failed\n";
  output += "showing raw fallback excerpt below\n";
  output += `fallback selection: ${fallback.reason}\n`;
  output += `fallback lines: ${fallback.lines.length}\n`;
  output += "\nRAW FAILSAFE EXCERPT\n";
  output += "------------------------------\n";
  for (const line of fallback.lines) {
    output += `${line}\n`;
  }
}

if (runSummary.length > 0) {
  output += "\nfinal run summary lines:\n";
  runSummary.forEach((line) => {
    output += `${line}\n`;
  });
}

if (outputPathArg) {
  const outputPath = path.resolve(outputPathArg);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, "utf8");
}

if (stepSummaryPath) {
  const section = [
    `### Backend gate failure — ${stepName}`,
    "",
    `- Log file: \`${logPathArg}\``,
    `- Command: \`${command}\``,
    "",
    "```text",
    output.trimEnd(),
    "```",
    "",
  ].join("\n");
  fs.appendFileSync(stepSummaryPath, `${section}\n`, "utf8");
}

process.stdout.write(`${output}\n`);
process.exit(0);
