import type { NormalizedAccessProfile } from "./appAccessProfile.js";

export const ADMIN_ACCESS_DENIED_ERROR = "access_denied";

export function getPostAuthRedirectPath(options: {
  appSlug: string;
  isSuperAdmin: boolean;
  normalizedAccessProfile: NormalizedAccessProfile;
  requiredOnboarding: "none" | "organization" | "user";
}): string {
  const { appSlug, isSuperAdmin, normalizedAccessProfile, requiredOnboarding } =
    options;

  if (normalizedAccessProfile === "superadmin") {
    if (isSuperAdmin) return "/dashboard";
    return `/login?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;
  }

  if (requiredOnboarding === "organization") {
    return "/onboarding/organization";
  }
  if (requiredOnboarding === "user") return "/onboarding/user";

  return "/dashboard";
}
