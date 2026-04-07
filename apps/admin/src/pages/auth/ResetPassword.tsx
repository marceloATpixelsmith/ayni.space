import React from "react";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { validatePasswordInput } from "./authValidation";
import { AuthShell } from "@workspace/auth-ui";
import { FieldValidationMessage } from "@workspace/auth-ui";

export default function ResetPassword() {
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
      setMessage("Password reset complete. Redirecting to login...");
      setTimeout(() => setLocation("/login"), 800);
    }).catch((err) => setMessage(err instanceof Error ? err.message : "Unable to reset password."));
  };

  return (
    <AuthShell title="Reset password" subtitle="Create a new strong password to secure your account.">
      <div className="space-y-3">
        <PasswordInput className="w-full border rounded px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => setPasswordTouched(true)} placeholder="New password" autoComplete="new-password" aria-invalid={Boolean(passwordError)} aria-describedby={passwordError ? "reset-password-error" : undefined} />
        <FieldValidationMessage id="reset-password-error" message={passwordError} />
        <Button className="w-full" onClick={submit}>Reset password</Button>
      </div>
      {message ? <p className="text-sm mt-4">{message}</p> : null}
    </AuthShell>
  );
}
