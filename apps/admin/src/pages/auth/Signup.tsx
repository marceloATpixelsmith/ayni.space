import React from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { Chrome } from "lucide-react";
import { useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { getMissingPasswordRequirements, normalizeEmailInput, validateEmailInput, validatePasswordInput } from "./authValidation";
import { AuthShell } from "./components/AuthShell";
import { FieldValidationMessage } from "./components/FieldValidationMessage";

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

  const emailError = (emailTouched || submitted) ? validateEmailInput(email) : null;
  const shouldShowPasswordFeedback = password.length > 0;
  const missingPasswordRequirements = getMissingPasswordRequirements(password);

  const onSubmit = () => {
    setSubmitted(true);
    if (!auth.csrfReady || !auth.csrfToken) {
      setError("Security token is not ready. Please wait a moment and try again.");
      return;
    }
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
      if (turnstile.enabled) turnstile.reset();
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
      if (turnstile.enabled) turnstile.reset();
    });
  };

  return (
    <AuthShell title="Create account" subtitle="Create your account to continue.">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}>
        <Button size="lg" className="w-full h-12 text-base font-medium shadow-md transition-all group" onClick={onGoogleSignup} disabled={auth.loginInFlight || !auth.csrfReady || !auth.csrfToken || (turnstile.enabled && (!turnstile.ready || !turnstile.token))}>
          <Chrome className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform" />
          {auth.loginInFlight ? "Starting account setup..." : "Create account with Google"}
        </Button>

        <div className="my-5 flex items-center gap-4"><div className="h-px flex-1 bg-border" /><span className="text-sm text-muted-foreground">or</span><div className="h-px flex-1 bg-border" /></div>

        <div className="space-y-3">
          <input className="w-full border rounded px-3 py-2" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setEmailTouched(true)}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "signup-email-error" : undefined}
          />
          <FieldValidationMessage id="signup-email-error" message={emailError} />

          <PasswordInput className="w-full border rounded px-3 py-2" placeholder="Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={shouldShowPasswordFeedback && missingPasswordRequirements.length > 0} aria-describedby={shouldShowPasswordFeedback && missingPasswordRequirements.length > 0 ? "signup-password-error" : undefined} />
          {shouldShowPasswordFeedback && missingPasswordRequirements.length > 0 ? (
            <ul id="signup-password-error" className="text-xs text-destructive list-disc pl-5 space-y-1" aria-live="polite">
              {missingPasswordRequirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          ) : null}
          <Button className="w-full" onClick={onSubmit} disabled={!auth.csrfReady || !auth.csrfToken || !name || !email || !password || Boolean(validateEmailInput(email)) || Boolean(validatePasswordInput(password)) || (turnstile.enabled && (!turnstile.ready || !turnstile.token))}>Sign up with email</Button>
        </div>

        <div className="mt-6">{turnstile.enabled ? <turnstile.TurnstileWidget /> : null}</div>
        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        {turnstile.error ? <p className="mt-4 text-sm text-destructive">{turnstile.error}</p> : null}
      </motion.div>
    </AuthShell>
  );
}
