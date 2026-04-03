const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|token|secret|password)/i;

export function sanitizeSnapshot<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSnapshot(item)) as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        out[key] = "[REDACTED]";
      } else if (key === "contentBase64") {
        out[key] = "[BASE64_REDACTED]";
      } else {
        out[key] = sanitizeSnapshot(child);
      }
    }
    return out as T;
  }
  return value;
}
