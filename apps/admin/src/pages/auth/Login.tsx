import React from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  fetchPlatformAppMetadataBySlug,
  isFullyAuthenticatedStatus,
  resolveAuthenticatedNextStep,
  resolveCurrentAppSlug,
  useAuth,
  useTurnstileToken,
} from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { ActivitySquare } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import {
  ADMIN_ACCESS_DENIED_ERROR,
  ADMIN_ACCESS_DENIED_MESSAGE,
  adminAccessDeniedLoginPath,
} from "./accessDenied";
import { validateEmailInput } from "./authValidation";
import {
  AuthFormMotion,
  AuthMethodDivider,
  GoogleAuthButton,
  AuthShell,
  AuthTurnstileSection,
  FieldValidationMessage,
} from "@workspace/auth-ui";

const AUTH_DEBUG =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_AUTH_DEBUG === "true";
const CURRENT_APP_SLUG = resolveCurrentAppSlug();

export function getLoginDisabledReasons(input: {
  authStatus: string;
  loginInFlight: boolean;
  csrfReady: boolean;
  csrfTokenPresent: boolean;
  turnstileEnabled: boolean;
  turnstileReady: boolean;
  turnstileTokenPresent: boolean;
  turnstileCanSubmit: boolean;
}) {
  const reasons: string[] = [];
  if (input.authStatus === "authenticated_fully")
    reasons.push("auth.status===authenticated_fully");
  if (input.loginInFlight) reasons.push("auth.loginInFlight");
  if (!input.csrfReady) reasons.push("!auth.csrfReady");
  if (!input.csrfTokenPresent) reasons.push("!auth.csrfToken");
  if (input.turnstileEnabled && !input.turnstileReady) reasons.push("turnstileEnabled&&!turnstileReady");
  if (input.turnstileEnabled && !input.turnstileTokenPresent) reasons.push("turnstileEnabled&&!turnstileToken");
  return reasons;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [emailInput, setEmailInput] = React.useState("");
  const [passwordInput, setPasswordInput] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [hideSignupAffordances, setHideSignupAffordances] =
    React.useState(true);
  const deniedCleanupAttemptedRef = React.useRef(false);
  const auth = useAuth();
  const {
    token: turnstileToken,
    enabled: turnstileEnabled,
    ready: turnstileReady,
    status: turnstileStatus,
    guidanceMessage: turnstileGuidanceMessage,
    canSubmit: turnstileCanSubmit,
    reset: resetTurnstile,
    TurnstileWidget,
  } = useTurnstileToken();

  const query = React.useMemo(() => new URLSearchParams(search), [search]);
  const nextPath = query.get("next");
  const accessErrorCode = query.get("error");
  const accessError = accessErrorCode === ADMIN_ACCESS_DENIED_ERROR ? ADMIN_ACCESS_DENIED_MESSAGE : null;
  const emailError =
    emailTouched || submitted ? validateEmailInput(emailInput) : null;

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
    let cancelled = false;
    if (!CURRENT_APP_SLUG) {
      setHideSignupAffordances(true);
      return;
    }

    fetchPlatformAppMetadataBySlug(CURRENT_APP_SLUG)
      .then((metadata) => {
        if (cancelled) return;
        setHideSignupAffordances(
          metadata?.normalizedAccessProfile === "superadmin",
        );
      })
      .catch(() => {
        if (cancelled) return;
        setHideSignupAffordances(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (AUTH_DEBUG) {
      console.info("[login] mount");
      return () => console.info("[login] cleanup");
    }
    return undefined;
  }, []);

  React.useEffect(() => {
    if (isFullyAuthenticatedStatus(auth.status)) {
      const nextStep = resolveAuthenticatedNextStep({
        authStatus: auth.status,
        user: auth.user,
        continuationPath: nextPath,
        deniedLoginPath: adminAccessDeniedLoginPath(),
        defaultPath: "/dashboard",
      });
      setLocation(nextStep.destination);
    }
  }, [auth.status, auth.user, setLocation, nextPath]);

  const disabledReasons = React.useMemo(
    () =>
      getLoginDisabledReasons({
        authStatus: auth.status,
        loginInFlight: auth.loginInFlight,
        csrfReady: auth.csrfReady,
        csrfTokenPresent: Boolean(auth.csrfToken),
        turnstileEnabled,
        turnstileTokenPresent: Boolean(turnstileToken),
        turnstileCanSubmit,
        turnstileReady,
      }),
    [
      auth.status,
      auth.loginInFlight,
      auth.csrfReady,
      auth.csrfToken,
      turnstileCanSubmit,
      turnstileEnabled,
      turnstileReady,
      turnstileToken,
    ],
  );

  React.useEffect(() => {
    if (!AUTH_DEBUG) return;
    const script = document.getElementById("cf-turnstile-script");
    console.info("[login] render state", {
      authStatus: auth.status,
      csrfReady: auth.csrfReady,
      csrfTokenPresent: Boolean(auth.csrfToken),
      turnstileEnabled,
      turnstileReady,
      turnstileTokenPresent: Boolean(turnstileToken),
      turnstileStatus,
      loginInFlight: auth.loginInFlight,
      windowTurnstileExists: Boolean(window.turnstile),
      turnstileScriptExists: Boolean(script),
      turnstileContainerExists: Boolean(document.querySelector(".min-h-16")),
      disabledReasons,
    });
  }, [
    auth.status,
    auth.csrfReady,
    auth.csrfToken,
    turnstileEnabled,
    turnstileReady,
    turnstileToken,
    turnstileStatus,
    auth.loginInFlight,
    disabledReasons,
  ]);

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <ActivitySquare className="w-10 h-10 text-primary animate-pulse" />
      </div>
    );
  }

  const handlePasswordLogin = () => {
    setSubmitted(true);
    if (emailError) {
      setLoginError(emailError);
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      setLoginError("Please complete the verification challenge.");
      return;
    }

    setLoginError(null);
    auth.loginWithPassword(emailInput, passwordInput, turnstileToken, nextPath).catch((error) => {
      setLoginError(
        error instanceof Error ? error.message : "Unable to sign in.",
      );
    });
  };

  const handleGoogleLogin = (intent: "sign_in" | "create_account") => {
    if (auth.loginInFlight) {
      return;
    }
    if (hideSignupAffordances && intent === "create_account") {
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      setLoginError("Please complete the verification challenge.");
      return;
    }

    setLoginError(null);
    auth.loginWithGoogle(turnstileToken, intent, nextPath).catch((error) => {
      const message =
        error instanceof Error
          ? error instanceof TypeError ||
            /Failed to fetch|NetworkError|Load failed/i.test(error.message)
            ? "Unable to reach the sign-in service. Please verify network/CORS configuration and try again."
            : error.message
          : "Unable to start Google sign-in right now. Please try again.";
      setLoginError(message);
      if (turnstileEnabled) resetTurnstile();
    });
  };

  return (
    <AuthShell
      title="Welcome"
      subtitle={
        hideSignupAffordances
          ? "Sign in to continue."
          : "Sign in or create your account to continue."
      }
    >
      <AuthFormMotion>
        <GoogleAuthButton
          onClick={() => handleGoogleLogin("sign_in")}
          disabled={disabledReasons.length > 0}
          loading={auth.loginInFlight}
          idleLabel="Sign in with Google"
          loadingLabel="Starting Google sign-in..."
        />

        {!hideSignupAffordances ? (
          <GoogleAuthButton
            variant="outline"
            className="mt-3"
            onClick={() => handleGoogleLogin("create_account")}
            disabled={disabledReasons.length > 0}
            loading={auth.loginInFlight}
            idleLabel="Create account with Google"
            loadingLabel="Starting account setup..."
          />
        ) : null}

        <AuthMethodDivider />

        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onBlur={() => setEmailTouched(true)}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "login-email-error" : undefined}
          />
          <FieldValidationMessage id="login-email-error" message={emailError} />
          <PasswordInput
            className="w-full border rounded px-3 py-2"
            placeholder="Password"
            autoComplete="current-password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
          />
          <Button
            className="w-full"
            onClick={handlePasswordLogin}
            disabled={
              auth.loginInFlight ||
              !emailInput ||
              !passwordInput ||
              Boolean(validateEmailInput(emailInput)) ||
              !turnstileCanSubmit
            }
          >
            Sign in with email
          </Button>
          <div className="text-sm flex justify-between">
            {!hideSignupAffordances ? (
              <Link href="/signup">Create account</Link>
            ) : (
              <span />
            )}
            <Link href="/forgot-password">Forgot password?</Link>
          </div>
        </div>

        <AuthTurnstileSection
          enabled={turnstileEnabled}
          TurnstileWidget={TurnstileWidget}
          guidanceMessage={turnstileGuidanceMessage}
          status={turnstileStatus}
        />

        {accessError ? (
          <p className="mt-4 text-sm text-destructive text-center" role="alert">
            {accessError}
          </p>
        ) : null}
        {loginError ? (
          <p className="mt-4 text-sm text-destructive text-center" role="alert">
            {loginError}
          </p>
        ) : null}
      </AuthFormMotion>
    </AuthShell>
  );
}
