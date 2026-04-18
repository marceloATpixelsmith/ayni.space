import React from "react";
import { useLocation } from "wouter";
import {
  useLoginRouteComposition,
  useSignupRouteActions,
  useSignupRoutePolicy,
  getSignupDisabledReasons,
  useEmailValidationInteraction,
  getMissingPasswordRequirements,
  validateEmailInput,
  validatePasswordInput,
} from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import {
  AuthFormMotion,
  AuthShell,
  AuthTurnstileSection,
  FieldValidationMessage,
} from "@workspace/auth-ui";

export default function Signup() {
  const { auth, turnstile } = useLoginRouteComposition();
  const [location, setLocation] = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const emailValidation = useEmailValidationInteraction({
    value: email,
    validate: validateEmailInput,
  });

  const { metadataResolved, signupAllowed } = useSignupRoutePolicy({
    locationPath: location,
    signupPath: "/signup",
    onRedirect: setLocation,
  });

  const emailError = emailValidation.error;
  const shouldShowPasswordFeedback = password.length > 0;
  const missingPasswordRequirements = getMissingPasswordRequirements(password);
  const { submit, handleSignup } = useSignupRouteActions({
    auth,
    turnstile,
    email,
    password,
    emailError,
    onRedirect: setLocation,
  });
  const emailSignupInvalid = !email || !password || Boolean(validateEmailInput(email)) || Boolean(validatePasswordInput(password));
  const disabledReasons = React.useMemo(
    () =>
      getSignupDisabledReasons({
        signupInFlight: submit.pending,
        emailPresent: Boolean(email),
        passwordPresent: Boolean(password),
        emailError: emailSignupInvalid && Boolean(validateEmailInput(email)),
        passwordError: emailSignupInvalid && Boolean(validatePasswordInput(password)),
      }),
    [submit.pending, email, password, emailSignupInvalid],
  );

  if (!metadataResolved || !signupAllowed) {
    return null;
  }

  const onSubmit = () => {
    emailValidation.markSubmitted();
    handleSignup();
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
            onBlur={emailValidation.markTouched}
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
            disabled={disabledReasons.length > 0}
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
        {submit.error ? (
          <p className="mt-4 text-sm text-destructive">{submit.error}</p>
        ) : null}
      </AuthFormMotion>
    </AuthShell>
  );
}
