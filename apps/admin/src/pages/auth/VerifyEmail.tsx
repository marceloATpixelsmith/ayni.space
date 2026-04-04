import React from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@workspace/frontend-security";

export default function VerifyEmail() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [message, setMessage] = React.useState("Check your inbox to verify your email.");
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
    auth.verifyEmail(token, appSlug || undefined).then((result) => {
      if (result?.nextPath || result?.mfaRequired) {
        setMessage("Email verified. Redirecting...");
        return;
      }
      setMessage("Email verified. Redirecting to sign in...");
      window.setTimeout(() => setLocation("/login"), 800);
    })
      .catch((err) => setMessage(err instanceof Error ? err.message : "Verification failed."));
  }, [auth, search, setLocation]);

  return <div className="p-6">{message}</div>;
}
