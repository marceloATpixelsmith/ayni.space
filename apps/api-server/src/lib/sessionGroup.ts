const DEFAULT_SESSION_GROUP = "default";
const ADMIN_SESSION_GROUP = "admin";

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function getAdminSessionGroupOrigins(): string[] {
  return parseCsv(process.env["ADMIN_FRONTEND_ORIGINS"]).map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => Boolean(origin));
}

export function resolveSessionGroupFromOrigin(origin: string | null | undefined): string {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return DEFAULT_SESSION_GROUP;

  const adminOrigins = getAdminSessionGroupOrigins();
  if (adminOrigins.includes(normalizedOrigin)) {
    return ADMIN_SESSION_GROUP;
  }

  return DEFAULT_SESSION_GROUP;
}

function parseSessionGroupCookieNames(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of parseCsv(raw)) {
    const [group, cookieName] = entry.split("=").map((value) => value?.trim() ?? "");
    if (!group || !cookieName) continue;
    map.set(group, cookieName);
  }
  return map;
}

export function getSessionCookieNameForGroup(sessionGroup: string): string {
  const configuredCookieNames = parseSessionGroupCookieNames(process.env["SESSION_GROUP_COOKIE_NAMES"]);
  const configuredCookieName = configuredCookieNames.get(sessionGroup);
  if (configuredCookieName) return configuredCookieName;

  if (sessionGroup === ADMIN_SESSION_GROUP) return "saas.admin.sid";

  return "saas.sid";
}

export function isRestrictedSessionGroup(sessionGroup: string): boolean {
  return sessionGroup === ADMIN_SESSION_GROUP;
}

export const SESSION_GROUPS = {
  DEFAULT: DEFAULT_SESSION_GROUP,
  ADMIN: ADMIN_SESSION_GROUP,
} as const;
