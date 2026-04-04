import React from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@workspace/frontend-security";

export default function VerifyEmail() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [message, setMessage] = React.useState("Check your inbox to verify your email.");
  const verifiedAttemptRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token") ?? "";
    const email = params.get("email") ?? "";
    const appSlug = params.get("appSlug") ?? "";
    if (!token) {
      const suffix = email ? ` for ${email}` : "";
      setMessage(`We sent a verification link${suffix}. After verification, sign in to continue onboarding.`);
      return;
    }
    const attemptKey = `${token}:${appSlug}`;
    if (verifiedAttemptRef.current === attemptKey) {
      return;
    }
    verifiedAttemptRef.current = attemptKey;
    let cancelled = false;
    setMessage("Verifying your email...");
    auth.verifyEmail(token, appSlug || undefined).then((result) => {
      if (cancelled) return;
      if (result?.nextPath || result?.mfaRequired) {
        setMessage("Email verified. Redirecting...");
        return;
      }
      setMessage("Email verified. Redirecting to sign in...");
      window.setTimeout(() => setLocation("/login"), 800);
    })
      .catch((err) => {
        if (cancelled) return;
        setMessage(err instanceof Error ? err.message : "Verification failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [auth, search, setLocation]);

  return <div className="p-6">{message}</div>;
}
