import React from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Chrome } from "lucide-react";
import { useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { getMissingPasswordRequirements, normalizeEmailInput, validateEmailInput, validatePasswordInput } from "./authValidation";

export default function Signup() {
  const auth = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const turnstile = useTurnstileToken();

  const onSubmit = () => {
    setSubmitted(true);
    const emailError = validateEmailInput(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    const passwordError = validatePasswordInput(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (turnstile.enabled && !turnstile.token) {
      setError("Please complete the verification challenge.");
      return;
    }

    setError(null);
    const normalizedEmail = normalizeEmailInput(email);
    auth.signupWithPassword(normalizedEmail, password, name, turnstile.token).then((result) => {
      const query = new URLSearchParams();
      query.set("email", normalizedEmail);
      if (result.appSlug) query.set("appSlug", result.appSlug);
      if (result.verifyToken) query.set("token", result.verifyToken);
      setLocation(`/verify-email?${query.toString()}`);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "Unable to sign up.");
      if (turnstile.enabled) {
        turnstile.reset();
      }
    });
  };

  const onGoogleSignup = () => {
    if (turnstile.enabled && !turnstile.token) {
      setError("Please complete the verification challenge.");
      return;
    }

    setError(null);
    auth.loginWithGoogle(turnstile.token, "create_account").catch((err) => {
      setError(err instanceof Error ? err.message : "Unable to start Google account setup.");
      if (turnstile.enabled) {
        turnstile.reset();
      }
    });
  };

  const shouldShowEmailError = emailTouched || submitted;
  const shouldShowPasswordFeedback = password.length > 0;
  const missingPasswordRequirements = getMissingPasswordRequirements(password);

  return (
    <div className="min-h-screen flex items-center justify-center relative bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <img
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt="Abstract background"
          className="w-full h-full object-cover opacity-60 mix-blend-multiply"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
      </div>

      <div className="relative z-10 w-full max-w-md p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <div className="flex justify-center mb-8">
            <img
              src={`${import.meta.env.BASE_URL}images/logo.png`}
              alt="Logo"
              className="w-16 h-16 object-contain drop-shadow-xl"
            />
          </div>

          <Card className="p-8 backdrop-blur-xl bg-card/90 border-white/20 shadow-2xl shadow-primary/5">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Create account</h1>
              <p className="text-muted-foreground">Create your account to continue.</p>
            </div>

            <Button
              size="lg"
              className="w-full h-12 text-base font-medium shadow-md transition-all group"
              onClick={onGoogleSignup}
              disabled={auth.loginInFlight || (turnstile.enabled && (!turnstile.ready || !turnstile.token))}
            >
              <Chrome className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform" />
              {auth.loginInFlight ? "Starting account setup..." : "Create account with Google"}
            </Button>

            <div className="my-5 flex items-center gap-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-sm text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="space-y-3">
              <input className="w-full border rounded px-3 py-2" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
              <input className="w-full border rounded px-3 py-2" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setEmailTouched(true)} />
              <PasswordInput className="w-full border rounded px-3 py-2" placeholder="Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {shouldShowEmailError && validateEmailInput(email) ? <p className="text-xs text-destructive">{validateEmailInput(email)}</p> : null}
              {shouldShowPasswordFeedback && missingPasswordRequirements.length > 0 ? (
                <ul className="text-xs text-destructive list-disc pl-5 space-y-1" aria-live="polite">
                  {missingPasswordRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              ) : null}
              <Button className="w-full" onClick={onSubmit} disabled={!name || !email || !password || Boolean(validateEmailInput(email)) || Boolean(validatePasswordInput(password)) || (turnstile.enabled && (!turnstile.ready || !turnstile.token))}>Sign up with email</Button>
            </div>

            <div className="mt-6">
              {turnstile.enabled ? <turnstile.TurnstileWidget /> : null}
            </div>
            {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
            {turnstile.error ? <p className="mt-4 text-sm text-destructive">{turnstile.error}</p> : null}
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
