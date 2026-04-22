import type { Request } from "express";
import type { App } from "@workspace/db";
import { getAppBySlug, getAppSlugByOrigin } from "./appAccess.js";
import { resolveNormalizedAccessProfile, type NormalizedAccessProfile } from "./appAccessProfile.js";
import { getKnownSessionGroups, resolveSessionGroupFromOrigin, SESSION_GROUPS } from "./sessionGroup.js";
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
      app: App;
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

  return null;
}

export function deriveAuthContextPolicy(appMetadata: Pick<App, "slug" | "accessMode" | "metadata">): AuthContextPolicy | null {
  const accessMode = resolveNormalizedAccessProfile(appMetadata);
  if (!accessMode) return null;

  const sessionGroup = resolveSessionGroupForApp(appMetadata);
  const applyAdminPrivileges = accessMode === "superadmin";

  return {
    accessMode,
    sessionGroup,
    applyAdminPrivileges,
  };
}

export async function resolveAppContextForAuth(input: {
  req: Request;
  appSlug?: string | null;
  sessionGroup?: string | null;
  origin?: string | null;
}): Promise<AuthContextResolution> {
  const bodyAppSlug = getRequestedAppSlugFromRequest(input.req);
  const explicitAppSlug =
    typeof input.appSlug === "string" && input.appSlug.trim()
      ? input.appSlug.trim().toLowerCase()
      : null;
  const origin = input.origin ?? null;
  let originAppSlug: string | null = null;
  if (origin) {
    try {
      originAppSlug = parseAppSlugByOriginEnv().get(new URL(origin).origin) ?? null;
    } catch {
      originAppSlug = null;
    }
    if (!originAppSlug) {
      try {
        originAppSlug = await getAppSlugByOrigin(origin);
      } catch {
        originAppSlug = null;
      }
    }
  }
  const derivedSessionGroup =
    input.sessionGroup ??
    input.req.resolvedSessionGroup ??
    resolveSessionGroupFromOrigin(origin);
  const defaultByGroup = parseDefaultAppSlugBySessionGroupEnv().get(derivedSessionGroup) ?? null;

  const selected =
    (bodyAppSlug
      ? { source: "body" as const, appSlug: bodyAppSlug }
      : null) ??
    (explicitAppSlug
      ? { source: "explicit" as const, appSlug: explicitAppSlug }
      : null) ??
    (originAppSlug
      ? { source: "origin" as const, appSlug: originAppSlug }
      : null) ??
    (defaultByGroup
      ? { source: "session-group-default" as const, appSlug: defaultByGroup }
      : null);

  if (!selected) {
    return { ok: false, reason: "app_slug_missing" };
  }

  const candidatesConflict = (
    leftSlug: string | null,
    leftApp: App | null,
    rightSlug: string | null,
    rightApp: App | null,
  ): boolean => {
    if (!leftSlug || !rightSlug) return false;
    if (leftSlug === rightSlug) return false;
    if (leftApp && rightApp) return leftApp.id !== rightApp.id;
    return true;
  };

  let selectedCanonicalApp: App | null = null;
  try {
    selectedCanonicalApp = (await getAppBySlug(selected.appSlug)) ?? null;
  } catch {
    selectedCanonicalApp = null;
  }

  let originCanonicalApp: App | null = null;
  if (originAppSlug) {
    try {
      originCanonicalApp = (await getAppBySlug(originAppSlug)) ?? null;
    } catch {
      originCanonicalApp = null;
    }
  }
  let defaultCanonicalApp: App | null = null;
  if (defaultByGroup) {
    try {
      defaultCanonicalApp = (await getAppBySlug(defaultByGroup)) ?? null;
    } catch {
      defaultCanonicalApp = null;
    }
  }

  const originConflicts = candidatesConflict(
    selected.appSlug,
    selectedCanonicalApp,
    originAppSlug,
    originCanonicalApp,
  );
  const defaultConflicts = candidatesConflict(
    selected.appSlug,
    selectedCanonicalApp,
    defaultByGroup,
    defaultCanonicalApp,
  );

  if (selected.source === "explicit" || selected.source === "body") {
    if (originConflicts) {
      return {
        ok: false,
        reason: "app_context_ambiguous",
        details: { explicitAppSlug: selected.appSlug, originAppSlug },
      };
    }
    if (defaultConflicts) {
      return {
        ok: false,
        reason: "app_context_ambiguous",
        details: { explicitAppSlug: selected.appSlug, defaultByGroup },
      };
    }
  }
  if (
    selected.source === "origin" &&
    candidatesConflict(
      originAppSlug,
      originCanonicalApp,
      defaultByGroup,
      defaultCanonicalApp,
    )
  ) {
    return {
      ok: false,
      reason: "app_context_ambiguous",
      details: { originAppSlug: selected.appSlug, defaultByGroup },
    };
  }

  if (!selectedCanonicalApp) {
    return {
      ok: false,
      reason: "app_not_found",
      details: { resolvedAppSlug: selected.appSlug, source: selected.source },
    };
  }

  const resolvedAppSlug = selected.appSlug;
  const source: "request" | "origin" | "session-group-default" =
    selected.source === "origin"
      ? "origin"
      : selected.source === "session-group-default"
        ? "session-group-default"
        : "request";

  const app = selectedCanonicalApp;
  let policy: AuthContextPolicy | null = null;

  policy = deriveAuthContextPolicy(app);
  if (!policy) {
    return {
      ok: false,
      reason: "invalid_access_mode",
      details: { resolvedAppSlug },
    };
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
