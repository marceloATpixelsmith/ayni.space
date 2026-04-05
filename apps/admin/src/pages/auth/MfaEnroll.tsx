import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";

export default function MfaEnroll() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const [phase, setPhase] = React.useState<"initializing" | "ready" | "submitting" | "success" | "init-error">("initializing");
  const [factorId, setFactorId] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [issuer, setIssuer] = React.useState("");
  const [qrCodeUrl, setQrCodeUrl] = React.useState("");
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState<string[]>([]);
  const [initError, setInitError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setPhase("initializing");
    setInitError(null);
    setSubmitError(null);

    auth.startMfaEnrollment().then(async (payload) => {
      if (!active) return;
      setFactorId(payload.factorId);
      setSecret(payload.secret);
      setIssuer(payload.issuer);
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(payload.otpauthUrl)}`;
      setQrCodeUrl(qrUrl);
      setPhase("ready");
    }).catch((err) => {
      if (!active) return;
      setPhase("init-error");
      setInitError(err instanceof Error ? err.message : "Unable to start MFA enrollment.");
    });

    return () => {
      active = false;
    };
  }, [auth]);

  const onVerify = () => {
    if (!factorId) return;
    setPhase("submitting");
    setSubmitError(null);
    auth.verifyMfaEnrollment(factorId, code).then((payload) => {
      setRecovery(payload.recoveryCodes);
      setPhase("success");
      if (payload.nextPath) {
        setLocation(payload.nextPath);
      }
    }).catch((err) => {
      setPhase("ready");
      setSubmitError(err instanceof Error ? err.message : "Unable to verify MFA.");
    });
  };

  return <div className="min-h-screen flex items-center justify-center"><div className="max-w-lg w-full p-6 border rounded space-y-3">
    <h1 className="text-xl font-semibold">Set up MFA</h1>
    {phase === "initializing" ? <p className="text-sm text-muted-foreground">Preparing your authenticator setup…</p> : null}
    {phase === "init-error" ? <p className="text-sm text-destructive">{initError ?? "Unable to start MFA enrollment."}</p> : null}
    {phase === "init-error" ? <Button className="w-full" onClick={() => window.location.reload()}>Retry setup</Button> : null}
    {phase === "init-error" ? null : <>
    <p className="text-sm text-muted-foreground">Issuer: {issuer}</p>
    {qrCodeUrl ? <div className="rounded border p-3 bg-white w-fit mx-auto"><img src={qrCodeUrl} alt="MFA enrollment QR code" className="h-60 w-60" /></div> : null}
    <p className="text-sm">Scan the QR code in your authenticator app. If needed, enter this setup key manually: <code>{secret}</code></p>
    <input className="w-full border rounded px-3 py-2" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
    {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
    <Button className="w-full" onClick={onVerify} disabled={phase === "submitting" || phase === "initializing" || !code.trim()}>{phase === "submitting" ? "Verifying…" : "Verify and activate MFA"}</Button>
    {recovery.length > 0 ? <div className="space-y-2"><p className="text-sm font-medium">Recovery codes (save these now):</p><ul className="text-xs grid grid-cols-2 gap-1">{recovery.map((c) => <li key={c}><code>{c}</code></li>)}</ul><Button className="w-full" onClick={() => setLocation('/')}>Continue</Button></div> : null}
    </>}
  </div></div>;
}
