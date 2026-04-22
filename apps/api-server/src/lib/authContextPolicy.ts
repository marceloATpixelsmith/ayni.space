import type { Request } from "express";
import type { App } from "@workspace/db";
import { getAppBySlug } from "./appAccess.js";
import { resolveNormalizedAccessProfile, type NormalizedAccessProfile } from "./appAccessProfile.js";
import { getKnownSessionGroups, resolveSessionGroupFromAppSlug, resolveSessionGroupFromOrigin, SESSION_GROUPS } from "./sessionGroup.js";
import { resolveSessionGroupForApp } from "./sessionGroupCompatibility.js";

export type AuthContextPolicy = {
  accessMode: NormalizedAccessProfile;
  sessionGroup: string;
  applyAdminPrivileges: boolean;
};

export type AuthContextFailureReason =
  | "app_slug_missing"
  | "app_context_ambiguous"
  | "app_not_found"
  | "invalid_access_mode"
  | "session_group_conflict"
  | "admin_context_required";

export type AuthContextResolution =
  | {
      ok: true;
      resolvedAppSlug: string;
      sessionGroup: string;
      policy: AuthContextPolicy;
      app: App | null;
      source: "request" | "origin" | "session-group-default";
    }
  | {
      ok: false;
      reason: AuthContextFailureReason;
      details?: Record<string, unknown>;
    };

function parseAppSlugByOriginEnv(): Map<string, string> {
  const raw = process.env["APP_SLUG_BY_ORIGIN"] ?? "";
  const mappings = new Map<string, string>();
  for (const entry of raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [origin, slug] = entry.split("=").map((value) => value.trim());
    if (!origin || !slug) continue;
    try {
      mappings.set(new URL(origin).origin, slug.toLowerCase());
    } catch {
      continue;
    }
  }
  return mappings;
}

function parseDefaultAppSlugBySessionGroupEnv(): Map<string, string> {
  const raw = process.env["SESSION_GROUP_APP_SLUGS"] ?? "";
  const mappings = new Map<string, string>();
  for (const entry of raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [sessionGroup, appSlug] = entry
      .split("=")
      .map((value) => value.trim());
    if (!sessionGroup || !appSlug) continue;
    mappings.set(sessionGroup, appSlug.toLowerCase());
  }
  return mappings;
}

function firstQueryParam(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export function getRequestedAppSlugFromRequest(req: Request): string | null {
  const bodyAppSlug = firstQueryParam(req.body?.appSlug);
  if (bodyAppSlug && bodyAppSlug.trim()) return bodyAppSlug.trim().toLowerCase();

  const queryAppSlug = firstQueryParam(req.query?.appSlug);
  if (queryAppSlug && queryAppSlug.trim()) return queryAppSlug.trim().toLowerCase();

  const sessionAppSlug =
    typeof req.session?.appSlug === "string" ? req.session.appSlug.trim().toLowerCase() : "";
  if (sessionAppSlug) return sessionAppSlug;

  return null;
}

export function deriveAuthContextPolicy(appMetadata: Pick<App, "slug" | "accessMode" | "metadata">): AuthContextPolicy | null {
  const accessMode = resolveNormalizedAccessProfile(appMetadata);
  if (!accessMode) return null;

  const sessionGroup = resolveSessionGroupForApp(appMetadata);
  const applyAdminPrivileges =
    accessMode === "superadmin" ||
    sessionGroup === SESSION_GROUPS.ADMIN ||
    appMetadata.slug === "admin";

  return {
    accessMode,
    sessionGroup,
    applyAdminPrivileges,
  };
}

function deriveAuthContextPolicyFromSlug(appSlug: string): AuthContextPolicy {
  const sessionGroup = resolveSessionGroupFromAppSlug(appSlug);
  return {
    accessMode: appSlug === "admin" ? "superadmin" : "organization",
    sessionGroup,
    applyAdminPrivileges:
      appSlug === "admin" || sessionGroup === SESSION_GROUPS.ADMIN,
  };
}

export async function resolveAppContextForAuth(input: {
  req: Request;
  appSlug?: string | null;
  sessionGroup?: string | null;
  origin?: string | null;
}): Promise<AuthContextResolution> {
  const requestedAppSlug = (input.appSlug ?? getRequestedAppSlugFromRequest(input.req))?.trim().toLowerCase() || null;
  const origin = input.origin ?? null;
  let originAppSlug: string | null = null;
  if (origin) {
    try {
      originAppSlug = parseAppSlugByOriginEnv().get(new URL(origin).origin) ?? null;
    } catch {
      originAppSlug = null;
    }
  }
  const derivedSessionGroup =
    input.sessionGroup ??
    input.req.resolvedSessionGroup ??
    resolveSessionGroupFromOrigin(origin);
  const defaultByGroup = parseDefaultAppSlugBySessionGroupEnv().get(derivedSessionGroup) ?? null;

  const candidateEntries: Array<{ source: "request" | "origin" | "session-group-default"; appSlug: string }> = [];
  if (requestedAppSlug) candidateEntries.push({ source: "request", appSlug: requestedAppSlug });
  if (originAppSlug) candidateEntries.push({ source: "origin", appSlug: originAppSlug });
  if (defaultByGroup) candidateEntries.push({ source: "session-group-default", appSlug: defaultByGroup });

  const distinct = [...new Set(candidateEntries.map((entry) => entry.appSlug))];
  if (distinct.length === 0) {
    return { ok: false, reason: "app_slug_missing" };
  }

  if (distinct.length > 1) {
    return {
      ok: false,
      reason: "app_context_ambiguous",
      details: {
        candidates: candidateEntries,
      },
    };
  }

  const resolvedAppSlug = distinct[0]!;
  const source = candidateEntries.find((entry) => entry.appSlug === resolvedAppSlug)?.source ?? "request";
  let app: App | null = null;
  let policy: AuthContextPolicy | null = null;
  try {
    app = await getAppBySlug(resolvedAppSlug);
    if (app) {
      policy = deriveAuthContextPolicy(app);
      if (!policy) {
        return { ok: false, reason: "invalid_access_mode", details: { resolvedAppSlug } };
      }
    }
  } catch {
    app = null;
  }
  if (!policy) {
    policy = deriveAuthContextPolicyFromSlug(resolvedAppSlug);
  }

  const knownGroups = getKnownSessionGroups();
  const requestGroup = (derivedSessionGroup || "").trim();
  const hasRequestGroup = requestGroup.length > 0 && knownGroups.includes(requestGroup);
  if (hasRequestGroup && requestGroup !== policy.sessionGroup) {
    return {
      ok: false,
      reason: policy.applyAdminPrivileges ? "admin_context_required" : "session_group_conflict",
      details: {
        requestSessionGroup: requestGroup,
        policySessionGroup: policy.sessionGroup,
        resolvedAppSlug,
      },
    };
  }

  if (policy.applyAdminPrivileges && policy.sessionGroup !== SESSION_GROUPS.ADMIN) {
    return {
      ok: false,
      reason: "admin_context_required",
      details: { resolvedAppSlug, policySessionGroup: policy.sessionGroup },
    };
  }

  return {
    ok: true,
    resolvedAppSlug,
    sessionGroup: policy.sessionGroup,
    policy,
    app,
    source,
  };
}

export function mapAuthContextFailureToAuthErrorCode(reason: AuthContextFailureReason): string {
  if (reason === "app_slug_missing") return "app_slug_missing";
  if (reason === "app_not_found") return "app_not_found";
  if (reason === "admin_context_required") return "access_denied";
  return "app_context_unavailable";
}
