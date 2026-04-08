import React from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  DEFAULT_POST_AUTH_PATH,
  isFullyAuthenticatedStatus,
  resolveAuthenticatedNextStep,
  useLoginRouteComposition,
  parseAuthErrorCode,
  useEmailValidationInteraction,
  ensureTurnstileReadyForSubmit,
  resetTurnstileOnFailure,
  useAuthSubmitOrchestration,
  validateEmailInput,
} from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { ActivitySquare } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import {
  ADMIN_ACCESS_DENIED_ERROR,
  ADMIN_ACCESS_DENIED_MESSAGE,
  adminAccessDeniedLoginPath,
} from "./accessDenied";
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

function getLoginDisabledReasons(input: {
  authStatus: ReturnType<typeof useLoginRouteComposition>["auth"]["status"];
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

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [emailInput, setEmailInput] = React.useState("");
  const [passwordInput, setPasswordInput] = React.useState("");
  const submit = useAuthSubmitOrchestration();
  const emailValidation = useEmailValidationInteraction({
    value: emailInput,
    validate: validateEmailInput,
  });

  const query = React.useMemo(() => new URLSearchParams(search), [search]);
  const nextPath = query.get("next");
  const accessErrorCode = parseAuthErrorCode(query.get("error"));
  const accessError = accessErrorCode === ADMIN_ACCESS_DENIED_ERROR ? ADMIN_ACCESS_DENIED_MESSAGE : null;

  const { auth, turnstile, hideSignupAffordances } =
    useLoginRouteComposition({
      accessErrorPresent: Boolean(accessError),
    });
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
      deniedLoginPath: adminAccessDeniedLoginPath(),
      defaultPath: DEFAULT_POST_AUTH_PATH,
    });
    setLocation(nextStep.destination);
  }, [auth.status, auth.user, nextPath, setLocation]);

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

  const emailError = emailValidation.error;

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
      canSubmit: turnstile.canSubmit,
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
    turnstile.canSubmit,
  ]);

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <ActivitySquare className="w-10 h-10 text-primary animate-pulse" />
      </div>
    );
  }

  const handlePasswordLogin = () => {
    emailValidation.markSubmitted();
    if (emailError) {
      setLoginError(emailError);
      return;
    }
    const turnstileError = ensureTurnstileReadyForSubmit(turnstile);
    if (turnstileError) {
      setLoginError(turnstileError);
      return;
    }

    setLoginError(null);
    const turnstileToken = turnstile.token;
    void submit
      .run(() => auth.loginWithPassword(emailInput, passwordInput, turnstileToken, nextPath))
      .catch((error) => {
        setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
      });
  };

  const handleGoogleLogin = (intent: "sign_in" | "create_account") => {
    if (auth.loginInFlight) {
      return;
    }
    if (hideSignupAffordances && intent === "create_account") {
      return;
    }
    const turnstileError = ensureTurnstileReadyForSubmit(turnstile);
    if (turnstileError) {
      setLoginError(turnstileError);
      return;
    }

    setLoginError(null);
    const turnstileToken = turnstile.token;
    const oauthUrlRequest = { token: turnstileToken };
    if (!oauthUrlRequest.token) {
      setLoginError("Please complete verification before continuing.");
      return;
    }
    void submit.run(() => auth.loginWithGoogle(turnstileToken, intent, nextPath)).catch((error) => {
      const message =
        error instanceof Error
          ? error instanceof TypeError ||
            /Failed to fetch|NetworkError|Load failed/i.test(error.message)
            ? "Unable to reach the sign-in service. Please verify network/CORS configuration and try again."
            : error.message
          : "Unable to start Google sign-in right now. Please try again.";
      setLoginError(message);
      resetTurnstileOnFailure(turnstile);
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
          idleLabel={auth.loginInFlight ? "Starting Google sign-in..." : "Sign in with Google"}
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
            onBlur={emailValidation.markTouched}
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
