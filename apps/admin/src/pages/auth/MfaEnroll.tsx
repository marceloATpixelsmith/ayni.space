import React from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth, logAuthDebug, secureApiFetch } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./components/AuthShell";
import { FieldValidationMessage } from "./components/FieldValidationMessage";

type MfaModeDecision = {
  mode: "enroll" | "challenge";
  reason:
    | "auth_context_pending_enrolled"
    | "auth_me_payload_next_step_challenge"
    | "auth_me_payload_enrolled_pending"
    | "auth_me_request_failed_challenge_fail_closed"
    | "auth_me_payload_missing_challenge_fail_closed"
    | "auth_me_payload_enroll";
};

function decideMfaScreenModeFromInputs(params: {
  authStatus: string;
  authUserId: string | null;
  authMfaPending: boolean;
  authMfaEnrolled: boolean;
  authNextStep: "mfa_enroll" | "mfa_challenge" | null;
  meResponseOk: boolean;
  mePayload: { mfaPending?: boolean; mfaEnrolled?: boolean; nextStep?: "mfa_enroll" | "mfa_challenge" | null } | null;
  mePayloadReadable: boolean;
}): MfaModeDecision {
  if (
    params.authStatus === "authenticated_mfa_pending_enrolled" ||
    (params.authMfaPending && params.authNextStep === "mfa_challenge") ||
    (params.authMfaPending && params.authMfaEnrolled && params.authNextStep !== "mfa_enroll")
  ) {
    return { mode: "challenge", reason: "auth_context_pending_enrolled" };
  }

  if (!params.meResponseOk) {
    return { mode: "challenge", reason: "auth_me_request_failed_challenge_fail_closed" };
  }

  if (!params.mePayloadReadable) {
    return { mode: "challenge", reason: "auth_me_payload_missing_challenge_fail_closed" };
  }

  if (params.mePayload?.mfaPending && params.mePayload.nextStep === "mfa_challenge") {
    return { mode: "challenge", reason: "auth_me_payload_next_step_challenge" };
  }

  if (
    params.mePayload?.mfaPending &&
    params.mePayload.nextStep !== "mfa_enroll" &&
    params.mePayload.mfaEnrolled === true
  ) {
    return { mode: "challenge", reason: "auth_me_payload_enrolled_pending" };
  }

  return { mode: "enroll", reason: "auth_me_payload_enroll" };
}

export default function MfaEnroll() {
  const auth = useAuth();
  const startMfaEnrollment = auth.startMfaEnrollment;
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
  const authSnapshotRef = React.useRef({
    status: auth.status,
    userId: auth.user?.id ?? null as string | null,
    mfaPending: auth.user?.mfaPending === true,
    mfaEnrolled: auth.user?.mfaEnrolled === true,
    nextStep: auth.user?.nextStep ?? null as "mfa_enroll" | "mfa_challenge" | null,
  });

  React.useEffect(() => {
    authSnapshotRef.current = {
      status: auth.status,
      userId: auth.user?.id ?? null,
      mfaPending: auth.user?.mfaPending === true,
      mfaEnrolled: auth.user?.mfaEnrolled === true,
      nextStep: auth.user?.nextStep ?? null,
    };
  }, [auth.status, auth.user?.id, auth.user?.mfaEnrolled, auth.user?.mfaPending, auth.user?.nextStep]);

  React.useEffect(() => {
    let active = true;
    setPhase("initializing");
    setInitError(null);
    setSubmitError(null);

    void secureApiFetch("/api/auth/me", {
      method: "GET",
      credentials: "include",
    }).then(async (response) => {
      if (!active) return;

      const payload = (await response.json().catch(() => null)) as { mfaPending?: boolean; mfaEnrolled?: boolean; nextStep?: "mfa_enroll" | "mfa_challenge" | null } | null;
      const authSnapshot = authSnapshotRef.current;
      const authMfaPending = authSnapshot.mfaPending;
      const authMfaEnrolled = authSnapshot.mfaEnrolled;
      const authNextStep = authSnapshot.nextStep;
      const decision = decideMfaScreenModeFromInputs({
        authStatus: authSnapshot.status,
        authUserId: authSnapshot.userId,
        authMfaPending,
        authMfaEnrolled,
        authNextStep,
        meResponseOk: response.ok,
        mePayload: payload,
        mePayloadReadable: payload !== null,
      });
      logAuthDebug("mfa_screen_mode_selector_inputs", {
        routePath: window.location.pathname,
        authStatus: authSnapshot.status,
        authUserId: authSnapshot.userId,
        authMfaPending,
        authMfaEnrolled,
        authNextStep,
        meStatus: response.status,
        meOk: response.ok,
        meMfaPending: payload?.mfaPending ?? null,
        meMfaEnrolled: payload?.mfaEnrolled ?? null,
        meNextStep: payload?.nextStep ?? null,
        chosenMode: decision.mode,
        branch: decision.reason,
      });
      logAuthDebug("mfa_screen_mode_selected", {
        mode: decision.mode,
        reason: decision.reason,
      });

      if (response.status === 401) {
        setPhase("init-error");
        setInitError("Your session is no longer active. Please sign in again.");
        return;
      }

      if (decision.mode === "challenge") {
        window.location.assign("/mfa/challenge");
        return;
      }

      const startRequest = enrollmentStartRef.current ?? startMfaEnrollment();
      enrollmentStartRef.current = startRequest;
      startRequest.then(async (startPayload) => {
        if (!active) return;
        setFactorId(startPayload.factorId);
        setSecret(startPayload.secret);
        setIssuer(startPayload.issuer);
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(startPayload.otpauthUrl)}`;
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
    }).catch((err) => {
      if (!active) return;
      setPhase("init-error");
      setInitError(err instanceof Error ? err.message : "Unable to start two-step verification setup.");
    });

    return () => {
      active = false;
    };
  }, [startMfaEnrollment]);

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
