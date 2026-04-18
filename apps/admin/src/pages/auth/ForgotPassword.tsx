import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  useAuth,
  useEmailValidationInteraction,
  useAuthSubmitOrchestration,
  normalizeEmailInput,
  validateEmailInput,
  getAuthActionErrorMessage,
} from "@workspace/frontend-security";
import {
  AuthShell,
  FieldValidationMessage,
  AuthFormMotion,
  AuthStatusMessage,
} from "@workspace/auth-ui";

export default function ForgotPassword() {
  const auth = useAuth();
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);
  const submitState = useAuthSubmitOrchestration();
  const emailValidation = useEmailValidationInteraction({
    value: email,
    validate: validateEmailInput,
  });

  const emailError = emailValidation.error;

  const handleSubmit = () => {
    emailValidation.markSubmitted();
    if (emailError) {
      setMessage(emailError);
      return;
    }
    void submitState
      .run(() => auth.forgotPassword(normalizeEmailInput(email)))
      .then((result) => {
        setMessage(
          result.resetToken
            ? `Test reset token: ${result.resetToken}`
            : "If an account exists, a reset email has been sent.",
        );
      })
      .catch((error) => {
        setMessage(
          getAuthActionErrorMessage(
            error,
            "Unable to submit forgot-password request.",
          ),
        );
      });
  };

  return (
    <AuthShell title="Forgot password" subtitle="Enter your email and we'll send reset instructions.">
      <AuthFormMotion>
        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={emailValidation.markTouched}
            placeholder="Email"
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "forgot-email-error" : undefined}
          />
          <FieldValidationMessage id="forgot-email-error" message={emailError} />
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!email || Boolean(validateEmailInput(email)) || submitState.pending}
          >
            {submitState.pending ? "Sending..." : "Send reset link"}
          </Button>
        </div>

        <AuthStatusMessage message={message} />
        <p className="mt-4 text-sm text-muted-foreground">Remembered your password? <Link href="/login" className="underline">Back to sign in</Link></p>
      </AuthFormMotion>
    </AuthShell>
  );
}
