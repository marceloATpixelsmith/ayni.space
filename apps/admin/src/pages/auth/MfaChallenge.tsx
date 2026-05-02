import React from "react";
import { useAuth, logAuthDebug } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import {
  AuthShell,
  FieldValidationMessage,
  AuthFormMotion,
  AuthI18nProvider,
  useAuthI18n,
} from "@workspace/auth-ui";

function MfaChallengeContent() {
  const { t } = useAuthI18n();
  const auth = useAuth();
  const [code, setCode] = React.useState("");
  const [recoveryCode, setRecoveryCode] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [stayLoggedIn, setStayLoggedIn] = React.useState(false);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [recoveryError, setRecoveryError] = React.useState<string | null>(null);

  React.useEffect(() => {
    logAuthDebug("mfa_screen_mode_selected", {
      mode: "challenge",
      source: "MfaChallenge",
    });
  }, []);

  const submitCode = () => {
    setCodeError(null);
    auth
      .completeMfaChallenge(code, remember, stayLoggedIn)
      .catch((err) =>
        setCodeError(
          err instanceof Error
            ? err.message
            : "Invalid two-step verification code.",
        ),
      );
  };
  const submitRecovery = () => {
    setRecoveryError(null);
    auth
      .completeMfaRecovery(recoveryCode, remember, stayLoggedIn)
      .catch((err) =>
        setRecoveryError(
          err instanceof Error ? err.message : "Invalid recovery code.",
        ),
      );
  };

  return (
    <AuthShell
      title={t("mfa_challenge_title", "Two-step verification required")}
      subtitle={t(
        "mfa_challenge_subtitle",
        "Enter the code from your authenticator app to continue.",
      )}
    >
      <AuthFormMotion>
        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember this browser for 20 days (skip MFA challenge on this
              browser).
            </label>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={stayLoggedIn}
                onChange={(e) => setStayLoggedIn(e.target.checked)}
              />
              Keep this session signed in for up to 2 weeks.
            </label>
          </div>
          <input
            autoFocus
            className="w-full border rounded px-3 py-2"
            placeholder={t(
              "mfa_challenge_code_placeholder",
              "6-digit authenticator code",
            )}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-invalid={Boolean(codeError)}
            aria-describedby={codeError ? "twostep-code-error" : undefined}
          />
          <FieldValidationMessage id="twostep-code-error" message={codeError} />
          <Button className="w-full" onClick={submitCode}>
            Verify code
          </Button>

          <input
            className="w-full border rounded px-3 py-2"
            placeholder={t(
              "mfa_challenge_recovery_placeholder",
              "Recovery code",
            )}
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            aria-invalid={Boolean(recoveryError)}
            aria-describedby={
              recoveryError ? "twostep-recovery-error" : undefined
            }
          />
          <FieldValidationMessage
            id="twostep-recovery-error"
            message={recoveryError}
          />
          <Button
            className="w-full"
            variant="secondary"
            onClick={submitRecovery}
          >
            Use recovery code
          </Button>
        </div>
      </AuthFormMotion>
    </AuthShell>
  );
}

export default function MfaChallenge() {
  return (
    <AuthI18nProvider>
      <MfaChallengeContent />
    </AuthI18nProvider>
  );
}
