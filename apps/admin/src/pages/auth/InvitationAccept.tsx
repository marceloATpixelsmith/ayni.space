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

  const invitation =
    useInvitationAcceptRouteRuntime({
      token,
      onRedirect: setLocation,
    });

  const backButtonLabel =
    invitation.auth.status === "unauthenticated"
      ? t("invitation_back_sign_in")
      : t("invitation_back_dashboard");

  return (
    <AuthShell
      title={t("invitation_title")}
      subtitle={
        invitation.shouldShowInvitationChoices
          ? undefined
          : invitation.message
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
                  invitation.auth.status ===
                    "unauthenticated"
                    ? "/login"
                    : "/",
                )
              }
              className="w-full"
            >
              {backButtonLabel}
            </Button>
          </div>
        ) : null}

        {invitation.shouldShowInvitationChoices ? (
          <div className="space-y-3">
            <GoogleAuthButton
              onClick={
                invitation.startGoogleContinuation
              }
              disabled={
                invitation.auth.loginInFlight
              }
              loading={
                invitation.auth.loginInFlight
              }
              idleLabel={t(
                "invitation_google_continue_idle",
              )}
              loadingLabel={t(
                "invitation_google_continue_loading",
              )}
            />

            {invitation.shouldShowPasswordFields ? (
              <>
                <AuthMethodDivider />

                <p className="text-sm text-foreground">
                  {t(
                    "invitation_password_create_prompt",
                  )}
                </p>

                <PasswordInput
                  value={invitation.password}
                  onChange={(event) =>
                    invitation.setPassword(
                      event.target.value,
                    )
                  }
                  onBlur={
                    invitation.markPasswordTouched
                  }
                  className="w-full border rounded px-3 py-2"
                  placeholder={t(
                    "invitation_password_placeholder",
                  )}
                  autoComplete="new-password"
                  aria-invalid={Boolean(
                    invitation.passwordError,
                  )}
                  aria-describedby={
                    invitation.passwordError
                      ? "invite-password-error"
                      : undefined
                  }
                />

                <FieldValidationMessage
                  id="invite-password-error"
                  message={
                    invitation.passwordError
                  }
                />

                {invitation.shouldShowPasswordFeedback &&
                invitation
                  .missingPasswordRequirements
                  .length > 0 ? (
                  <ul
                    className="text-xs text-destructive list-disc pl-5 space-y-1"
                    aria-live="polite"
                  >
                    {invitation.missingPasswordRequirements.map(
                      (requirement) => (
                        <li key={requirement}>
                          {requirement}
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}

                <Button
                  onClick={
                    invitation.submitInvitationPassword
                  }
                  className="w-full"
                  disabled={
                    invitation.passwordSubmitting ||
                    !invitation.canSubmitPassword
                  }
                >
                  {invitation.passwordSubmitting
                    ? t(
                        "invitation_password_submitting",
                      )
                    : t(
                        "invitation_password_submit",
                      )}
                </Button>
              </>
            ) : null}

            {invitation.shouldShowEmailSignInOption ? (
              <Button
                asChild
                variant="secondary"
                className="w-full"
              >
                <Link
                  href={
                    invitation.loginContinuationPath
                  }
                >
                  {t(
                    "invitation_email_sign_in_option",
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
          enabled={
            invitation.turnstile.enabled &&
            invitation.status !== "done"
          }
          TurnstileWidget={
            invitation.turnstile
              .TurnstileWidget
          }
          guidanceMessage={
            invitation.turnstile
              .guidanceMessage ??
            undefined
          }
          status={
            invitation.turnstile.status
          }
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
