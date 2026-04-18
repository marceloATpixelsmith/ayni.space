import React from "react";
import {
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
  if (input.loginInFlight) reasons.push("auth.loginInFlight");
  if (!input.csrfReady) reasons.push("!auth.csrfReady");
  if (!input.csrfTokenPresent) reasons.push("!auth.csrfToken");
  if (input.turnstileEnabled && !input.turnstileReady) reasons.push("turnstileEnabled&&!turnstileReady");
  if (input.turnstileEnabled && !input.turnstileTokenPresent) reasons.push("turnstileEnabled&&!turnstileToken");
  return reasons;
}

export function useLoginRouteComposition() {
  const auth = useAuth();
  const { metadata } = useCurrentPlatformAppMetadata();
  const turnstile = useTurnstileToken();

  const hideSignupAffordances =
    metadata?.authRoutePolicy?.allowCustomerRegistration === false ||
    metadata?.normalizedAccessProfile === "superadmin";

  return {
    auth,
    metadata,
    turnstile,
    hideSignupAffordances,
  };
}

export function useLoginRoutePolicy(options: {
  search: string;
  onRedirect: (path: string) => void;
}) {
  const { search, onRedirect } = options;
  const { auth, metadata, turnstile, hideSignupAffordances } =
    useLoginRouteComposition();
  const query = React.useMemo(
    () => new URLSearchParams(search),
    [search],
  );
  const nextPath = query.get("next");
  const accessError = getAuthErrorMessage(parseAuthErrorCode(query.get("error")));
  const deniedCleanupAttemptedRef = React.useRef(false);

  React.useEffect(() => {
    if (!accessError) {
      deniedCleanupAttemptedRef.current = false;
      return;
    }
    if (!isFullyAuthenticatedStatus(auth.status)) return;
    if (deniedCleanupAttemptedRef.current) return;

    deniedCleanupAttemptedRef.current = true;
    void auth.logout();
  }, [accessError, auth.status, auth.logout]);

  React.useEffect(() => {
    if (!isFullyAuthenticatedStatus(auth.status)) return;

    const nextStep = resolveAuthenticatedNextStep({
      authStatus: auth.status,
      user: auth.user,
      continuationPath: nextPath,
      deniedLoginPath: buildAdminAccessDeniedLoginPath(),
      defaultPath: DEFAULT_POST_AUTH_PATH,
    });
    onRedirect(nextStep.destination);
  }, [auth.status, auth.user, nextPath, onRedirect]);

  return {
    auth,
    metadata,
    turnstile,
    hideSignupAffordances,
    nextPath,
    accessError,
  };
}

export function useSignupRoutePolicy(options: {
  locationPath: string;
  signupPath?: string;
  onRedirect: (path: string) => void;
}) {
  const { metadata, loading } = useCurrentPlatformAppMetadata();
  const metadataResolved = !loading;
  const signupAllowed = deriveAppAuthRoutePolicy(metadata).allowCustomerRegistration;
  const signupPath = options.signupPath ?? "/signup";

  React.useEffect(() => {
    if (!metadataResolved || signupAllowed) return;
    if (options.locationPath !== signupPath) return;
    options.onRedirect("/login");
  }, [metadataResolved, signupAllowed, options.locationPath, options.onRedirect, signupPath]);

  return {
    metadataResolved,
    signupAllowed,
  };
}
