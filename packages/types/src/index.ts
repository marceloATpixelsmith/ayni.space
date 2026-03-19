export type AppSlug = string;

export type AppAccessMode = "restricted" | "public_signup";
export type AppTenancyMode = "none" | "organization" | "solo";
export type AppOnboardingMode = "disabled" | "required" | "light";

export type AccessStatus = "pending" | "active" | "revoked" | "suspended";
export type MembershipStatus = "invited" | "active" | "revoked" | "suspended";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export type RestrictedAppRole = "super_admin" | "support_admin" | "read_only_admin" | (string & {});
export type OrganizationAppRole = "org_owner" | "org_admin" | "staff" | (string & {});
export type SoloAppRole = "solo_user" | (string & {});

export interface AppContext {
  userId: string;
  app: {
    id: string;
    slug: AppSlug;
    accessMode: AppAccessMode;
    tenancyMode: AppTenancyMode;
    onboardingMode: AppOnboardingMode;
    invitesAllowed: boolean;
    isActive: boolean;
  };
  appAccess: {
    role: string;
    accessStatus: AccessStatus;
  } | null;
  activeOrg: {
    id: string;
    slug: string;
    name: string;
  } | null;
  orgMembership: {
    orgId: string;
    role: string;
    membershipStatus: MembershipStatus;
  } | null;
  requiredOnboarding: "none" | "organization" | "solo";
  defaultRoute: string;
}
