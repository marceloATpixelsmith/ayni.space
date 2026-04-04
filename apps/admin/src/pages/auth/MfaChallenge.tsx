import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";

export default function MfaChallenge() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const [code, setCode] = React.useState("");
  const [recoveryCode, setRecoveryCode] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const submitCode = () => {
    auth.completeMfaChallenge(code, remember).then(() => setLocation("/")).catch((err) => setError(err instanceof Error ? err.message : "Invalid MFA code."));
  };
  const submitRecovery = () => {
    auth.completeMfaRecovery(recoveryCode, remember).then(() => setLocation("/")).catch((err) => setError(err instanceof Error ? err.message : "Invalid recovery code."));
  };

  return <div className="min-h-screen flex items-center justify-center"><div className="max-w-md w-full p-6 border rounded space-y-3">
    <h1 className="text-xl font-semibold">MFA required</h1>
    <label className="text-sm"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember this device for 20 days</label>
    <input className="w-full border rounded px-3 py-2" placeholder="6-digit authenticator code" value={code} onChange={(e) => setCode(e.target.value)} />
    <Button className="w-full" onClick={submitCode}>Verify code</Button>
    <input className="w-full border rounded px-3 py-2" placeholder="Recovery code" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} />
    <Button className="w-full" variant="secondary" onClick={submitRecovery}>Use recovery code</Button>
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
  </div></div>;
}
