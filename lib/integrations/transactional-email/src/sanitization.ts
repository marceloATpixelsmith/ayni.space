const SECRET_KEY_PATTERN = /(authorization|api[-_]?key|token|secret|password)/i;
const MAX_STRING_LENGTH = 2048;
const MAX_ARRAY_ITEMS = 50;

function trimString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED_${value.length - MAX_STRING_LENGTH}]`;
}

export function sanitizeSnapshot<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeSnapshot(item)) as T;
  }
  if (typeof value === "string") return trimString(value) as T;
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
