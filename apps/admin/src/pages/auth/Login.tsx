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
  AuthI18nProvider,
  useAuthI18n,
} from "@workspace/auth-ui";

function LoginContent() {
  const { t } = useAuthI18n();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [emailInput, setEmailInput] = React.useState("");
  const [passwordInput, setPasswordInput] = React.useState("");
  const emailValidation = useEmailValidationInteraction({
    value: emailInput,
    validate: validateEmailInput,
  });
  const {
    auth,
    turnstile,
    loginPageVisibility,
    hideSignupAffordances,
    nextPath,
    accessError,
  } = useLoginRoutePolicy({
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
      allowCreateAccount: loginPageVisibility.allowCreateAccount,
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
      title={t("login_title")}
      subtitle={
        hideSignupAffordances
          ? t("login_subtitle_sign_in_only")
          : t("login_subtitle_with_signup")
      }
    >
      <AuthFormMotion>
        {loginPageVisibility.allowGoogleLogin ? (
          <GoogleAuthButton
            onClick={() => handleGoogleLogin("sign_in")}
            disabled={disabledReasons.length > 0}
            loading={false}
            idleLabel={
              auth.loginInFlight
                ? t("login_google_sign_in_loading")
                : t("login_google_sign_in_idle")
            }
            loadingLabel={t("login_google_sign_in_loading")}
          />
        ) : null}

        {loginPageVisibility.allowCreateAccount ? (
          <GoogleAuthButton
            variant="outline"
            className="mt-3"
            onClick={() => handleGoogleLogin("create_account")}
            disabled={disabledReasons.length > 0}
            loading={auth.loginInFlight}
            idleLabel={t("login_google_create_account_idle")}
            loadingLabel={t("login_google_create_account_loading")}
          />
        ) : null}

        {loginPageVisibility.allowGoogleLogin &&
        loginPageVisibility.allowEmailLogin ? (
          <AuthMethodDivider />
        ) : null}

        {loginPageVisibility.allowEmailLogin ? (
          <div className="space-y-3">
            <input
              className="w-full border rounded px-3 py-2"
              placeholder={t("login_email_placeholder")}
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onBlur={emailValidation.markTouched}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "login-email-error" : undefined}
            />
            <FieldValidationMessage
              id="login-email-error"
              message={emailError}
            />
            <PasswordInput
              className="w-full border rounded px-3 py-2"
              placeholder={t("login_password_placeholder")}
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
              {t("login_email_button")}
            </Button>
            <div className="text-sm flex justify-between">
              {loginPageVisibility.allowCreateAccount ? (
                <Link href="/signup">{t("login_create_account_link")}</Link>
              ) : (
                <span />
              )}
              {loginPageVisibility.allowForgotPassword ? (
                <Link href="/forgot-password">
                  {t("login_forgot_password_link")}
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <AuthTurnstileSection
          enabled={turnstile.enabled}
          TurnstileWidget={turnstile.TurnstileWidget}
          guidanceMessage={turnstile.guidanceMessage ?? undefined}
          status={turnstile.status}
        />

        <AuthStatusMessage
          message={accessError}
          tone="error"
          align="center"
          role="alert"
        />
        <AuthStatusMessage message={loginError} tone="error" align="center" />
      </AuthFormMotion>
    </AuthShell>
  );
}

export default function Login() {
  return (
    <AuthI18nProvider>
      <LoginContent />
    </AuthI18nProvider>
  );
}
