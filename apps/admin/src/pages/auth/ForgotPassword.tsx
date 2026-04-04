import React from "react";
import { useAuth } from "@workspace/frontend-security";

export default function ForgotPassword() {
  const auth = useAuth();
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState<string | null>(null);

  const submit = () => {
    auth.forgotPassword(email).then((result) => {
      setMessage(result.resetToken ? `Test reset token: ${result.resetToken}` : "If an account exists, a reset email has been sent.");
    });
  };

  return <div className="p-6 max-w-md mx-auto space-y-2"><h1 className="text-xl font-semibold">Forgot password</h1><input className="w-full border rounded px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" /><button className="border rounded px-3 py-2" onClick={submit}>Send reset link</button>{message ? <p className="text-sm">{message}</p> : null}</div>;
}
