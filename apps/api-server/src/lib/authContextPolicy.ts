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
      explicitAppSlugProvided: boolean;
      source: "request" | "origin" | "session_group";
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

function normalizeSlug(value: unknown): string | null {
  const raw = firstQueryParam(value);
  if (!raw || !raw.trim()) return null;
  return raw.trim().toLowerCase();
}

function getBodyAppSlug(req: Request): string | null {
  return normalizeSlug(req.body?.appSlug);
}

function getQueryOrParamAppSlug(req: Request, explicitAppSlug?: string | null): string | null {
  return (
    normalizeSlug(explicitAppSlug) ??
    normalizeSlug(req.query?.appSlug) ??
    normalizeSlug(req.params?.appSlug)
  );
}

function parseSessionGroupSlugMap(): Map<string, string> {
  const raw = process.env["SESSION_GROUP_APP_SLUGS"] ?? "";
  const mapping = new Map<string, string>();
  for (const entry of raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [sessionGroup, appSlug] = entry.split("=").map((value) => value.trim());
    if (!sessionGroup || !appSlug) continue;
    mapping.set(sessionGroup, appSlug.toLowerCase());
  }
  return mapping;
}

function getSessionGroupFallbackAppSlug(sessionGroup: string | null | undefined): string | null {
  const normalizedGroup = typeof sessionGroup === "string" ? sessionGroup.trim() : "";
  if (!normalizedGroup) return null;
  const mappedSlug = parseSessionGroupSlugMap().get(normalizedGroup);
  if (mappedSlug) return mappedSlug;
  return normalizedGroup === SESSION_GROUPS.ADMIN ? "admin" : null;
}

export function getRequestedAppSlugFromRequest(req: Request): string | null {
  return getBodyAppSlug(req) ?? getQueryOrParamAppSlug(req);
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
  const bodyAppSlug = getBodyAppSlug(input.req);
  const queryOrParamAppSlug = getQueryOrParamAppSlug(input.req, input.appSlug);
  const explicitAppSlug = bodyAppSlug ?? queryOrParamAppSlug;

  const origin = input.origin ?? null;
  const originMappings = parseAppSlugByOriginEnv();
  let trustedOriginAppSlug: string | null = null;
  let dbOriginAppSlug: string | null = null;
  if (origin) {
    try {
      trustedOriginAppSlug = originMappings.get(new URL(origin).origin) ?? null;
    } catch {
      trustedOriginAppSlug = null;
    }
    try {
      dbOriginAppSlug = await getAppSlugByOrigin(origin);
    } catch {
      dbOriginAppSlug = null;
    }
  }

  const originAppSlug = trustedOriginAppSlug ?? dbOriginAppSlug;

  const fallbackSessionGroup =
    input.sessionGroup ??
    input.req.resolvedSessionGroup ??
    input.req.session?.sessionGroup ??
    resolveSessionGroupFromOrigin(origin);
  const sessionGroupFallbackAppSlug = getSessionGroupFallbackAppSlug(fallbackSessionGroup);

  const selectedAppSlug =
    explicitAppSlug ?? originAppSlug ?? sessionGroupFallbackAppSlug;
  if (!selectedAppSlug) {
    return { ok: false, reason: "app_slug_missing" };
  }

  const originDerivedSessionGroup = resolveSessionGroupFromOrigin(origin);
  let selectedCanonicalApp: App | null = null;
  let canonicalLookupError: unknown = null;
  const source: "request" | "origin" | "session_group" = explicitAppSlug
    ? "request"
    : (trustedOriginAppSlug ?? dbOriginAppSlug)
      ? "origin"
      : origin &&
          sessionGroupFallbackAppSlug &&
          fallbackSessionGroup &&
          originDerivedSessionGroup &&
          fallbackSessionGroup === originDerivedSessionGroup
        ? "origin"
      : "session_group";
  try {
    selectedCanonicalApp = (await getAppBySlug(selectedAppSlug, {
      allowOutageFallback: true,
    })) ?? null;
  } catch (error) {
    canonicalLookupError = error;
  }

  if (canonicalLookupError) {
    return {
      ok: false,
      reason: source === "session_group" ? "app_not_found" : "app_context_unavailable",
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
    fallbackSessionGroup;

  const knownGroups = getKnownSessionGroups();
  const requestGroup = (derivedSessionGroup || "").trim();
  const hasRequestGroup = requestGroup.length > 0 && knownGroups.includes(requestGroup);
  const hasAuthenticatedSessionIdentity = Boolean(
    input.req.session?.userId || input.req.session?.pendingUserId,
  );
  const enforceSessionGroupConflict =
    !explicitAppSlug && (source === "origin" || hasAuthenticatedSessionIdentity);

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
    explicitAppSlugProvided: Boolean(explicitAppSlug),
    source,
  };
}

export function mapAuthContextFailureToAuthErrorCode(reason: AuthContextFailureReason): string {
  if (reason === "app_slug_missing") return "app_slug_missing";
  if (reason === "app_not_found") return "app_not_found";
  if (reason === "admin_context_required") return "access_denied";
  return "app_context_unavailable";
}
