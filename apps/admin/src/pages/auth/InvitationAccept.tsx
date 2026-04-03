import React from "react";
import { useLocation, useParams } from "wouter";
import { useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Params = { token?: string };

export default function InvitationAccept() {
  const params = useParams<Params>();
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const turnstile = useTurnstileToken();
  const [status, setStatus] = React.useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = React.useState("Preparing invitation acceptance...");
  const lastSubmittedRef = React.useRef<string | null>(null);
  const inFlightRef = React.useRef(false);

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

    if (auth.status === "unauthenticated") {
      const loginPath = `/login?next=${encodeURIComponent(`/invitations/${token}/accept`)}`;
      console.info("[INVITATION-FLOW] invitation accept redirecting to login with continuation", {
        target: loginPath,
      });
      setLocation(loginPath);
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
      .then(() => {
        if (cancelled) return;
        inFlightRef.current = false;
        setStatus("done");
        setMessage("Invitation accepted. Redirecting to dashboard...");
        console.info("[INVITATION-FLOW] invitation accept API call succeeded", {
          nextNavigation: "/dashboard",
        });
        setTimeout(() => setLocation("/dashboard"), 900);
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
  }, [auth, params.token, setLocation, turnstile.enabled, turnstile.reset, turnstile.token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">Invitation</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
        {turnstile.enabled && status !== "done" && (
          <div className="space-y-2 pt-1">
            <turnstile.TurnstileWidget />
            {turnstile.error && <p className="text-destructive text-sm">{turnstile.error}</p>}
          </div>
        )}
        {status === "error" && (
          <Button onClick={() => setLocation("/dashboard")} className="w-full">
            Back to dashboard
          </Button>
        )}
      </Card>
    </div>
  );
}
