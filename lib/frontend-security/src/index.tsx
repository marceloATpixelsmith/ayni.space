import React from "react";
import { formatAuthMessage, getAuthMessage } from "@workspace/auth-ui";
import {
  getGetMeQueryKey,
  getMe,
  useLogout,
  setCsrfTokenProvider,
  setCsrfTokenRefresher,
  useSwitchOrganization,
  type AuthUser,
  type SwitchOrgRequest,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { beginAuthDebugFlow, getAuthFlowId, logAuthDebug } from "./authDebug";
import {
  getBootstrapAppSlug,
  getFrontendRuntimeSettings,
} from "./runtimeSettings";
import {
  ADMIN_ACCESS_DENIED_ERROR,
  AUTH_ERROR_CODES,
  AUTH_LOGIN_PATH,
  DEFAULT_POST_AUTH_PATH,
  buildAccessDeniedLoginPath as buildAdminAccessDeniedLoginPath,
  buildAuthErrorLoginPath,
  getAuthErrorMessage,
  parseAuthErrorCode,
  type AuthErrorCode,
} from "@workspace/auth";

export type AuthStatus =
  | "loading"
  | "unauthenticated"
  | "authenticated_fully"
  | "authenticated_mfa_pending_enrolled"
  | "authenticated_mfa_pending_unenrolled";

export {
  ADMIN_ACCESS_DENIED_ERROR,
  AUTH_ERROR_CODES,
  AUTH_LOGIN_PATH,
  DEFAULT_POST_AUTH_PATH,
  buildAdminAccessDeniedLoginPath,
  buildAuthErrorLoginPath,
  getAuthErrorMessage,
  parseAuthErrorCode,
};

export type { AuthErrorCode };

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  authBootstrapping: boolean;
  csrfToken: string | null;
  csrfReady: boolean;
  loginInFlight: boolean;
  refreshSession: () => Promise<void>;
  loginWithGoogle: (
    turnstileToken?: string | null,
    intent?: "sign_in" | "create_account",
    returnToPath?: string | null,
  ) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  acceptInvitation: (
    token: string,
    turnstileToken?: string | null,
  ) => Promise<string | null>;
  acceptInvitationWithPassword: (
    token: string,
    password: string,
    turnstileToken?: string | null,
  ) => Promise<string | null>;
  loginWithPassword: (
    email: string,
    password: string,
    turnstileToken?: string | null,
    returnToPath?: string | null,
  ) => Promise<void>;
  signupWithPassword: (
    email: string,
    password: string,
    turnstileToken?: string | null,
  ) => Promise<{ verifyToken?: string; appSlug?: string }>;
  forgotPassword: (
    email: string,
  ) => Promise<{ resetToken?: string }>;
  resetPassword: (
    token: string,
    password: string,
  ) => Promise<void>;
  verifyEmail: (
    token: string,
    appSlug?: string,
  ) => Promise<{
    mfaRequired?: boolean;
    needsEnrollment?: boolean;
    nextPath?: string;
  }>;
  startMfaEnrollment: () => Promise<{
    factorId: string;
    secret: string;
    otpauthUrl: string;
    issuer: string;
  }>;
  verifyMfaEnrollment: (
    factorId: string,
    code: string,
  ) => Promise<{
    recoveryCodes: string[];
    nextPath?: string;
  }>;
  completeMfaChallenge: (
    code: string,
    rememberDevice: boolean,
    stayLoggedIn?: boolean,
  ) => Promise<void>;
  completeMfaRecovery: (
    recoveryCode: string,
    rememberDevice: boolean,
    stayLoggedIn?: boolean,
  ) => Promise<void>;
};

const AuthContext =
  React.createContext<AuthContextValue | null>(null);

const SAFE_METHODS = new Set([
  "GET",
  "HEAD",
  "OPTIONS",
]);

type GoogleUrlErrorPayload = {
  url?: string;
  error?: string;
  code?: string;
} | null;

type ApiErrorPayload = {
  error?: string;
  code?: string;
} | null;

const OAUTH_START_STORAGE_KEY =
  "auth:oauth-started-at";

const AUTH_TRANSITION_STORAGE_KEY =
  "auth:session-transition-at";

const OAUTH_GRACE_WINDOW_MS =
  5 * 60 * 1000;

export function isMfaPendingStatus(
  status: AuthStatus,
): boolean {
  return (
    status ===
      "authenticated_mfa_pending_enrolled" ||
    status ===
      "authenticated_mfa_pending_unenrolled"
  );
}

export function isFullyAuthenticatedStatus(
  status: AuthStatus,
): boolean {
  return status === "authenticated_fully";
}

export function getMfaPendingRoute(
  status: AuthStatus,
):
  | "/mfa/challenge"
  | "/mfa/enroll"
  | null {
  if (
    status ===
    "authenticated_mfa_pending_enrolled"
  ) {
    return "/mfa/challenge";
  }

  if (
    status ===
    "authenticated_mfa_pending_unenrolled"
  ) {
    return "/mfa/enroll";
  }

  return null;
}

type ResolvedPostAuthDestination = {
  destination: string;
  reason:
    | "mfa_pending"
    | "continuation"
    | "onboarding_organization"
    | "onboarding_user"
    | "superadmin_policy"
    | "access_denied"
    | "default";
};

export function resolveAuthenticatedNextStep(
  params: {
    authStatus: AuthStatus;
    user: AuthUser | null;
    continuationPath?: string | null;
    deniedLoginPath?: string;
    defaultPath?: string;
  },
): ResolvedPostAuthDestination {
  if (
    isMfaPendingStatus(params.authStatus)
  ) {
    return {
      destination:
        getMfaPendingRoute(
          params.authStatus,
        ) ?? AUTH_LOGIN_PATH,
      reason: "mfa_pending",
    };
  }

  const appAccess =
    params.user &&
    typeof params.user === "object"
      ? (
          params.user as unknown as {
            appAccess?: {
              normalizedAccessProfile?:
                | "superadmin"
                | "solo"
                | "organization";
              canAccess?: boolean;
              requiredOnboarding?:
                | "none"
                | "organization"
                | "user";
            };
          }
        ).appAccess
      : undefined;

  if (
    appAccess?.requiredOnboarding ===
      "organization" &&
    !appAccess.canAccess
  ) {
    return {
      destination:
        "/onboarding/organization",
      reason:
        "onboarding_organization",
    };
  }

  if (
    appAccess?.requiredOnboarding ===
    "user"
  ) {
    return {
      destination: "/onboarding/user",
      reason: "onboarding_user",
    };
  }

  if (
    appAccess?.normalizedAccessProfile ===
    "superadmin"
  ) {
    return {
      destination:
        params.user?.isSuperAdmin
          ? DEFAULT_POST_AUTH_PATH
          : (
              params.deniedLoginPath ??
              AUTH_LOGIN_PATH
            ),
      reason: "superadmin_policy",
    };
  }

  if (
    appAccess &&
    appAccess.canAccess === false
  ) {
    return {
      destination:
        params.deniedLoginPath ??
        AUTH_LOGIN_PATH,
      reason: "access_denied",
    };
  }

  const continuationPath =
    sanitizePostAuthNavigationPath(
      params.continuationPath,
    );

  if (continuationPath) {
    return {
      destination: continuationPath,
      reason: "continuation",
    };
  }

  return {
    destination:
      params.defaultPath ??
      DEFAULT_POST_AUTH_PATH,
    reason: "default",
  };
}

export type NormalizedAccessProfile =
  | "superadmin"
  | "solo"
  | "organization";

export type AuthRouteKind =
  | "onboarding"
  | "organizationOnboarding"
  | "invitation"
  | "publicAuth"
  | "tokenAuth"
  | "customerRegistration";

export type AppAuthRoutePolicy = {
  allowOnboarding: boolean;
  allowInvitations: boolean;
  allowCustomerRegistration: boolean;
};

export type PlatformAppMetadata = {
  slug: string;
  normalizedAccessProfile: NormalizedAccessProfile;
  authRoutePolicy?: AppAuthRoutePolicy;
};

export function deriveAppAuthRoutePolicy(
  app:
    | PlatformAppMetadata
    | null
    | undefined,
): AppAuthRoutePolicy {
  if (!app) {
    return {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration:
        false,
    };
  }

  if (app.authRoutePolicy) {
    return {
      allowOnboarding:
        app.authRoutePolicy
          .allowOnboarding,
      allowInvitations:
        app.authRoutePolicy
          .allowInvitations,
      allowCustomerRegistration:
        app.authRoutePolicy
          .allowCustomerRegistration,
    };
  }

  if (
    app.normalizedAccessProfile ===
    "superadmin"
  ) {
    return {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration:
        false,
    };
  }

  if (
    app.normalizedAccessProfile ===
    "solo"
  ) {
    return {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration: true,
    };
  }

  if (
    app.normalizedAccessProfile ===
    "organization"
  ) {
    return {
      allowOnboarding: true,
      allowInvitations: false,
      allowCustomerRegistration:
        false,
    };
  }

  return {
    allowOnboarding: false,
    allowInvitations: false,
    allowCustomerRegistration: false,
  };
}

function getAuthRoutePolicyForNormalizedProfile(
  input: {
    normalizedAccessProfile: NormalizedAccessProfile;
    staffInvitesEnabled: boolean;
    customerRegistrationEnabled: boolean;
  },
): AppAuthRoutePolicy {
  if (
    input.normalizedAccessProfile ===
    "superadmin"
  ) {
    return {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration:
        false,
    };
  }

  if (
    input.normalizedAccessProfile ===
    "solo"
  ) {
    return {
      allowOnboarding: false,
      allowInvitations: false,
      allowCustomerRegistration: true,
    };
  }

  return {
    allowOnboarding: true,
    allowInvitations:
      input.staffInvitesEnabled ===
      true,
    allowCustomerRegistration:
      input.customerRegistrationEnabled ===
      true,
  };
}
