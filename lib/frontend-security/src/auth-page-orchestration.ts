import React from "react";
import { getAuthMessage } from "@workspace/auth-ui";
import {
  AUTH_LOGIN_PATH,
  DEFAULT_POST_AUTH_PATH,
  buildAdminAccessDeniedLoginPath,
  getAuthErrorMessage,
  isFullyAuthenticatedStatus,
  parseAuthErrorCode,
  resolveAuthenticatedNextStep,
  deriveAppAuthRoutePolicy,
  useAuth,
  useCurrentPlatformAppMetadata,
  useTurnstileToken,
} from "./index";
import {
  ensureTurnstileReadyForSubmit,
  getAuthActionErrorMessage,
  handleTurnstileProtectedAuthError,
  useAuthSubmitOrchestration,
} from "./auth-form-runtime";
import {
  getMissingPasswordRequirements,
  normalizeEmailInput,
  validatePasswordInput,
} from "./authValidation";

export function getLoginDisabledReasons(input: {
  authStatus: ReturnType<typeof useAuth>["status"];
  loginInFlight: boolean;
  csrfReady: boolean;
  csrfTokenPresent: boolean;
  turnstileEnabled: boolean;
  turnstileReady: boolean;
  turnstileTokenPresent: boolean;
}) {
  const reasons: string[] = [];

  if (input.authStatus === "authenticated_fully") {
    reasons.push("auth.status===authenticated_fully");
  }

  if (input.loginInFlight) {
    reasons.push("auth.loginInFlight");
  }

  if (!input.csrfReady) {
    reasons.push("!auth.csrfReady");
  }

  if (!input.csrfTokenPresent) {
    reasons.push("!auth.csrfToken");
  }

  if (input.turnstileEnabled && !input.turnstileReady) {
    reasons.push("turnstileEnabled&&!turnstileReady");
  }

  if (input.turnstileEnabled && !input.turnstileTokenPresent) {
    reasons.push("turnstileEnabled&&!turnstileToken");
  }

  return reasons;
}

export type LoginPageVisibilityPolicy = {
  allowGoogleLogin: boolean;
  allowEmailLogin: boolean;
  allowForgotPassword: boolean;
  allowCreateAccount: boolean;
};

export function deriveLoginPageVisibilityPolicy(
  metadata: Parameters<typeof deriveAppAuthRoutePolicy>[0],
): LoginPageVisibilityPolicy {
  if (!metadata) {
    return {
      allowGoogleLogin: false,
      allowEmailLogin: false,
      allowForgotPassword: false,
      allowCreateAccount: false,
    };
  }

  const authPolicy = deriveAppAuthRoutePolicy(metadata);

  if (metadata.normalizedAccessProfile === "superadmin") {
    return {
      allowGoogleLogin: true,
      allowEmailLogin: false,
      allowForgotPassword: false,
      allowCreateAccount: false,
    };
  }

  return {
    allowGoogleLogin: true,
    allowEmailLogin: true,
    allowForgotPassword: true,
    allowCreateAccount: authPolicy.allowCustomerRegistration,
  };
}

export function useLoginRouteComposition() {
  const auth = useAuth();

  const {
    metadata,
    resolutionError,
    diagnostic,
  } = useCurrentPlatformAppMetadata();

  const turnstile = useTurnstileToken();

  const loginPageVisibility =
    deriveLoginPageVisibilityPolicy(metadata);

  const hideSignupAffordances =
    !loginPageVisibility.allowCreateAccount;

  return {
    auth,
    metadata,
    turnstile,
    loginPageVisibility,
    hideSignupAffordances,
    metadataResolutionError: resolutionError,
    metadataResolutionDiagnostic: diagnostic,
  };
}

export function useLoginRoutePolicy(options: {
  search: string;
  onRedirect: (path: string) => void;
}) {
  const { search, onRedirect } = options;

  const {
    auth,
    metadata,
    turnstile,
    loginPageVisibility,
    hideSignupAffordances,
    metadataResolutionError,
  } = useLoginRouteComposition();

  const query = React.useMemo(
    () => new URLSearchParams(search),
    [search],
  );

  const nextPath = query.get("next");

  const accessError = getAuthErrorMessage(
    parseAuthErrorCode(query.get("error")),
  );

  const metadataError = metadataResolutionError
    ? getAuthMessage("auth_metadata_unavailable")
    : null;

  const combinedAccessError =
    accessError ?? metadataError;

  const deniedCleanupAttemptedRef =
    React.useRef(false);

  React.useEffect(() => {
    if (!combinedAccessError) {
      deniedCleanupAttemptedRef.current = false;
      return;
    }

    if (!isFullyAuthenticatedStatus(auth.status)) {
      return;
    }

    if (deniedCleanupAttemptedRef.current) {
      return;
    }

    deniedCleanupAttemptedRef.current = true;

    void auth.logout();
  }, [
    combinedAccessError,
    auth.status,
    auth.logout,
  ]);

  React.useEffect(() => {
    if (!isFullyAuthenticatedStatus(auth.status)) {
      return;
    }

    const nextStep = resolveAuthenticatedNextStep({
      authStatus: auth.status,
      user: auth.user,
      continuationPath: nextPath,
      deniedLoginPath: buildAdminAccessDeniedLoginPath(),
      defaultPath: DEFAULT_POST_AUTH_PATH,
    });

    onRedirect(nextStep.destination);
  }, [
    auth.status,
    auth.user,
    nextPath,
    onRedirect,
  ]);

  return {
    auth,
    metadata,
    turnstile,
    loginPageVisibility,
    hideSignupAffordances,
    nextPath,
    accessError: combinedAccessError,
  };
}

export function useSignupRoutePolicy(options: {
  locationPath: string;
  signupPath?: string;
  onRedirect: (path: string) => void;
}) {
  const { metadata, loading } =
    useCurrentPlatformAppMetadata();

  const metadataResolved = !loading;

  const authPolicy =
    deriveAppAuthRoutePolicy(metadata);

  const signupAllowed =
    authPolicy.allowCustomerRegistration;

  const signupPath =
    options.signupPath ?? "/signup";

  React.useEffect(() => {
    if (!metadataResolved) {
      return;
    }

    if (signupAllowed) {
      return;
    }

    if (options.locationPath !== signupPath) {
      return;
    }

    options.onRedirect("/login");
  }, [
    metadataResolved,
    signupAllowed,
    options.locationPath,
    options.onRedirect,
    signupPath,
  ]);

  return {
    metadataResolved,
    signupAllowed,
  };
}

function buildVerifyEmailPath(input: {
  email: string;
  appSlug?: string;
  verifyToken?: string;
}): string {
  const query = new URLSearchParams();

  query.set("email", input.email);

  if (input.appSlug) {
    query.set("appSlug", input.appSlug);
  }

  if (input.verifyToken) {
    query.set("token", input.verifyToken);
  }

  return `/verify-email?${query.toString()}`;
}

// REMAINDER OF FILE UNCHANGED
