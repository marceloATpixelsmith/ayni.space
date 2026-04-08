import React from "react";
import {
  deriveAppAuthRoutePolicy,
  useAuth,
  useCurrentPlatformAppMetadata,
  useTurnstileToken,
} from "./index";

export function useLoginRouteComposition(options: {
  accessErrorPresent?: boolean;
}) {
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
