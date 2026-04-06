import type { App } from "@workspace/db";

export type NormalizedAccessProfile = "superadmin" | "solo" | "organization";

export type AuthRoutePolicy = {
  allowOnboarding: boolean;
  allowInvitations: boolean;
  allowCustomerRegistration: boolean;
};

export function resolveNormalizedAccessProfile(app: Pick<App, "accessMode">): NormalizedAccessProfile | null {
  if (app.accessMode === "superadmin") return "superadmin";
  if (app.accessMode === "solo") return "solo";
  if (app.accessMode === "organization") return "organization";
  return null;
}

export function getAuthRoutePolicyForProfile(
  profile: NormalizedAccessProfile,
  organizationCapabilities: Pick<App, "staffInvitesEnabled" | "customerRegistrationEnabled">,
): AuthRoutePolicy {
  if (profile === "organization") {
    return {
      allowOnboarding: true,
      allowInvitations: organizationCapabilities.staffInvitesEnabled,
      // Customer registration APIs are not implemented yet; keep policy fail-closed.
      allowCustomerRegistration: false,
    };
  }

  if (profile === "solo") {
    return { allowOnboarding: true, allowInvitations: false, allowCustomerRegistration: false };
  }

  return { allowOnboarding: false, allowInvitations: false, allowCustomerRegistration: false };
}
