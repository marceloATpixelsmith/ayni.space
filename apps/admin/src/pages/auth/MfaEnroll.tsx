import React from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./components/AuthShell";
import { FieldValidationMessage } from "./components/FieldValidationMessage";

export default function MfaEnroll() {
  const auth = useAuth();
  const enrollmentStartRef = React.useRef<Promise<Awaited<ReturnType<typeof auth.startMfaEnrollment>>> | null>(null);
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

    const startRequest = enrollmentStartRef.current ?? auth.startMfaEnrollment();
    enrollmentStartRef.current = startRequest;
    startRequest.then(async (payload) => {
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
      setInitError(err instanceof Error ? err.message : "Unable to start two-step verification setup.");
    }).finally(() => {
      if (enrollmentStartRef.current === startRequest) {
        enrollmentStartRef.current = null;
      }
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
    }).catch((err) => {
      setPhase("ready");
      setSubmitError(err instanceof Error ? err.message : "Unable to verify two-step verification code.");
    });
  };

  return (
    <AuthShell title="Set up two-step verification" subtitle="Add an authenticator app for extra account security." maxWidthClassName="max-w-lg">
      <div className="space-y-3">
        {phase === "initializing" ? <p className="text-sm text-muted-foreground">Preparing your authenticator setup…</p> : null}
        {phase === "init-error" ? <p className="text-sm text-destructive">{initError ?? "Unable to start two-step verification setup."}</p> : null}
        {phase === "init-error" ? <Button className="w-full" onClick={() => window.location.reload()}>Retry setup</Button> : null}

        {phase === "init-error" ? null : <>
          <p className="text-sm text-muted-foreground flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Install an authenticator app (Google Authenticator, 1Password, Authy, etc.), then scan this QR code.</p>
          <p className="text-sm text-muted-foreground">Account issuer: {issuer}</p>
          {qrCodeUrl ? <div className="rounded border p-3 bg-white w-fit mx-auto"><img src={qrCodeUrl} alt="Two-step verification QR code" className="h-60 w-60" /></div> : null}
          <p className="text-sm">Can&apos;t scan the QR code? Enter this setup key manually in your app: <code className="break-all">{secret}</code></p>
          <input autoFocus className="w-full border rounded px-3 py-2" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={Boolean(submitError)} aria-describedby={submitError ? "twostep-enroll-error" : undefined} />
          <FieldValidationMessage id="twostep-enroll-error" message={submitError} />
          <Button className="w-full" onClick={onVerify} disabled={phase === "submitting" || phase === "initializing" || !code.trim()}>{phase === "submitting" ? "Verifying…" : "Verify and activate two-step verification"}</Button>
          {recovery.length > 0 ? <div className="space-y-2"><p className="text-sm font-medium">Recovery codes (save these now):</p><ul className="text-xs grid grid-cols-2 gap-1">{recovery.map((c) => <li key={c}><code>{c}</code></li>)}</ul><Button className="w-full" onClick={() => window.location.assign("/")}>Continue</Button></div> : null}
        </>}
      </div>
    </AuthShell>
  );
}
