import type { NormalizedAccessProfile } from "./appAccessProfile.js";

export const ADMIN_ACCESS_DENIED_ERROR = "access_denied";
export const AUTH_LOGIN_PATH = "/login";
export const DEFAULT_POST_AUTH_PATH = "/dashboard";

export function buildAccessDeniedLoginPath(): string {
  return `${AUTH_LOGIN_PATH}?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;
}

export function getPostAuthRedirectPath(options: {
  appSlug: string;
  isSuperAdmin: boolean;
  normalizedAccessProfile: NormalizedAccessProfile;
  requiredOnboarding: "none" | "organization" | "user";
}): string {
  const { appSlug, isSuperAdmin, normalizedAccessProfile, requiredOnboarding } =
    options;

  if (normalizedAccessProfile === "superadmin") {
    if (isSuperAdmin) return DEFAULT_POST_AUTH_PATH;
    return buildAccessDeniedLoginPath();
  }

  if (requiredOnboarding === "organization") {
    return "/onboarding/organization";
  }
  if (requiredOnboarding === "user") return "/onboarding/user";

  return DEFAULT_POST_AUTH_PATH;
}
