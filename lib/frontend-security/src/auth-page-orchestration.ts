import React from "react";
import {
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
