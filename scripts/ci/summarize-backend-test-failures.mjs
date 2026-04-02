#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [, , logPathArg, outputPathArg] = process.argv;

if (!logPathArg) {
  console.error("Usage: summarize-backend-test-failures.mjs <logPath> [outputPath]");
  process.exit(2);
}

const logPath = path.resolve(logPathArg);
if (!fs.existsSync(logPath)) {
  console.error(`Log file not found: ${logPath}`);
  process.exit(2);
}

const raw = fs.readFileSync(logPath, "utf8");
const lines = raw.split(/\r?\n/);

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

    const normalizedBlock = block.map((entry) => entry.trimEnd());
    const keyError = normalizedBlock
      .map((entry) => entry.trim())
      .find((entry) => /(AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|Error:|ERR_[A-Z_]+)/.test(entry)) ?? "(error line unavailable)";

    const stackLine = normalizedBlock
      .map((entry) => entry.trim())
      .find((entry) => /^at\s+/.test(entry)) ?? null;

    failures.push({
      testName,
      fileRef,
      keyError,
      stackLine,
      block: normalizedBlock.filter(Boolean).slice(0, 16),
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
    const nearby = allLines.slice(i, i + 20).map((line) => line.trimEnd());
    const keyError = nearby
      .map((line) => line.trim())
      .find((line) => /(AssertionError|TypeError|ReferenceError|SyntaxError|RangeError|Error:|ERR_[A-Z_]+)/.test(line)) ?? "(error line unavailable)";

    const stackLine = nearby
      .map((line) => line.trim())
      .find((line) => /^at\s+/.test(line)) ?? null;

    failures.push({
      testName,
      fileRef: null,
      keyError,
      stackLine,
      block: nearby.filter(Boolean).slice(0, 16),
    });
  }
  return failures;
}

function extractNodeSummary(allLines) {
  const summaryKeys = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo", "duration_ms"];
  const summaryLines = allLines
    .map((line) => line.trim())
    .filter((line) => line.startsWith("ℹ "))
    .filter((line) => summaryKeys.some((key) => line.startsWith(`ℹ ${key} `)));

  const uniqueSummary = [];
  for (const line of summaryLines) {
    if (!uniqueSummary.includes(line)) uniqueSummary.push(line);
  }
  return uniqueSummary;
}

const nodeFailures = extractNodeSpecFailures(lines);
const tapFailures = nodeFailures.length > 0 ? [] : extractTapFailures(lines);
const failures = nodeFailures.length > 0 ? nodeFailures : tapFailures;
const finalSummary = extractNodeSummary(lines);

let output = "";
if (failures.length > 0) {
  output += "BACKEND TEST FAILURE SUMMARY\n";
  output += "========================================\n";

  failures.forEach((failure, idx) => {
    output += `\n${idx + 1}. failing test: ${failure.testName}\n`;
    output += `   file: ${failure.fileRef ?? "(not found in reporter output)"}\n`;
    output += `   key error: ${failure.keyError}\n`;
    if (failure.stackLine) {
      output += `   stack: ${failure.stackLine}\n`;
    }
    output += "   failure block:\n";
    for (const line of failure.block) {
      output += `     ${line}\n`;
    }
  });
} else {
  output += "BACKEND TEST FAILURE SUMMARY\n";
  output += "========================================\n";
  output += "No explicit failing test block was parsed from this log.\n";
}

if (finalSummary.length > 0) {
  output += "\nFINAL TEST RUN SUMMARY\n";
  output += "========================================\n";
  for (const line of finalSummary) {
    output += `${line}\n`;
  }
}

if (outputPathArg) {
  const outputPath = path.resolve(outputPathArg);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, output, "utf8");
}

process.stdout.write(`${output}\n`);
process.exit(0);
