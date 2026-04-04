import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";

export default function MfaEnroll() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const [factorId, setFactorId] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [issuer, setIssuer] = React.useState("");
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    auth.startMfaEnrollment().then((payload) => {
      setFactorId(payload.factorId);
      setSecret(payload.secret);
      setIssuer(payload.issuer);
    }).catch((err) => setError(err instanceof Error ? err.message : "Unable to start MFA enrollment."));
  }, [auth]);

  const onVerify = () => {
    auth.verifyMfaEnrollment(factorId, code).then((payload) => {
      setRecovery(payload.recoveryCodes);
      if (payload.nextPath) {
        setLocation(payload.nextPath);
      }
    }).catch((err) => setError(err instanceof Error ? err.message : "Unable to verify MFA."));
  };

  return <div className="min-h-screen flex items-center justify-center"><div className="max-w-lg w-full p-6 border rounded space-y-3">
    <h1 className="text-xl font-semibold">Set up MFA</h1>
    <p className="text-sm text-muted-foreground">Issuer: {issuer}</p>
    <p className="text-sm">Add this secret to your authenticator app: <code>{secret}</code></p>
    <input className="w-full border rounded px-3 py-2" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
    <Button className="w-full" onClick={onVerify}>Verify and activate MFA</Button>
    {recovery.length > 0 ? <div className="space-y-2"><p className="text-sm font-medium">Recovery codes (save these now):</p><ul className="text-xs grid grid-cols-2 gap-1">{recovery.map((c) => <li key={c}><code>{c}</code></li>)}</ul><Button className="w-full" onClick={() => setLocation('/')}>Continue</Button></div> : null}
  </div></div>;
}
