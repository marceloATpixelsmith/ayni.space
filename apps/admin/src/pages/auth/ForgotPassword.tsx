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
  AuthI18nProvider,
  useAuthI18n,
  formatAuthMessage,
} from "@workspace/auth-ui";

function ForgotPasswordContent() {
  const { t } = useAuthI18n();
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
            ? formatAuthMessage("forgot_password_test_reset_token", {
                token: result.resetToken,
              })
            : t("forgot_password_success_generic"),
        );
      })
      .catch((error) => {
        setMessage(
          getAuthActionErrorMessage(
            error,
            t("forgot_password_error_fallback"),
          ),
        );
      });
  };

  return (
    <AuthShell
      title={t("forgot_password_title")}
      subtitle={t("forgot_password_subtitle")}
    >
      <AuthFormMotion>
        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={emailValidation.markTouched}
            placeholder={t("forgot_password_email_placeholder")}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "forgot-email-error" : undefined}
          />
          <FieldValidationMessage id="forgot-email-error" message={emailError} />
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!email || Boolean(validateEmailInput(email)) || submitState.pending}
          >
            {submitState.pending
              ? t("forgot_password_submit_loading")
              : t("forgot_password_submit_idle")}
          </Button>
        </div>

        <AuthStatusMessage message={message} />
        <p className="mt-4 text-sm text-muted-foreground">
          {t("forgot_password_back_prompt")}{" "}
          <Link href="/login" className="underline">
            {t("forgot_password_back_link")}
          </Link>
        </p>
      </AuthFormMotion>
    </AuthShell>
  );
}

export default function ForgotPassword() {
  return (
    <AuthI18nProvider>
      <ForgotPasswordContent />
    </AuthI18nProvider>
  );
}
