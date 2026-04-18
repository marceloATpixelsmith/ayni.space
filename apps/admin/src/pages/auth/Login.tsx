import React from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useLoginRoutePolicy,
  useLoginRouteActions,
  useEmailValidationInteraction,
  validateEmailInput,
  getLoginDisabledReasons,
} from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { ActivitySquare } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import {
  AuthFormMotion,
  AuthMethodDivider,
  GoogleAuthButton,
  AuthShell,
  AuthTurnstileSection,
  FieldValidationMessage,
  AuthStatusMessage,
} from "@workspace/auth-ui";

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [emailInput, setEmailInput] = React.useState("");
  const [passwordInput, setPasswordInput] = React.useState("");
  const emailValidation = useEmailValidationInteraction({
    value: emailInput,
    validate: validateEmailInput,
  });
  const { auth, turnstile, hideSignupAffordances, nextPath, accessError } =
    useLoginRoutePolicy({
      search,
      onRedirect: setLocation,
    });

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
  const { loginError, handleGoogleLogin, handlePasswordLogin } =
    useLoginRouteActions({
      auth,
      turnstile,
      nextPath,
      hideSignupAffordances,
      email: emailInput,
      password: passwordInput,
      emailError,
    });

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <ActivitySquare className="w-10 h-10 text-primary animate-pulse" />
      </div>
    );
  }

  const onPasswordLogin = () => {
    emailValidation.markSubmitted();
    handlePasswordLogin();
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
            onClick={onPasswordLogin}
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

        <AuthStatusMessage message={accessError} tone="error" align="center" />
        <AuthStatusMessage message={loginError} tone="error" align="center" />
      </AuthFormMotion>
    </AuthShell>
  );
}
