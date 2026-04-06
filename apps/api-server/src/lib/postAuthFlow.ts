import { getAppContext } from "./appAccess.js";
import { getPostAuthRedirectPath } from "./postAuthRedirect.js";
import type { NormalizedAccessProfile } from "./appAccessProfile.js";

type PostAuthAppContext = {
  canAccess: boolean;
  requiredOnboarding: "none" | "organization";
  normalizedAccessProfile: NormalizedAccessProfile;
};

export type PostAuthFlowDecision = {
  canAccess: boolean;
  requiredOnboarding: "none" | "organization";
  normalizedAccessProfile: NormalizedAccessProfile;
  destination: string;
};

export async function resolvePostAuthFlowDecision(params: {
  userId: string;
  appSlug: string;
  isSuperAdmin: boolean;
  normalizedAccessProfile: NormalizedAccessProfile;
}): Promise<PostAuthFlowDecision | null> {
  const { userId, appSlug, isSuperAdmin, normalizedAccessProfile } = params;

  const context: PostAuthAppContext | null = normalizedAccessProfile === "superadmin"
    ? {
        canAccess: Boolean(isSuperAdmin),
        normalizedAccessProfile: "superadmin",
        requiredOnboarding: "none",
      }
    : await getAppContext(userId, appSlug);

  if (!context) return null;

  return {
    canAccess: context.canAccess,
    requiredOnboarding: context.requiredOnboarding,
    normalizedAccessProfile: context.normalizedAccessProfile,
    destination: getPostAuthRedirectPath({
      appSlug,
      isSuperAdmin,
      normalizedAccessProfile: context.normalizedAccessProfile,
      requiredOnboarding: context.requiredOnboarding,
    }),
  };
}
