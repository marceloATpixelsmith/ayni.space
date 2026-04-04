import React from "react";
import { useLocation } from "wouter";
import { useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";

export default function Signup() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const turnstile = useTurnstileToken();

  const onSubmit = () => {
    if (turnstile.enabled && !turnstile.token) {
      setError("Please complete the verification challenge.");
      return;
    }

    setError(null);
    auth.signupWithPassword(email, password, name, turnstile.token).then((result) => {
      if (result.verifyToken) setLocation(`/verify-email?token=${encodeURIComponent(result.verifyToken)}`);
      else setLocation("/dashboard");
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Unable to sign up.");
      if (turnstile.enabled) {
        turnstile.reset();
      }
    });
  };

  return <div className="min-h-screen flex items-center justify-center"><div className="w-full max-w-md space-y-3 p-6 border rounded">
    <h1 className="text-xl font-semibold">Create account</h1>
    <input className="w-full border rounded px-3 py-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
    <input className="w-full border rounded px-3 py-2" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
    <PasswordInput className="w-full border rounded px-3 py-2" placeholder="Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
    {turnstile.enabled ? <turnstile.TurnstileWidget /> : null}
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
    {turnstile.error ? <p className="text-sm text-destructive">{turnstile.error}</p> : null}
    <Button className="w-full" onClick={onSubmit} disabled={!name || !email || !password || (turnstile.enabled && (!turnstile.ready || !turnstile.token))}>Sign up</Button>
  </div></div>;
}
