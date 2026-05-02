import React from "react";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { validatePasswordInput } from "@workspace/frontend-security";
import {
  AuthShell,
  FieldValidationMessage,
  AuthFormMotion,
  AuthStatusMessage,
  AuthI18nProvider,
  useAuthI18n,
} from "@workspace/auth-ui";

function ResetPasswordContent() {
  const { t } = useAuthI18n();
  const auth = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = React.useMemo(() => new URLSearchParams(search).get("token") ?? "", [search]);
  const [password, setPassword] = React.useState("");
  const [passwordTouched, setPasswordTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const passwordError = (passwordTouched || submitted) ? validatePasswordInput(password) : null;

  const submit = () => {
    setSubmitted(true);
    if (passwordError) {
      setMessage(passwordError);
      return;
    }
    auth.resetPassword(token, password).then(() => {
      setMessage(t("reset_password_success_redirecting", "Password reset complete. Redirecting to login..."));
      setTimeout(() => setLocation("/login"), 800);
    }).catch((err) => setMessage(err instanceof Error ? err.message : t("reset_password_error_fallback", "Unable to reset password.")));
  };

  return (
    <AuthShell
      title={t("reset_password_title", "Reset password")}
      subtitle={t("reset_password_subtitle", "Create a new strong password to secure your account.")}
    >
      <AuthFormMotion>
        <div className="space-y-3">
          <PasswordInput className="w-full border rounded px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => setPasswordTouched(true)} placeholder={t("reset_password_new_password_placeholder", "New password")} autoComplete="new-password" aria-invalid={Boolean(passwordError)} aria-describedby={passwordError ? "reset-password-error" : undefined} />
          <FieldValidationMessage id="reset-password-error" message={passwordError} />
          <Button className="w-full" onClick={submit}>{t("reset_password_submit_button", "Reset password")}</Button>
        </div>
        <AuthStatusMessage message={message} />
      </AuthFormMotion>
    </AuthShell>
  );
}

export default function ResetPassword() {
  return (
    <AuthI18nProvider>
      <ResetPasswordContent />
    </AuthI18nProvider>
  );
}
