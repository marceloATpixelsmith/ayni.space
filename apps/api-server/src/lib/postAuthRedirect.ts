import type { NormalizedAccessProfile } from "./appAccessProfile.js";
import {
  DEFAULT_POST_AUTH_PATH,
  buildAccessDeniedLoginPath,
} from "@workspace/auth";

// Compatibility export for modules that still consume this symbol from
// postAuthRedirect during auth contract cleanup.
export { DEFAULT_POST_AUTH_PATH };

export function getPostAuthRedirectPath(options: {
  appSlug: string;
  isSuperAdmin: boolean;
  normalizedAccessProfile: NormalizedAccessProfile;
  requiredOnboarding: "none" | "organization" | "user";
}): string {
  const { isSuperAdmin, normalizedAccessProfile, requiredOnboarding } = options;

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
