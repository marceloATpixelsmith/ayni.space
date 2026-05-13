import { getAppContext } from "./appAccess.js";
import { getPostAuthRedirectPath } from "./postAuthRedirect.js";
import { buildAccessDeniedLoginPath } from "@workspace/auth";
import type { NormalizedAccessProfile } from "./appAccessProfile.js";

export type PostAuthIntent = "sign_in" | "create_account";

type CanonicalPostAuthAppContext = NonNullable<
  Awaited<ReturnType<typeof getAppContext>>
>;

type SuperadminPostAuthAppContext = {
  canAccess: boolean;
  requiredOnboarding: "none" | "organization" | "user";
  normalizedAccessProfile: "superadmin";
};

type ResolvedPostAuthAppContext =
  | CanonicalPostAuthAppContext
  | SuperadminPostAuthAppContext;

export type PostAuthFlowDecision = {
  appSlug: string;
  canAccess: boolean;
  requiredOnboarding: "none" | "organization" | "user";
  normalizedAccessProfile: NormalizedAccessProfile;
  destination: string;
};

function hasExistingOrganizationOrDirectAppAccess(
  context: ResolvedPostAuthAppContext,
): boolean {
  if (!("activeOrg" in context)) {
    return false;
  }

  return Boolean(context.activeOrg || context.orgMembership);
}

function allowsOrganizationCustomerRegistration(
  context: ResolvedPostAuthAppContext,
): boolean {
  if (!("app" in context)) {
    return false;
  }

  return context.app.customerRegistrationEnabled === true;
}

function isOrganizationCreateAccountBridgeAllowed(params: {
  authIntent: PostAuthIntent;
  normalizedAccessProfile: NormalizedAccessProfile;
  context: ResolvedPostAuthAppContext;
}): boolean {
  return (
    params.authIntent === "create_account" &&
    params.normalizedAccessProfile === "organization" &&
    params.context.normalizedAccessProfile === "organization" &&
    allowsOrganizationCustomerRegistration(params.context) &&
    !hasExistingOrganizationOrDirectAppAccess(params.context)
  );
}

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

  const context: ResolvedPostAuthAppContext | null =
    normalizedAccessProfile === "superadmin"
      ? {
          canAccess: Boolean(isSuperAdmin),
          normalizedAccessProfile: "superadmin",
          requiredOnboarding: "none",
        }
      : await getAppContext(userId, appSlug);

  if (!context) {
    return null;
  }

  if (normalizedAccessProfile === "superadmin") {
    return {
      appSlug,
      canAccess: Boolean(isSuperAdmin),
      requiredOnboarding: "none",
      normalizedAccessProfile: "superadmin",
      destination: isSuperAdmin
        ? getPostAuthRedirectPath({
            appSlug,
            isSuperAdmin,
            normalizedAccessProfile: "superadmin",
            requiredOnboarding: "none",
          })
        : buildAccessDeniedLoginPath(),
    };
  }

  const isOrganizationCreateAccountBridge =
    isOrganizationCreateAccountBridgeAllowed({
      authIntent,
      normalizedAccessProfile,
      context,
    });

  const effectiveRequiredOnboarding = isOrganizationCreateAccountBridge
    ? "organization"
    : context.requiredOnboarding;

  const effectiveCanAccess = isOrganizationCreateAccountBridge
    ? true
    : context.canAccess;

  const destination =
    effectiveRequiredOnboarding !== "none"
      ? getPostAuthRedirectPath({
          appSlug,
          isSuperAdmin,
          normalizedAccessProfile: context.normalizedAccessProfile,
          requiredOnboarding: effectiveRequiredOnboarding,
        })
      : effectiveCanAccess
        ? getPostAuthRedirectPath({
            appSlug,
            isSuperAdmin,
            normalizedAccessProfile: context.normalizedAccessProfile,
            requiredOnboarding: "none",
          })
        : buildAccessDeniedLoginPath();

  return {
    appSlug,
    canAccess: effectiveCanAccess,
    requiredOnboarding: effectiveRequiredOnboarding,
    normalizedAccessProfile: context.normalizedAccessProfile,
    destination,
  };
}
