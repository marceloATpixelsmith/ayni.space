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

function shouldUseOrganizationCustomerRegistrationBridge(options: {
  authIntent: PostAuthIntent;
  normalizedAccessProfile: NormalizedAccessProfile;
  context: ResolvedPostAuthAppContext;
}): boolean {
  return (
    options.normalizedAccessProfile === "organization" &&
    options.context.normalizedAccessProfile === "organization" &&
    allowsOrganizationCustomerRegistration(options.context) &&
    !hasExistingOrganizationOrDirectAppAccess(options.context)
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

  if (!context) return null;

  const usesOrganizationCustomerRegistrationBridge =
    shouldUseOrganizationCustomerRegistrationBridge({
      authIntent,
      normalizedAccessProfile,
      context,
    });

  const effectiveRequiredOnboarding =
    usesOrganizationCustomerRegistrationBridge && authIntent === "create_account"
      ? "organization"
      : usesOrganizationCustomerRegistrationBridge
        ? "none"
        : context.requiredOnboarding;

  const effectiveCanAccess =
    usesOrganizationCustomerRegistrationBridge
      ? true
      : context.canAccess;

  const destination =
    effectiveCanAccess || effectiveRequiredOnboarding !== "none"
      ? getPostAuthRedirectPath({
          appSlug,
          isSuperAdmin,
          normalizedAccessProfile: context.normalizedAccessProfile,
          requiredOnboarding: effectiveRequiredOnboarding,
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
