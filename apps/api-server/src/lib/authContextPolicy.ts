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
  | "app_not_found"
  | "app_context_unavailable"
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
      canonicalAppResolved: boolean;
      source: "request" | "origin";
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
  const paramAppSlug =
    typeof input.appSlug === "string" && input.appSlug.trim()
      ? input.appSlug.trim().toLowerCase()
      : null;
  const explicitAppSlug = bodyAppSlug ?? paramAppSlug;

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

  if (explicitAppSlug && originAppSlug && explicitAppSlug !== originAppSlug) {
    return {
      ok: false,
      reason: "app_context_unavailable",
      details: { explicitAppSlug, originAppSlug },
    };
  }

  const selectedAppSlug = explicitAppSlug ?? originAppSlug;
  if (!selectedAppSlug) {
    return { ok: false, reason: "app_not_found" };
  }

  let selectedCanonicalApp: App | null = null;
  let canonicalLookupError: unknown = null;
  try {
    selectedCanonicalApp = (await getAppBySlug(selectedAppSlug)) ?? null;
  } catch (error) {
    canonicalLookupError = error;
  }

  if (canonicalLookupError) {
    return {
      ok: false,
      reason: "app_context_unavailable",
      details: {
        resolvedAppSlug: selectedAppSlug,
        lookupError:
          canonicalLookupError instanceof Error
            ? canonicalLookupError.message
            : String(canonicalLookupError),
      },
    };
  }

  if (!selectedCanonicalApp) {
    return {
      ok: false,
      reason: "app_not_found",
      details: { resolvedAppSlug: selectedAppSlug },
    };
  }

  const source: "request" | "origin" = explicitAppSlug ? "request" : "origin";

  const app = selectedCanonicalApp;
  const policy = deriveAuthContextPolicy(app);

  if (!policy) {
    return {
      ok: false,
      reason: "invalid_access_mode",
      details: { resolvedAppSlug: selectedAppSlug },
    };
  }

  const derivedSessionGroup =
    input.sessionGroup ??
    input.req.resolvedSessionGroup ??
    resolveSessionGroupFromOrigin(origin);

  const knownGroups = getKnownSessionGroups();
  const requestGroup = (derivedSessionGroup || "").trim();
  const hasRequestGroup = requestGroup.length > 0 && knownGroups.includes(requestGroup);
  const hasAuthenticatedSessionIdentity = Boolean(
    input.req.session?.userId || input.req.session?.pendingUserId,
  );
  const enforceSessionGroupConflict =
    source === "origin" || hasAuthenticatedSessionIdentity;

  if (
    hasRequestGroup &&
    requestGroup !== policy.sessionGroup &&
    enforceSessionGroupConflict
  ) {
    return {
      ok: false,
      reason: policy.applyAdminPrivileges ? "admin_context_required" : "session_group_conflict",
      details: {
        requestSessionGroup: requestGroup,
        policySessionGroup: policy.sessionGroup,
        resolvedAppSlug: selectedAppSlug,
      },
    };
  }

  if (policy.applyAdminPrivileges && policy.sessionGroup !== SESSION_GROUPS.ADMIN) {
    return {
      ok: false,
      reason: "admin_context_required",
      details: { resolvedAppSlug: selectedAppSlug, policySessionGroup: policy.sessionGroup },
    };
  }

  return {
    ok: true,
    resolvedAppSlug: selectedAppSlug,
    sessionGroup: policy.sessionGroup,
    policy,
    app,
    canonicalAppResolved: Boolean(app),
    source,
  };
}

export function mapAuthContextFailureToAuthErrorCode(reason: AuthContextFailureReason): string {
  if (reason === "app_not_found") return "app_not_found";
  if (reason === "admin_context_required") return "access_denied";
  return "app_context_unavailable";
}
