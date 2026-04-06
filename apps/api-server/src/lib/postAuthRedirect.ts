import type { NormalizedAccessProfile } from "./appAccessProfile.js";

export const ADMIN_ACCESS_DENIED_ERROR = "access_denied";

export function getPostAuthRedirectPath(options: {
  appSlug: string;
  isSuperAdmin: boolean;
  normalizedAccessProfile: NormalizedAccessProfile;
  requiredOnboarding: "none" | "organization";
}): string {
  const { appSlug, isSuperAdmin, normalizedAccessProfile, requiredOnboarding } = options;

  if (normalizedAccessProfile === "superadmin") {
    if (isSuperAdmin) return "/dashboard";
    return `/login?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;
  }

  if (requiredOnboarding !== "none") {
    return "/onboarding/organization";
  }

  return "/dashboard";
}
