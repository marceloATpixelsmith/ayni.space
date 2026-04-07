import React from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useAuth } from "@workspace/frontend-security";
import { validateEmailInput } from "@workspace/frontend-security";
import { AuthShell } from "@workspace/auth-ui";
import { FieldValidationMessage } from "@workspace/auth-ui";

export default function ForgotPassword() {
  const auth = useAuth();
  const [email, setEmail] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const emailError = (emailTouched || submitted) ? validateEmailInput(email) : null;

  const submit = () => {
    setSubmitted(true);
    if (emailError) {
      setMessage(emailError);
      return;
    }
    auth.forgotPassword(email).then((result) => {
      setMessage(result.resetToken ? `Test reset token: ${result.resetToken}` : "If an account exists, a reset email has been sent.");
    });
  };

  return (
    <AuthShell title="Forgot password" subtitle="Enter your email and we'll send reset instructions.">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}>
        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setEmailTouched(true)}
            placeholder="Email"
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "forgot-email-error" : undefined}
          />
          <FieldValidationMessage id="forgot-email-error" message={emailError} />
          <Button className="w-full" onClick={submit} disabled={!email || Boolean(validateEmailInput(email))}>Send reset link</Button>
        </div>

        {message ? <p className="mt-4 text-sm">{message}</p> : null}
        <p className="mt-4 text-sm text-muted-foreground">Remembered your password? <Link href="/login" className="underline">Back to sign in</Link></p>
      </motion.div>
    </AuthShell>
  );
}
