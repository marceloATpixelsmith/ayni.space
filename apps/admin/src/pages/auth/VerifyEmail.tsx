import React from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@workspace/frontend-security";

export default function VerifyEmail() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [message, setMessage] = React.useState("Check your inbox to verify your email.");
  const [phase, setPhase] = React.useState<"idle" | "loading" | "success" | "error" | "redirecting">("idle");
  const verifiedAttemptRef = React.useRef<string | null>(null);
  const activeAttemptRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token") ?? "";
    const email = params.get("email") ?? "";
    const appSlug = params.get("appSlug") ?? "";
    if (!token) {
      const suffix = email ? ` for ${email}` : "";
      setMessage(`We sent a verification link${suffix}. After verification, sign in to continue onboarding.`);
      setPhase("idle");
      return;
    }
    const attemptKey = `${token}:${appSlug}`;
    if (verifiedAttemptRef.current === attemptKey) {
      return;
    }
    verifiedAttemptRef.current = attemptKey;
    activeAttemptRef.current = attemptKey;
    setPhase("loading");
    setMessage("Verifying your email...");

    console.info("[VERIFY-EMAIL-FLOW] verification request started", { appSlug: appSlug || null });
    auth.verifyEmail(token, appSlug || undefined).then((result) => {
      if (activeAttemptRef.current !== attemptKey) return;
      console.info("[VERIFY-EMAIL-FLOW] verification request succeeded", {
        hasNextPath: Boolean(result?.nextPath),
        mfaRequired: Boolean(result?.mfaRequired),
      });
      if (result?.nextPath || result?.mfaRequired) {
        setPhase("redirecting");
        setMessage("Email verified. Redirecting...");
        return;
      }
      setPhase("success");
      setMessage("Email verified. Redirecting to sign in...");
      window.setTimeout(() => setLocation("/login"), 800);
    })
      .catch((err) => {
        if (activeAttemptRef.current !== attemptKey) return;
        console.info("[VERIFY-EMAIL-FLOW] verification request failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        setPhase("error");
        setMessage(err instanceof Error ? err.message : "Verification failed.");
      });
  }, [auth, search, setLocation]);

  return (
    <div className="p-6">
      <p>{message}</p>
      {phase === "error" ? (
        <button className="mt-3 rounded bg-black px-4 py-2 text-white" type="button" onClick={() => setLocation("/login")}>
          Back to sign in
        </button>
      ) : null}
    </div>
  );
}
