import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./components/AuthShell";
import { FieldValidationMessage } from "./components/FieldValidationMessage";

export default function MfaChallenge() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const [code, setCode] = React.useState("");
  const [recoveryCode, setRecoveryCode] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [recoveryError, setRecoveryError] = React.useState<string | null>(null);

  const submitCode = () => {
    setCodeError(null);
    auth.completeMfaChallenge(code, remember).then(() => setLocation("/")).catch((err) => setCodeError(err instanceof Error ? err.message : "Invalid two-step verification code."));
  };
  const submitRecovery = () => {
    setRecoveryError(null);
    auth.completeMfaRecovery(recoveryCode, remember).then(() => setLocation("/")).catch((err) => setRecoveryError(err instanceof Error ? err.message : "Invalid recovery code."));
  };

  return (
    <AuthShell title="Two-step verification required" subtitle="Enter the code from your authenticator app to continue.">
      <div className="space-y-3">
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember this device for 20 days</label>
        <input autoFocus className="w-full border rounded px-3 py-2" placeholder="6-digit authenticator code" value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={Boolean(codeError)} aria-describedby={codeError ? "twostep-code-error" : undefined} />
        <FieldValidationMessage id="twostep-code-error" message={codeError} />
        <Button className="w-full" onClick={submitCode}>Verify code</Button>

        <input className="w-full border rounded px-3 py-2" placeholder="Recovery code" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} aria-invalid={Boolean(recoveryError)} aria-describedby={recoveryError ? "twostep-recovery-error" : undefined} />
        <FieldValidationMessage id="twostep-recovery-error" message={recoveryError} />
        <Button className="w-full" variant="secondary" onClick={submitRecovery}>Use recovery code</Button>
      </div>
    </AuthShell>
  );
}
