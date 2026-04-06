import React from "react";
import { useLocation, useParams } from "wouter";
import { useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

type Params = { token?: string };
type InvitationResolveResponse = {
  invitation?: {
    state?: "valid" | "invalid" | "expired" | "accepted" | "revoked";
    email?: string | null;
  };
  auth?: {
    googleAllowed?: boolean;
    emailMode?: "set_password" | "sign_in" | "none";
  };
};

export default function InvitationAccept() {
  const params = useParams<Params>();
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const turnstile = useTurnstileToken();
  const [status, setStatus] = React.useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("Preparing invitation acceptance...");
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [passwordConfirm, setPasswordConfirm] = React.useState("");
  const [resolution, setResolution] = React.useState<InvitationResolveResponse | null>(null);
  const [resolutionLoading, setResolutionLoading] = React.useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = React.useState(false);
  const lastSubmittedRef = React.useRef<string | null>(null);
  const inFlightRef = React.useRef(false);
  const continuationPath = React.useMemo(
    () => (params.token ? `/invitations/${params.token}/accept` : null),
    [params.token],
  );

  React.useEffect(() => {
    const token = params.token;
    if (!token) {
      setResolution(null);
      return;
    }
    let cancelled = false;
    setResolutionLoading(true);
    fetch(`/api/invitations/${token}/resolve`, { credentials: "include" })
      .then((response) => response.json().catch(() => null))
      .then((payload) => {
        if (cancelled) return;
        setResolution(payload as InvitationResolveResponse);
      })
      .catch(() => {
        if (cancelled) return;
        setResolution(null);
      })
      .finally(() => {
        if (cancelled) return;
        setResolutionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.token]);

  React.useEffect(() => {
    const token = params.token;
    console.info("[INVITATION-FLOW] invitation accept page mounted", {
      hasToken: Boolean(token),
      tokenLength: token?.length ?? 0,
      authStatus: auth.status,
      turnstileEnabled: turnstile.enabled,
      hasTurnstileToken: Boolean(turnstile.token),
    });
    if (!token) {
      setStatus("error");
      setMessage("Invitation token is missing.");
      return;
    }

    if (auth.status === "loading") {
      return;
    }

    const invitationState = resolution?.invitation?.state;
    if (invitationState && invitationState !== "valid") {
      inFlightRef.current = false;
      setStatus("error");
      const terminalMessage = invitationState === "expired"
        ? "This invitation has expired."
        : invitationState === "accepted"
          ? "This invitation has already been accepted."
          : invitationState === "revoked"
            ? "This invitation has been revoked."
            : "This invitation is invalid.";
      setMessage(terminalMessage);
      return;
    }

    if (auth.status === "unauthenticated") {
      inFlightRef.current = false;
      setStatus("idle");
      setMessage("Sign in to continue accepting this invitation.");
      if (resolutionLoading) {
        setMessage("Checking invitation status...");
      } else if (resolution?.auth?.emailMode === "set_password") {
        setMessage("Set your password to join this invitation.");
      }
      setLoginError(null);
      console.info("[INVITATION-FLOW] invitation accept awaiting explicit sign-in action", {
        continuationPath: `/invitations/${token}/accept`,
      });
      return;
    }

    if (turnstile.enabled && !turnstile.token) {
      inFlightRef.current = false;
      setStatus("idle");
      setMessage("Complete verification to accept this invitation.");
      return;
    }

    const submissionKey = `${token}:${turnstile.token ?? ""}`;
    if (inFlightRef.current || lastSubmittedRef.current === submissionKey) {
      return;
    }

    let cancelled = false;
    inFlightRef.current = true;
    lastSubmittedRef.current = submissionKey;
    setStatus("working");
    setMessage("Accepting invitation...");
    console.info("[INVITATION-FLOW] invitation accept API call starting", {
      tokenLength: token.length,
      hasTurnstileToken: Boolean(turnstile.token),
    });

    auth
      .acceptInvitation(token, turnstile.token)
      .then((nextPath) => {
        if (cancelled) return;
        inFlightRef.current = false;
        setStatus("done");
        const destination = nextPath ?? "/dashboard";
        setMessage("Invitation accepted. Redirecting...");
        console.info("[INVITATION-FLOW] invitation accept API call succeeded", {
          nextNavigation: destination,
        });
        setTimeout(() => setLocation(destination), 900);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        const typedError = error as Error & { code?: string };
        console.info("[INVITATION-FLOW] invitation accept API call failed", {
          code: typedError.code ?? null,
          message: typedError.message,
        });
        setMessage(typedError.message || "Failed to accept invitation.");
        inFlightRef.current = false;
        if (typedError.code?.startsWith("TURNSTILE_")) {
          lastSubmittedRef.current = null;
          turnstile.reset();
        }
      });

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [auth, params.token, resolution, resolutionLoading, setLocation, turnstile.enabled, turnstile.reset, turnstile.token]);

  const handleGoogleContinue = React.useCallback(() => {
    if (!continuationPath || auth.loginInFlight) return;
    if (turnstile.enabled && !turnstile.token) {
      setLoginError("Please complete the verification challenge.");
      return;
    }
    setLoginError(null);
    auth.loginWithGoogle(turnstile.token, "sign_in", continuationPath).catch((error) => {
      setLoginError(error instanceof Error ? error.message : "Unable to start Google sign-in.");
      if (turnstile.enabled) {
        turnstile.reset();
      }
    });
  }, [auth, continuationPath, turnstile.enabled, turnstile.reset, turnstile.token]);

  const handleSetPassword = React.useCallback(() => {
    const token = params.token;
    if (!token || passwordSubmitting) return;
    if (password !== passwordConfirm) {
      setLoginError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setLoginError("Password must be at least 8 characters.");
      return;
    }
    setLoginError(null);
    setPasswordSubmitting(true);
    auth.acceptInvitationWithPassword(token, password, turnstile.token)
      .then((nextPath) => {
        setMessage("Invitation accepted. Redirecting...");
        setStatus("done");
        setTimeout(() => setLocation(nextPath ?? "/dashboard"), 900);
      })
      .catch((error) => {
        setStatus("error");
        setLoginError(error instanceof Error ? error.message : "Failed to set password.");
      })
      .finally(() => setPasswordSubmitting(false));
  }, [auth, params.token, passwordSubmitting, password, passwordConfirm, turnstile.token, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">Invitation</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {turnstile.enabled && status !== "done" && (
          <div className="mt-6 space-y-2">
            <turnstile.TurnstileWidget />
            {turnstile.error && <p className="text-destructive text-sm">{turnstile.error}</p>}
          </div>
        )}
        {status === "error" && (
          <Button onClick={() => setLocation("/dashboard")} className="w-full">
            Back to dashboard
          </Button>
        )}
        {auth.status === "unauthenticated" && params.token && resolution?.invitation?.state === "valid" && (
          <div className="space-y-2">
            {resolution.auth?.googleAllowed ? (
              <Button onClick={handleGoogleContinue} className="w-full" disabled={auth.loginInFlight}>
                {auth.loginInFlight ? "Starting Google sign-in..." : "Join with Google"}
              </Button>
            ) : null}
            {resolution.auth?.emailMode === "sign_in" ? (
              <Button
                variant="outline"
                onClick={() => setLocation(`/login?next=${encodeURIComponent(continuationPath ?? "/")}`)}
                className="w-full"
              >
                Sign in with email/password
              </Button>
            ) : null}
            {resolution.auth?.emailMode === "set_password" ? (
              <div className="space-y-2">
                <PasswordInput
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="w-full"
                  placeholder="Create password"
                  autoComplete="new-password"
                />
                <PasswordInput
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  className="w-full"
                  placeholder="Confirm password"
                  autoComplete="new-password"
                />
                <Button
                  variant="outline"
                  onClick={handleSetPassword}
                  className="w-full"
                  disabled={passwordSubmitting || !password || !passwordConfirm}
                >
                  {passwordSubmitting ? "Setting password..." : "Set password and join"}
                </Button>
              </div>
            ) : null}
            {loginError ? <p className="text-destructive text-sm text-center">{loginError}</p> : null}
          </div>
        )}
      </Card>
    </div>
  );
}
