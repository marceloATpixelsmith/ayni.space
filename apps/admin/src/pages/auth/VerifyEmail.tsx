import React from "react";
import { useSearch } from "wouter";
import { useAuth } from "@workspace/frontend-security";

export default function VerifyEmail() {
  const auth = useAuth();
  const search = useSearch();
  const [message, setMessage] = React.useState("Verifying...");
  React.useEffect(() => {
    const token = new URLSearchParams(search).get("token") ?? "";
    auth.verifyEmail(token).then(() => setMessage("Email verified."))
      .catch((err) => setMessage(err instanceof Error ? err.message : "Verification failed."));
  }, [auth, search]);

  return <div className="p-6">{message}</div>;
}
