export type AppSlug = string;

export type AppAccessMode = "superadmin" | "solo" | "organization";

export type AccessStatus = "pending" | "active" | "revoked" | "suspended";
export type MembershipStatus = "invited" | "active" | "revoked" | "suspended";
export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export type SuperadminAppRole = "super_admin" | "support_admin" | "read_only_admin" | (string & {});
export type OrganizationAppRole = "org_owner" | "org_admin" | "staff" | (string & {});
export type SoloAppRole = "solo_user" | (string & {});

export interface AppContext {
  userId: string;
  app: {
    id: string;
    slug: AppSlug;
    accessMode: AppAccessMode;
    staffInvitesEnabled: boolean;
    customerRegistrationEnabled: boolean;
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
  requiredOnboarding: "none" | "organization";
  defaultRoute: string;
}
