import React from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useLoginRouteComposition,
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

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [emailInput, setEmailInput] = React.useState("");
  const [passwordInput, setPasswordInput] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  const query = React.useMemo(() => new URLSearchParams(search), [search]);
  const nextPath = query.get("next");
  const accessErrorCode = query.get("error");
  const accessError =
    accessErrorCode === ADMIN_ACCESS_DENIED_ERROR
      ? ADMIN_ACCESS_DENIED_MESSAGE
      : null;

  const { auth, turnstile, hideSignupAffordances, disabledReasons } =
    useLoginRouteComposition({
      nextPath,
      accessErrorPresent: Boolean(accessError),
      deniedLoginPath: adminAccessDeniedLoginPath(),
      defaultPath: "/dashboard",
      onNavigate: setLocation,
    });

  const emailError =
    emailTouched || submitted ? validateEmailInput(emailInput) : null;

  React.useEffect(() => {
    if (AUTH_DEBUG) {
      console.info("[login] mount");
      return () => console.info("[login] cleanup");
    }
    return undefined;
  }, []);

  React.useEffect(() => {
    if (!AUTH_DEBUG) return;
    const script = document.getElementById("cf-turnstile-script");
    console.info("[login] render state", {
      authStatus: auth.status,
      csrfReady: auth.csrfReady,
      csrfTokenPresent: Boolean(auth.csrfToken),
      turnstileEnabled: turnstile.enabled,
      turnstileReady: turnstile.ready,
      turnstileTokenPresent: Boolean(turnstile.token),
      turnstileStatus: turnstile.status,
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
    turnstile.enabled,
    turnstile.ready,
    turnstile.token,
    turnstile.status,
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
    if (turnstile.enabled && !turnstile.token) {
      setLoginError("Please complete the verification challenge.");
      return;
    }

    setLoginError(null);
    auth
      .loginWithPassword(emailInput, passwordInput, turnstile.token, nextPath)
      .catch((error) => {
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
    if (turnstile.enabled && !turnstile.token) {
      setLoginError("Please complete the verification challenge.");
      return;
    }

    setLoginError(null);
    auth.loginWithGoogle(turnstile.token, intent, nextPath).catch((error) => {
      const message =
        error instanceof Error
          ? error instanceof TypeError ||
            /Failed to fetch|NetworkError|Load failed/i.test(error.message)
            ? "Unable to reach the sign-in service. Please verify network/CORS configuration and try again."
            : error.message
          : "Unable to start Google sign-in right now. Please try again.";
      setLoginError(message);
      if (turnstile.enabled) turnstile.reset();
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
          loading={false}
          idleLabel={
            auth.loginInFlight ? "Starting Google sign-in..." : "Sign in with Google"
          }
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
              !turnstile.canSubmit
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
          enabled={turnstile.enabled}
          TurnstileWidget={turnstile.TurnstileWidget}
          guidanceMessage={turnstile.guidanceMessage ?? undefined}
          status={turnstile.status}
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
