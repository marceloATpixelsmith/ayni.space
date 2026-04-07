import React from "react";
import { useLocation } from "wouter";
import {
  useAuth,
  useSignupRoutePolicy,
  useTurnstileToken,
} from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import {
  getMissingPasswordRequirements,
  normalizeEmailInput,
  validateEmailInput,
  validatePasswordInput,
} from "./authValidation";
import {
  AuthFormMotion,
  AuthShell,
  AuthTurnstileSection,
  FieldValidationMessage,
} from "@workspace/auth-ui";

export default function Signup() {
  const auth = useAuth();
  const [location, setLocation] = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const turnstile = useTurnstileToken();

  const { metadataResolved, signupAllowed } = useSignupRoutePolicy({
    locationPath: location,
    signupPath: "/signup",
    onRedirect: setLocation,
  });

  const emailError =
    emailTouched || submitted ? validateEmailInput(email) : null;
  const shouldShowPasswordFeedback = password.length > 0;
  const missingPasswordRequirements = getMissingPasswordRequirements(password);

  if (!metadataResolved || !signupAllowed) {
    return null;
  }

  const onSubmit = () => {
    setSubmitted(true);
    if (!auth.csrfReady || !auth.csrfToken) {
      setError(
        "Security token is not ready. Please wait a moment and try again.",
      );
      return;
    }
    if (emailError) {
      setError(emailError);
      return;
    }
    const passwordError = validatePasswordInput(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (turnstile.enabled && !turnstile.token) {
      setError("Please complete the verification challenge.");
      return;
    }

    setError(null);
    const normalizedEmail = normalizeEmailInput(email);
    auth
      .signupWithPassword(normalizedEmail, password, turnstile.token)
      .then((result) => {
        const query = new URLSearchParams();
        query.set("email", normalizedEmail);
        if (result.appSlug) query.set("appSlug", result.appSlug);
        if (result.verifyToken) query.set("token", result.verifyToken);
        setLocation(`/verify-email?${query.toString()}`);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to sign up.");
        if (turnstile.enabled) turnstile.reset();
      });
  };

  return (
    <AuthShell
      title="Create account"
      subtitle="Create your account to continue."
    >
      <AuthFormMotion>
        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setEmailTouched(true)}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "signup-email-error" : undefined}
          />
          <FieldValidationMessage
            id="signup-email-error"
            message={emailError}
          />

          <PasswordInput
            className="w-full border rounded px-3 py-2"
            placeholder="Password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={
              shouldShowPasswordFeedback &&
              missingPasswordRequirements.length > 0
            }
            aria-describedby={
              shouldShowPasswordFeedback &&
              missingPasswordRequirements.length > 0
                ? "signup-password-error"
                : undefined
            }
          />
          {shouldShowPasswordFeedback &&
          missingPasswordRequirements.length > 0 ? (
            <ul
              id="signup-password-error"
              className="text-xs text-destructive list-disc pl-5 space-y-1"
              aria-live="polite"
            >
              {missingPasswordRequirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          ) : null}
          <Button
            className="w-full"
            onClick={onSubmit}
            disabled={
              !email ||
              !password ||
              Boolean(validateEmailInput(email)) ||
              Boolean(validatePasswordInput(password))
            }
          >
            Sign up with email
          </Button>
        </div>

        <AuthTurnstileSection
          enabled={turnstile.enabled}
          TurnstileWidget={turnstile.TurnstileWidget}
          guidanceMessage={turnstile.guidanceMessage ?? undefined}
          status={turnstile.status}
        />
        {error ? (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        ) : null}
      </AuthFormMotion>
    </AuthShell>
  );
}
