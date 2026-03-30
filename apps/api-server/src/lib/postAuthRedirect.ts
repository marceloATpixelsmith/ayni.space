import type { NormalizedAccessProfile } from "./appAccessProfile.js";

export const ADMIN_ACCESS_DENIED_ERROR = "access_denied";

export function getPostAuthRedirectPath(options: {
  isSuperAdmin: boolean;
  normalizedAccessProfile: NormalizedAccessProfile;
  requiredOnboarding: "none" | "organization" | "solo";
  authIntent?: "sign_in" | "create_account" | null;
}): string {
  const { isSuperAdmin, normalizedAccessProfile, requiredOnboarding } = options;

  if (normalizedAccessProfile === "superadmin") {
    if (isSuperAdmin) return "/dashboard";
    return `/login?error=${encodeURIComponent(ADMIN_ACCESS_DENIED_ERROR)}`;
  }

  if (requiredOnboarding !== "none") {
    return "/onboarding";
  }

  return "/dashboard";
}
