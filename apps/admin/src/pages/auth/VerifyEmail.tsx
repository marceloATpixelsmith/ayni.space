import React from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth, logAuthDebug } from "@workspace/frontend-security";
import {
  AuthShell,
  AuthStatusMessage,
  AuthI18nProvider,
  useAuthI18n,
} from "@workspace/auth-ui";

function VerifyEmailContent() {
  const { t } = useAuthI18n();
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [message, setMessage] = React.useState<string>(
    t("verify_email_check_inbox", "Check your inbox to verify your email."),
  );
  const [phase, setPhase] = React.useState<
    "idle" | "loading" | "success" | "error" | "redirecting"
  >("idle");
  const verifiedAttemptRef = React.useRef<string | null>(null);
  const activeAttemptRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token") ?? "";
    const email = params.get("email") ?? "";
    const appSlug = params.get("appSlug") ?? "";
    if (!token) {
      const suffix = email ? ` for ${email}` : "";
      setMessage(
        suffix
          ? t(
              "verify_email_sent_link_with_email",
              "We sent a verification link for {email}. After verification, we'll continue automatically.",
            ).replace("{email}", email)
          : t(
              "verify_email_sent_link_without_email",
              "We sent a verification link. After verification, we'll continue automatically.",
            ),
      );
      setPhase("idle");
      return;
    }
    logAuthDebug("verify_email_attempt_started", {
      appSlug: appSlug || null,
      tokenPresent: Boolean(token),
    });
    const attemptKey = `${token}:${appSlug}`;
    if (verifiedAttemptRef.current === attemptKey) return;
    verifiedAttemptRef.current = attemptKey;
    activeAttemptRef.current = attemptKey;
    setPhase("loading");
    setMessage(t("verify_email_verifying", "Verifying your email..."));

    auth
      .verifyEmail(token, appSlug || undefined)
      .then((result) => {
        if (activeAttemptRef.current !== attemptKey) return;
        logAuthDebug("verify_email_final_step_summary", {
          mfaRequired: Boolean(result?.mfaRequired),
          needsEnrollment: Boolean(result?.needsEnrollment),
          nextPath: result?.nextPath ?? null,
        });
        if (result?.nextPath || result?.mfaRequired) {
          setPhase("redirecting");
          setMessage(
            t("verify_email_redirecting", "Email verified. Redirecting..."),
          );
          return;
        }
        setPhase("success");
        setMessage(
          t("verify_email_continuing", "Email verified. Continuing..."),
        );
        window.setTimeout(() => setLocation("/"), 300);
      })
      .catch((err) => {
        if (activeAttemptRef.current !== attemptKey) return;
        setPhase("error");
        setMessage(
          err instanceof Error
            ? err.message
            : t("verify_email_failure_fallback", "Verification failed."),
        );
      });
  }, [auth, search, setLocation]);

  return (
    <AuthShell
      title={t("verify_email_title", "Verify your email")}
      subtitle={t(
        "verify_email_subtitle",
        "Confirm your email address to continue automatically.",
      )}
    >
      <AuthStatusMessage
        message={message}
        tone={phase === "error" ? "error" : "default"}
      />
    </AuthShell>
  );
}

//__EXPORT__
export default function VerifyEmail() {
  return (
    <AuthI18nProvider>
      <VerifyEmailContent />
    </AuthI18nProvider>
  );
}
