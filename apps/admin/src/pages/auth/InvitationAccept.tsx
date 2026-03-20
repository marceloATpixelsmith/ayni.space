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

  React.useEffect(() => {
    const token = params.token;
    if (!token) {
      setStatus("error");
      setMessage("Invitation token is missing.");
      return;
    }

    if (auth.status === "loading") {
      return;
    }

    if (auth.status === "unauthenticated") {
      setLocation(`/login?next=${encodeURIComponent(`/invitations/${token}/accept`)}`);
      return;
    }

    if (turnstile.enabled && !turnstile.token) {
      setStatus("idle");
      setMessage("Complete verification to accept this invitation.");
      return;
    }

    let cancelled = false;
    setStatus("working");
    setMessage("Accepting invitation...");

    auth
      .acceptInvitation(token, turnstile.token)
      .then(() => {
        if (cancelled) return;
        setStatus("done");
        setMessage("Invitation accepted. Redirecting to dashboard...");
        setTimeout(() => setLocation("/dashboard"), 900);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Failed to accept invitation.");
        turnstile.reset();
      });

    return () => {
      cancelled = true;
    };
  }, [auth, params.token, setLocation, turnstile]);

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
