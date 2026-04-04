import React from "react";
import { useSearch, useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";

export default function ResetPassword() {
  const auth = useAuth();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const token = React.useMemo(() => new URLSearchParams(search).get("token") ?? "", [search]);
  const [password, setPassword] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);

  const submit = () => auth.resetPassword(token, password).then(() => {
    setMessage("Password reset complete. Redirecting to login...");
    setTimeout(() => setLocation("/login"), 800);
  }).catch((err) => setMessage(err instanceof Error ? err.message : "Unable to reset password."));

  return <div className="p-6 max-w-md mx-auto space-y-2"><h1 className="text-xl font-semibold">Reset password</h1><input type="password" className="w-full border rounded px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" /><button className="border rounded px-3 py-2" onClick={submit}>Reset password</button>{message ? <p className="text-sm">{message}</p> : null}</div>;
}
