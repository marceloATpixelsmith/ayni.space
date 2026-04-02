function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function isNodeTestRuntime(): boolean {
  if (process.env["NODE_ENV"] === "test") return true;

  if (process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test="))) {
    return true;
  }

  if (process.argv.some((arg) => arg === "--test" || arg.startsWith("--test="))) {
    return true;
  }

  if (process.argv.some((arg) => arg.includes("__tests__") || arg.endsWith(".test.ts") || arg.endsWith(".test.js"))) {
    return true;
  }

  return false;
}

export function isVerboseTraceLoggingEnabled(): boolean {
  const explicit = parseBooleanEnv(process.env["BACKEND_TRACE_VERBOSE"]);
  if (typeof explicit === "boolean") {
    return explicit;
  }

  return isNodeTestRuntime();
}

export function logVerboseTrace(...args: unknown[]) {
  if (!isVerboseTraceLoggingEnabled()) return;
  console.log(...args);
}

export function infoVerboseTrace(...args: unknown[]) {
  if (!isVerboseTraceLoggingEnabled()) return;
  console.info(...args);
}

export function warnVerboseTrace(...args: unknown[]) {
  if (!isVerboseTraceLoggingEnabled()) return;
  console.warn(...args);
}
