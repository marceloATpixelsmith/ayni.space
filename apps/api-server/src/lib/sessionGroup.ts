import type { Request } from "express";

const DEFAULT_SESSION_GROUP = "default";
const ADMIN_SESSION_GROUP = "admin";
const DEFAULT_SESSION_COOKIE_NAME = "saas.workspace.sid";
const ADMIN_SESSION_COOKIE_NAME = "saas.admin.sid";

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

export function getAllowedOrigins(): string[] {
  return parseCsv(process.env["ALLOWED_ORIGINS"]).map((origin) => normalizeOrigin(origin)).filter((origin): origin is string => Boolean(origin));
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

  try {
    const hostname = new URL(normalizedOrigin).hostname.toLowerCase();
    if (hostname === "admin.ayni.space" || hostname.startsWith("admin.")) {
      return ADMIN_SESSION_GROUP;
    }
  } catch {
    // noop
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

export function getSessionGroupCookieNameMap(): Map<string, string> {
  const configuredCookieNames = parseSessionGroupCookieNames(process.env["SESSION_GROUP_COOKIE_NAMES"]);

  if (!configuredCookieNames.has(DEFAULT_SESSION_GROUP)) {
    configuredCookieNames.set(DEFAULT_SESSION_GROUP, DEFAULT_SESSION_COOKIE_NAME);
  }

  if (!configuredCookieNames.has(ADMIN_SESSION_GROUP)) {
    configuredCookieNames.set(ADMIN_SESSION_GROUP, ADMIN_SESSION_COOKIE_NAME);
  }

  return configuredCookieNames;
}

export function getKnownSessionGroups(): string[] {
  return Array.from(getSessionGroupCookieNameMap().keys());
}

export function getSessionCookieNameForGroup(sessionGroup: string): string {
  const configuredCookieName = getSessionGroupCookieNameMap().get(sessionGroup);
  if (configuredCookieName) return configuredCookieName;
  return getSessionGroupCookieNameMap().get(DEFAULT_SESSION_GROUP) ?? DEFAULT_SESSION_COOKIE_NAME;
}

function getCookieNamesPresent(req: Request): Set<string> {
  const cookieHeader = req.headers["cookie"];
  if (typeof cookieHeader !== "string" || cookieHeader.trim().length === 0) {
    return new Set();
  }

  const names = new Set<string>();
  for (const entry of cookieHeader.split(";")) {
    const [name] = entry.split("=", 1);
    const normalizedName = name?.trim();
    if (normalizedName) {
      names.add(normalizedName);
    }
  }
  return names;
}

function resolveTrustedOriginFromRequest(req: Request): string | null {
  const allowedOrigins = getAllowedOrigins();

  const originHeader = typeof req.headers["origin"] === "string" ? req.headers["origin"] : null;
  const normalizedOrigin = normalizeOrigin(originHeader);
  if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
    return normalizedOrigin;
  }

  const refererHeader = typeof req.headers["referer"] === "string" ? req.headers["referer"] : null;
  const normalizedReferer = normalizeOrigin(refererHeader);
  if (normalizedReferer && allowedOrigins.includes(normalizedReferer)) {
    return normalizedReferer;
  }

  return null;
}

export type SessionGroupResolution =
  | { ok: true; sessionGroup: string; source: "origin" | "cookie" | "state" | "default" }
  | { ok: false; reason: "ambiguous" | "untrusted" | "unknown-state-group" };

function parseGroupFromOAuthState(req: Request): string | null {
  if (!req.path.endsWith("/google/callback")) {
    return null;
  }

  const stateValue = typeof req.query["state"] === "string"
    ? req.query["state"]
    : Array.isArray(req.query["state"]) && typeof req.query["state"][0] === "string"
      ? req.query["state"][0]
      : null;

  if (!stateValue) return null;

  const [group] = stateValue.split(".", 1);
  if (!group) return null;

  if (!getKnownSessionGroups().includes(group)) {
    return "__unknown__";
  }

  return group;
}

export function resolveSessionGroupForRequest(req: Request, options: { failOnAmbiguous?: boolean } = {}): SessionGroupResolution {
  const trustedOrigin = resolveTrustedOriginFromRequest(req);
  if (trustedOrigin) {
    return {
      ok: true,
      sessionGroup: resolveSessionGroupFromOrigin(trustedOrigin),
      source: "origin",
    };
  }

  const stateGroup = parseGroupFromOAuthState(req);
  if (stateGroup) {
    if (stateGroup === "__unknown__") {
      return { ok: false, reason: "unknown-state-group" };
    }

    return { ok: true, sessionGroup: stateGroup, source: "state" };
  }

  const cookies = getCookieNamesPresent(req);
  const cookieNameMap = getSessionGroupCookieNameMap();
  const matchedGroups = Array.from(cookieNameMap.entries())
    .filter(([, cookieName]) => cookies.has(cookieName))
    .map(([group]) => group);

  if (matchedGroups.length === 1) {
    return { ok: true, sessionGroup: matchedGroups[0]!, source: "cookie" };
  }

  if (matchedGroups.length > 1 && options.failOnAmbiguous) {
    return { ok: false, reason: "ambiguous" };
  }

  return { ok: true, sessionGroup: DEFAULT_SESSION_GROUP, source: "default" };
}

export function isRestrictedSessionGroup(sessionGroup: string): boolean {
  return sessionGroup === ADMIN_SESSION_GROUP;
}

export const SESSION_GROUPS = {
  DEFAULT: DEFAULT_SESSION_GROUP,
  ADMIN: ADMIN_SESSION_GROUP,
} as const;
