import React from "react";
import { useLocation, useParams } from "wouter";
import { useInvitationAcceptRouteRuntime } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { motion } from "framer-motion";
import {
  AuthShell,
  AuthMethodDivider,
  FieldValidationMessage,
  GoogleAuthButton,
  AuthTurnstileSection,
} from "@workspace/auth-ui";

type Params = { token?: string };

export default function InvitationAccept() {
  const { token } = useParams<Params>();
  const [, setLocation] = useLocation();
  const invitation = useInvitationAcceptRouteRuntime({
    token,
    onRedirect: setLocation,
  });

  return (
    <AuthShell
      title="Invitation"
      subtitle={invitation.shouldShowInvitationChoices ? undefined : invitation.message}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {invitation.status === "error" ? (
          <div className="space-y-2">
            {invitation.resolutionError ? (
              <p className="text-destructive text-sm text-center">
                {invitation.resolutionError}
              </p>
            ) : null}
            <Button
              onClick={() =>
                setLocation(
                  invitation.auth.status === "unauthenticated" ? "/login" : "/dashboard",
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
              loadingLabel="Starting Google sign-in..."
            />

            {invitation.shouldShowPasswordFields ? (
              <>
                <AuthMethodDivider />
                <p className="text-sm text-foreground">Create a password to log in</p>
                <PasswordInput
                  value={invitation.password}
                  onChange={(event) => invitation.setPassword(event.target.value)}
                  onBlur={invitation.markPasswordTouched}
                  className="w-full border rounded px-3 py-2"
                  placeholder="Password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(invitation.passwordError)}
                  aria-describedby={invitation.passwordError ? "invite-password-error" : undefined}
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
                    {invitation.missingPasswordRequirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
                ) : null}
                <Button
                  onClick={invitation.submitInvitationPassword}
                  className="w-full"
                  disabled={invitation.passwordSubmitting || !invitation.canSubmitPassword}
                >
                  {invitation.passwordSubmitting
                    ? "Setting password..."
                    : "Set password and join"}
                </Button>
              </>
            ) : null}
            {invitation.submitError ? (
              <p className="text-destructive text-sm">{invitation.submitError}</p>
            ) : null}
          </div>
        ) : null}

        <AuthTurnstileSection
          enabled={invitation.turnstile.enabled && invitation.status !== "done"}
          TurnstileWidget={invitation.turnstile.TurnstileWidget}
          guidanceMessage={invitation.turnstile.guidanceMessage ?? undefined}
          status={invitation.turnstile.status}
        />
      </motion.div>
    </AuthShell>
  );
}
