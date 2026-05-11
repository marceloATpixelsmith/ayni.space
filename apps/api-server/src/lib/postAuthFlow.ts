import { getAppContext } from "./appAccess.js";
import { getPostAuthRedirectPath } from "./postAuthRedirect.js";
import { buildAccessDeniedLoginPath } from "@workspace/auth";
import type { NormalizedAccessProfile } from "./appAccessProfile.js";

type PostAuthIntent = "sign_in" | "create_account";

type PostAuthAppContext = {
  canAccess: boolean;
  requiredOnboarding: "none" | "organization" | "user";
  normalizedAccessProfile: NormalizedAccessProfile;
  app?: {
    customerRegistrationEnabled?: boolean | null;
  } | null;
  appAccess?: {
    accessStatus?: string | null;
  } | null;
  activeOrg?: unknown | null;
  orgMembership?: unknown | null;
};

export type PostAuthFlowDecision = {
  appSlug: string;
  canAccess: boolean;
  requiredOnboarding: "none" | "organization" | "user";
  normalizedAccessProfile: NormalizedAccessProfile;
  destination: string;
};

export async function resolvePostAuthFlowDecision(params: {
  userId: string;
  appSlug: string;
  isSuperAdmin: boolean;
  normalizedAccessProfile: NormalizedAccessProfile;
  authIntent?: PostAuthIntent;
}): Promise<PostAuthFlowDecision | null> {
  const {
    userId,
    appSlug,
    isSuperAdmin,
    normalizedAccessProfile,
    authIntent = "sign_in",
  } = params;

  const context: PostAuthAppContext | null =
    normalizedAccessProfile === "superadmin"
      ? {
          canAccess: Boolean(isSuperAdmin),
          normalizedAccessProfile: "superadmin",
          requiredOnboarding: "none",
        }
      : await getAppContext(userId, appSlug);

  if (!context) return null;

  const hasExistingOrganizationOrAppAccess = Boolean(
    context.activeOrg ||
      context.orgMembership ||
      context.appAccess?.accessStatus === "active",
  );
  const shouldRequireOrganizationOnboardingForGoogleCreateAccount =
    authIntent === "create_account" &&
    normalizedAccessProfile === "organization" &&
    context.normalizedAccessProfile === "organization" &&
    context.app?.customerRegistrationEnabled === true &&
    !hasExistingOrganizationOrAppAccess;

  const effectiveContext: PostAuthAppContext =
    shouldRequireOrganizationOnboardingForGoogleCreateAccount
      ? {
          ...context,
          canAccess: true,
          requiredOnboarding: "organization",
        }
      : context;

  const destination =
    effectiveContext.canAccess || effectiveContext.requiredOnboarding !== "none"
      ? getPostAuthRedirectPath({
          appSlug,
          isSuperAdmin,
          normalizedAccessProfile: effectiveContext.normalizedAccessProfile,
          requiredOnboarding: effectiveContext.requiredOnboarding,
        })
      : buildAccessDeniedLoginPath();

  return {
    appSlug,
    canAccess: effectiveContext.canAccess,
    requiredOnboarding: effectiveContext.requiredOnboarding,
    normalizedAccessProfile: effectiveContext.normalizedAccessProfile,
    destination,
  };
}
