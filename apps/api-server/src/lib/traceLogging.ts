function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

export function isVerboseTraceLoggingEnabled(): boolean {
  const explicit = parseBooleanEnv(process.env["BACKEND_TRACE_VERBOSE"]);
  if (typeof explicit === "boolean") {
    return explicit;
  }

  return process.env["NODE_ENV"] === "test";
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
