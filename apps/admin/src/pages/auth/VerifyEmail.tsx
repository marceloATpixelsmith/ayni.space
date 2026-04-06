import React from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth, logAuthDebug } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./components/AuthShell";

export default function VerifyEmail() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [message, setMessage] = React.useState(
    "Check your inbox to verify your email.",
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
        `We sent a verification link${suffix}. After verification, we'll continue automatically.`,
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
    setMessage("Verifying your email...");

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
          setMessage("Email verified. Redirecting...");
          return;
        }
        setPhase("success");
        setMessage("Email verified. Continuing...");
        window.setTimeout(() => setLocation("/"), 300);
      })
      .catch((err) => {
        if (activeAttemptRef.current !== attemptKey) return;
        setPhase("error");
        setMessage(err instanceof Error ? err.message : "Verification failed.");
      });
  }, [auth, search, setLocation]);

  return (
    <AuthShell
      title="Verify your email"
      subtitle="Confirm your email address to finish signing in."
    >
      <p className="text-sm">{message}</p>
      {phase === "error" ? (
        <Button
          className="mt-4"
          type="button"
          onClick={() => setLocation("/login")}
        >
          Back to sign in
        </Button>
      ) : null}
    </AuthShell>
  );
}
