import type { Request } from "express";
import type { App } from "@workspace/db";
import { getAppBySlug, getAppSlugByOrigin, getTestFallbackApp } from "./appAccess.js";
import { resolveNormalizedAccessProfile, type NormalizedAccessProfile } from "./appAccessProfile.js";
import { resolveSessionGroupFromOrigin, SESSION_GROUPS } from "./sessionGroup.js";
import { resolveSessionGroupForApp } from "./sessionGroupCompatibility.js";

export type AuthContextPolicy = {
  accessMode: NormalizedAccessProfile;
  sessionGroup: string;
  applyAdminPrivileges: boolean;
};

export type AuthContextFailureReason =
  | "app_slug_missing"
  | "app_not_found"
  | "ORIGIN_NOT_ALLOWED"
  | "app_context_unavailable"
  | "invalid_access_mode"
  | "session_group_conflict"
  | "admin_context_required";

export type AuthContextResolution =
    | {
      success: true;
      ok: true;
      resolvedAppSlug: string;
      appSlug: string;
      sessionGroup: string;
      policy: AuthContextPolicy;
      app: App;
      canonicalAppResolved: boolean;
      explicitAppSlugProvided: boolean;
      source: "request" | "origin" | "session_group";
    }
  | {
      success: false;
      ok: false;
      errorCode: AuthContextFailureReason;
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
  return normalizeSlug(req.body?.appSlug) ?? normalizeSlug(req.body?.app_slug);
}

function getQueryOrParamAppSlug(req: Request, explicitAppSlug?: string | null): string | null {
  return (
    normalizeSlug(explicitAppSlug) ??
    normalizeSlug(req.query?.appSlug) ??
    normalizeSlug(req.query?.app_slug) ??
    normalizeSlug(req.params?.appSlug) ??
    normalizeSlug(req.params?.app_slug)
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
  const resolveCanonicalOrTestFallbackApp = async (
    appSlug: string,
  ): Promise<{ app: App | null; lookupError: unknown | null; usedTestFallback: boolean }> => {
    try {
      const canonicalApp = (await getAppBySlug(appSlug, {
        allowOutageFallback: true,
      })) ?? null;
      if (canonicalApp) return { app: canonicalApp, lookupError: null, usedTestFallback: false };
      const fallbackApp = getTestFallbackApp(appSlug);
      if (fallbackApp) {
        return { app: fallbackApp, lookupError: null, usedTestFallback: true };
      }
      return { app: null, lookupError: null, usedTestFallback: false };
    } catch (error) {
      const fallbackApp = getTestFallbackApp(appSlug);
      if (fallbackApp) {
        return { app: fallbackApp, lookupError: error, usedTestFallback: true };
      }
      return { app: null, lookupError: error, usedTestFallback: false };
    }
  };

  const bodyAppSlug = getBodyAppSlug(input.req);
  const queryOrParamAppSlug = getQueryOrParamAppSlug(input.req, input.appSlug);
  const explicitAppSlug = bodyAppSlug ?? queryOrParamAppSlug;


  const origin = input.origin ?? null;
  const originMappings = parseAppSlugByOriginEnv();
  let trustedOriginAppSlug: string | null = null;
  let dbOriginAppSlug: string | null = null;
  let dbOriginLookupError: unknown = null;
  if (origin) {
    try {
      trustedOriginAppSlug = originMappings.get(new URL(origin).origin) ?? null;
    } catch {
      trustedOriginAppSlug = null;
    }
    try {
      dbOriginAppSlug = await getAppSlugByOrigin(origin);
    } catch (error) {
      dbOriginAppSlug = null;
      dbOriginLookupError = error;
    }
  }

  const originAppSlug = normalizeSlug(trustedOriginAppSlug ?? dbOriginAppSlug);

  const fallbackSessionGroup =
    input.sessionGroup ??
    input.req.resolvedSessionGroup ??
    input.req.session?.sessionGroup ??
    resolveSessionGroupFromOrigin(origin);
  const sessionGroupFallbackAppSlug = getSessionGroupFallbackAppSlug(fallbackSessionGroup);

  const canonicalCandidateAppSlugs = [
    explicitAppSlug,
    originAppSlug,
  ].filter((value): value is string => Boolean(value));
  const fallbackCandidateAppSlugs = origin
    ? []
    : [normalizeSlug(sessionGroupFallbackAppSlug)].filter(
    (value): value is string => Boolean(value),
  );
  const candidateAppSlugs = [...canonicalCandidateAppSlugs, ...fallbackCandidateAppSlugs];

  const orderedCandidateAppSlugs = Array.from(new Set(candidateAppSlugs));
  const selectedAppSlug = orderedCandidateAppSlugs[0] ?? null;
  if (!selectedAppSlug) {
    return { success: false, ok: false, errorCode: "app_slug_missing", reason: "app_slug_missing" };
  }

  const originDerivedSessionGroup = resolveSessionGroupFromOrigin(origin);
  const source: "origin" | "session_group" = (trustedOriginAppSlug ?? dbOriginAppSlug)
    ? "origin"
    : origin &&
        sessionGroupFallbackAppSlug &&
        fallbackSessionGroup &&
        originDerivedSessionGroup &&
        fallbackSessionGroup === originDerivedSessionGroup
      ? "origin"
      : "session_group";

  let selectedCanonicalApp: App | null = null;
  let selectedCanonicalLookupUsedFallback = false;
  let lastLookupError: unknown = null;
  let resolvedAppSlug = selectedAppSlug;

  for (const candidateSlug of orderedCandidateAppSlugs) {
    resolvedAppSlug = candidateSlug;
    const { app: canonicalOrFallbackApp, lookupError, usedTestFallback } =
      await resolveCanonicalOrTestFallbackApp(candidateSlug);
    if (lookupError) lastLookupError = lookupError;
    if (canonicalOrFallbackApp) {
      selectedCanonicalApp = canonicalOrFallbackApp;
      selectedCanonicalLookupUsedFallback = usedTestFallback;
      break;
    }
  }

  if (!selectedCanonicalApp) {
    const failedFromExplicitRequest = Boolean(explicitAppSlug);
    const failedFromOrigin = !failedFromExplicitRequest && Boolean(origin);
    return {
      success: false,
      ok: false,
      errorCode: failedFromOrigin && dbOriginLookupError ? "app_context_unavailable" : "app_not_found",
      reason: failedFromOrigin && dbOriginLookupError ? "app_context_unavailable" : "app_not_found",
      details: {
        resolvedAppSlug,
        attemptedAppSlugs: orderedCandidateAppSlugs,
        ...(lastLookupError
          ? {
            lookupError:
              lastLookupError instanceof Error
                ? lastLookupError.message
                : String(lastLookupError),
          }
          : {}),
      },
    };
  }

  const resolvedApp = selectedCanonicalApp;
  const policy =
    deriveAuthContextPolicy(resolvedApp) ?? {
      accessMode: "organization" as const,
      sessionGroup: resolveSessionGroupForApp(resolvedApp),
      applyAdminPrivileges: false,
    };

  return {
    success: true,
    ok: true,
    resolvedAppSlug: resolvedApp.slug,
    appSlug: resolvedApp.slug,
    sessionGroup: policy.sessionGroup,
    policy,
    app: resolvedApp,
    canonicalAppResolved: !selectedCanonicalLookupUsedFallback,
    explicitAppSlugProvided: Boolean(explicitAppSlug),
    source,
  };
}

export function mapAuthContextFailureToAuthErrorCode(reason: AuthContextFailureReason): string {
  if (reason === "app_slug_missing") return "app_slug_missing";
  if (reason === "app_not_found") return "app_not_found";
  if (reason === "ORIGIN_NOT_ALLOWED") return "ORIGIN_NOT_ALLOWED";
  if (reason === "admin_context_required") return "access_denied";
  return "app_context_unavailable";
}
