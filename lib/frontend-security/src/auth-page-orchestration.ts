import React from "react";
import {
  isFullyAuthenticatedStatus,
  resolveAuthenticatedNextStep,
  useAuth,
  useCurrentPlatformAppMetadata,
  useTurnstileToken,
  type AuthStatus,
  type AuthUser,
} from "./index";

export function getLoginDisabledReasons(input: {
  authStatus: AuthStatus;
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
  if (input.turnstileEnabled && !input.turnstileReady) {
    reasons.push("turnstileEnabled&&!turnstileReady");
  }
  if (input.turnstileEnabled && !input.turnstileTokenPresent) {
    reasons.push("turnstileEnabled&&!turnstileToken");
  }
  return reasons;
}

export function useLoginRouteComposition(options: {
  nextPath: string | null;
  accessErrorPresent: boolean;
  deniedLoginPath: string;
  defaultPath?: string;
  onNavigate: (path: string) => void;
}) {
  const auth = useAuth();
  const { metadata } = useCurrentPlatformAppMetadata();
  const turnstile = useTurnstileToken();
  const deniedCleanupAttemptedRef = React.useRef(false);

  const hideSignupAffordances =
    metadata?.normalizedAccessProfile === "superadmin";

  React.useEffect(() => {
    if (!options.accessErrorPresent) {
      deniedCleanupAttemptedRef.current = false;
      return;
    }
    if (!isFullyAuthenticatedStatus(auth.status)) return;
    if (deniedCleanupAttemptedRef.current) return;

    deniedCleanupAttemptedRef.current = true;
    void auth.logout();
  }, [options.accessErrorPresent, auth.status, auth.logout]);

  React.useEffect(() => {
    if (!isFullyAuthenticatedStatus(auth.status)) return;

    const nextStep = resolveAuthenticatedNextStep({
      authStatus: auth.status,
      user: auth.user as AuthUser | null,
      continuationPath: options.nextPath,
      deniedLoginPath: options.deniedLoginPath,
      defaultPath: options.defaultPath ?? "/dashboard",
    });
    options.onNavigate(nextStep.destination);
  }, [
    auth.status,
    auth.user,
    options.onNavigate,
    options.nextPath,
    options.deniedLoginPath,
    options.defaultPath,
  ]);

  const disabledReasons = React.useMemo(
    () =>
      getLoginDisabledReasons({
        authStatus: auth.status,
        loginInFlight: auth.loginInFlight,
        csrfReady: auth.csrfReady,
        csrfTokenPresent: Boolean(auth.csrfToken),
        turnstileEnabled: turnstile.enabled,
        turnstileReady: turnstile.ready,
        turnstileTokenPresent: Boolean(turnstile.token),
      }),
    [
      auth.status,
      auth.loginInFlight,
      auth.csrfReady,
      auth.csrfToken,
      turnstile.enabled,
      turnstile.ready,
      turnstile.token,
    ],
  );

  return {
    auth,
    turnstile,
    hideSignupAffordances,
    disabledReasons,
  };
}

export function useSignupRoutePolicy(options: {
  locationPath: string;
  signupPath?: string;
  onRedirect: (path: string) => void;
}) {
  const { metadata, loading } = useCurrentPlatformAppMetadata();
  const metadataResolved = !loading;
  const signupAllowed = metadata?.normalizedAccessProfile !== "superadmin";
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
