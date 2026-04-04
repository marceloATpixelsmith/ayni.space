import React from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@workspace/frontend-security";
import { validateEmailInput } from "./authValidation";

export default function ForgotPassword() {
  const auth = useAuth();
  const [email, setEmail] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const submit = () => {
    setSubmitted(true);
    const emailError = validateEmailInput(email);
    if (emailError) {
      setMessage(emailError);
      return;
    }
    auth.forgotPassword(email).then((result) => {
      setMessage(result.resetToken ? `Test reset token: ${result.resetToken}` : "If an account exists, a reset email has been sent.");
    });
  };

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
              <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Forgot password</h1>
              <p className="text-muted-foreground">Enter your email and we&apos;ll send reset instructions.</p>
            </div>

            <div className="space-y-3">
              <input className="w-full border rounded px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setEmailTouched(true)} placeholder="Email" />
              {(emailTouched || submitted) && validateEmailInput(email) ? <p className="text-xs text-destructive">{validateEmailInput(email)}</p> : null}
              <Button className="w-full" onClick={submit} disabled={!email || Boolean(validateEmailInput(email))}>Send reset link</Button>
            </div>

            {message ? <p className="mt-4 text-sm">{message}</p> : null}
            <p className="mt-4 text-sm text-muted-foreground">
              Remembered your password? <Link href="/login" className="underline">Back to sign in</Link>
            </p>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
