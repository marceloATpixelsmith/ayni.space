import React from "react";
import { Link, useLocation, useParams } from "wouter";
import { useInvitationAcceptRouteRuntime } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import {
  AuthShell,
  AuthMethodDivider,
  FieldValidationMessage,
  GoogleAuthButton,
  AuthTurnstileSection,
  AuthFormMotion,
  AuthStatusMessage,
  AuthI18nProvider,
  useAuthI18n,
} from "@workspace/auth-ui";

type Params = { token?: string };

function InvitationAcceptContent() {
  const { t } = useAuthI18n();
  const { token } = useParams<Params>();
  const [, setLocation] = useLocation();
  const invitation = useInvitationAcceptRouteRuntime({
    token,
    onRedirect: setLocation,
  });

  return (
    <AuthShell
      title={t("invitation_title", "Invitation")}
      subtitle={
        invitation.shouldShowInvitationChoices ? undefined : invitation.message
      }
    >
      <AuthFormMotion>
        {invitation.status === "error" ? (
          <div className="space-y-2">
            <AuthStatusMessage
              message={invitation.resolutionError}
              tone="error"
              align="center"
              className="mt-0"
            />
            <Button
              onClick={() =>
                setLocation(
                  invitation.auth.status === "unauthenticated" ? "/login" : "/",
                )
              }
              className="w-full"
            >
              {invitation.auth.status === "unauthenticated"
                ? "Back to sign in"
                : "Back to dashboard"}
            </Button>
          </div>
        ) : null}

        {invitation.shouldShowInvitationChoices ? (
          <div className="space-y-3">
            <GoogleAuthButton
              onClick={invitation.startGoogleContinuation}
              disabled={invitation.auth.loginInFlight}
              loading={invitation.auth.loginInFlight}
              idleLabel="Continue with Google"
              loadingLabel={t(
                "invitation_google_continue_loading",
                "Starting Google sign-in...",
              )}
            />

            {invitation.shouldShowPasswordFields ? (
              <>
                <AuthMethodDivider />
                <p className="text-sm text-foreground">
                  {t(
                    "invitation_password_create_prompt",
                    "Create a password to log in",
                  )}
                </p>
                <PasswordInput
                  value={invitation.password}
                  onChange={(event) =>
                    invitation.setPassword(event.target.value)
                  }
                  onBlur={invitation.markPasswordTouched}
                  className="w-full border rounded px-3 py-2"
                  placeholder="Password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(invitation.passwordError)}
                  aria-describedby={
                    invitation.passwordError
                      ? "invite-password-error"
                      : undefined
                  }
                />
                <FieldValidationMessage
                  id="invite-password-error"
                  message={invitation.passwordError}
                />
                {invitation.shouldShowPasswordFeedback &&
                invitation.missingPasswordRequirements.length > 0 ? (
                  <ul
                    className="text-xs text-destructive list-disc pl-5 space-y-1"
                    aria-live="polite"
                  >
                    {invitation.missingPasswordRequirements.map(
                      (requirement) => (
                        <li key={requirement}>{requirement}</li>
                      ),
                    )}
                  </ul>
                ) : null}
                <Button
                  onClick={invitation.submitInvitationPassword}
                  className="w-full"
                  disabled={
                    invitation.passwordSubmitting ||
                    !invitation.canSubmitPassword
                  }
                >
                  {invitation.passwordSubmitting
                    ? t("invitation_password_submitting", "Setting password...")
                    : t("invitation_password_submit", "Set password and join")}
                </Button>
              </>
            ) : null}
            {invitation.shouldShowEmailSignInOption ? (
              <Button asChild variant="secondary" className="w-full">
                <Link href={invitation.loginContinuationPath}>
                  {t(
                    "invitation_email_sign_in_option",
                    "Sign in with email/password",
                  )}
                </Link>
              </Button>
            ) : null}
            <AuthStatusMessage
              message={invitation.submitError}
              tone="error"
              className="mt-0"
            />
          </div>
        ) : null}

        <AuthTurnstileSection
          enabled={invitation.turnstile.enabled && invitation.status !== "done"}
          TurnstileWidget={invitation.turnstile.TurnstileWidget}
          guidanceMessage={invitation.turnstile.guidanceMessage ?? undefined}
          status={invitation.turnstile.status}
        />
      </AuthFormMotion>
    </AuthShell>
  );
}

export default function InvitationAccept() {
  return (
    <AuthI18nProvider>
      <InvitationAcceptContent />
    </AuthI18nProvider>
  );
}
