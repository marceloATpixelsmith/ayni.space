import React from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";

export default function Signup() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = () => {
    setError(null);
    auth.signupWithPassword(email, password, name).then((result) => {
      if (result.verifyToken) setLocation(`/verify-email?token=${encodeURIComponent(result.verifyToken)}`);
      else setLocation("/dashboard");
    }).catch((err) => setError(err instanceof Error ? err.message : "Unable to sign up."));
  };

  return <div className="min-h-screen flex items-center justify-center"><div className="w-full max-w-md space-y-3 p-6 border rounded">
    <h1 className="text-xl font-semibold">Create account</h1>
    <input className="w-full border rounded px-3 py-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
    <input className="w-full border rounded px-3 py-2" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
    <input className="w-full border rounded px-3 py-2" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
    {error ? <p className="text-sm text-destructive">{error}</p> : null}
    <Button className="w-full" onClick={onSubmit}>Sign up</Button>
  </div></div>;
}
