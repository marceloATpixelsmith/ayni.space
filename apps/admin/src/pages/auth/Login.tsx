import React from "react";
import { Link, useLocation, useSearch } from "wouter";
import { motion } from "framer-motion";
import { isFullyAuthenticatedStatus, useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { Chrome, ActivitySquare } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import {
  ADMIN_ACCESS_DENIED_ERROR,
  ADMIN_ACCESS_DENIED_MESSAGE,
  adminAccessDeniedLoginPath,
} from "./accessDenied";
import { validateEmailInput } from "./authValidation";
import { AuthShell } from "./components/AuthShell";
import { FieldValidationMessage } from "./components/FieldValidationMessage";

const AUTH_DEBUG = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_AUTH_DEBUG === "true";

export function getLoginDisabledReasons(input: {
  authStatus: string;
  loginInFlight: boolean;
  csrfReady: boolean;
  csrfTokenPresent: boolean;
  turnstileEnabled: boolean;
  turnstileReady: boolean;
  turnstileTokenPresent: boolean;
}) {
  const reasons: string[] = [];
  if (input.authStatus === "authenticated_fully") reasons.push("auth.status===authenticated_fully");
  if (input.loginInFlight) reasons.push("auth.loginInFlight");
  if (!input.csrfReady) reasons.push("!auth.csrfReady");
  if (!input.csrfTokenPresent) reasons.push("!auth.csrfToken");
  if (input.turnstileEnabled && !input.turnstileTokenPresent) reasons.push("turnstileEnabled&&!turnstileToken");
  if (input.turnstileEnabled && !input.turnstileReady) reasons.push("turnstileEnabled&&!turnstileReady");
  return reasons;
}

function isInvitationContinuationPath(nextPath: string | null): nextPath is string {
  if (!nextPath) return false;
  return /^\/invitations\/[^/]+\/accept$/.test(nextPath);
}

export default function Login() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [emailInput, setEmailInput] = React.useState("");
  const [passwordInput, setPasswordInput] = React.useState("");
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const deniedCleanupAttemptedRef = React.useRef(false);
  const auth = useAuth();
  const {
    token: turnstileToken,
    error: turnstileError,
    enabled: turnstileEnabled,
    ready: turnstileReady,
    reset: resetTurnstile,
    TurnstileWidget,
  } = useTurnstileToken();

  const query = React.useMemo(() => new URLSearchParams(search), [search]);
  const nextPath = query.get("next");
  const accessErrorCode = query.get("error");
  const accessError = accessErrorCode === ADMIN_ACCESS_DENIED_ERROR ? ADMIN_ACCESS_DENIED_MESSAGE : null;
  const emailError = (emailTouched || submitted) ? validateEmailInput(emailInput) : null;

  React.useEffect(() => {
    if (!accessError) {
      deniedCleanupAttemptedRef.current = false;
      return;
    }
    if (!isFullyAuthenticatedStatus(auth.status)) return;
    if (deniedCleanupAttemptedRef.current) return;

    deniedCleanupAttemptedRef.current = true;
    void auth.logout();
  }, [accessError, auth.status, auth.logout]);

  React.useEffect(() => {
    if (AUTH_DEBUG) {
      console.info("[login] mount");
      return () => console.info("[login] cleanup");
    }
    return undefined;
  }, []);

  React.useEffect(() => {
    if (isFullyAuthenticatedStatus(auth.status)) {
      if (isInvitationContinuationPath(nextPath)) {
        setLocation(nextPath);
        return;
      }
      const appAccess = (auth.user as (typeof auth.user & { appAccess?: Record<string, unknown> }) | null)?.appAccess;
      const normalizedAccessProfile = appAccess?.["normalizedAccessProfile"];
      const canAccess = appAccess?.["canAccess"];
      const requiredOnboarding = appAccess?.["requiredOnboarding"];

      if (normalizedAccessProfile === "superadmin") {
        if (auth.user?.isSuperAdmin) {
          setLocation(nextPath || "/dashboard");
        } else {
          setLocation(adminAccessDeniedLoginPath());
        }
        return;
      }

      if (requiredOnboarding === "organization" && canAccess === false) {
        setLocation("/onboarding/organization");
        return;
      }

      if (canAccess === false) {
        setLocation(adminAccessDeniedLoginPath());
        return;
      }

      setLocation(nextPath || "/dashboard");
    }
  }, [auth.status, auth.user, setLocation, nextPath]);

  const disabledReasons = React.useMemo(
    () =>
      getLoginDisabledReasons({
        authStatus: auth.status,
        loginInFlight: auth.loginInFlight,
        csrfReady: auth.csrfReady,
        csrfTokenPresent: Boolean(auth.csrfToken),
        turnstileEnabled,
        turnstileReady,
        turnstileTokenPresent: Boolean(turnstileToken),
      }),
    [auth.status, auth.loginInFlight, auth.csrfReady, auth.csrfToken, turnstileEnabled, turnstileReady, turnstileToken],
  );

  React.useEffect(() => {
    if (!AUTH_DEBUG) return;
    const script = document.getElementById("cf-turnstile-script");
    console.info("[login] render state", {
      authStatus: auth.status,
      csrfReady: auth.csrfReady,
      csrfTokenPresent: Boolean(auth.csrfToken),
      turnstileEnabled,
      turnstileReady,
      turnstileTokenPresent: Boolean(turnstileToken),
      turnstileError,
      loginInFlight: auth.loginInFlight,
      windowTurnstileExists: Boolean(window.turnstile),
      turnstileScriptExists: Boolean(script),
      turnstileContainerExists: Boolean(document.querySelector(".min-h-16")),
      disabledReasons,
    });
  }, [auth.status, auth.csrfReady, auth.csrfToken, turnstileEnabled, turnstileReady, turnstileToken, turnstileError, auth.loginInFlight, disabledReasons]);

  if (auth.status === "loading") {
    return <div className="min-h-screen flex items-center justify-center bg-background"><ActivitySquare className="w-10 h-10 text-primary animate-pulse" /></div>;
  }

  const handlePasswordLogin = () => {
    setSubmitted(true);
    if (emailError) {
      setLoginError(emailError);
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      setLoginError("Please complete the verification challenge.");
      return;
    }

    setLoginError(null);
    auth.loginWithPassword(emailInput, passwordInput, turnstileToken).catch((error) => {
      setLoginError(error instanceof Error ? error.message : "Unable to sign in.");
    });
  };

  const handleGoogleLogin = (intent: "sign_in" | "create_account") => {
    if (auth.loginInFlight) {
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      setLoginError("Please complete the verification challenge.");
      return;
    }

    setLoginError(null);
    auth.loginWithGoogle(turnstileToken, intent, nextPath).catch((error) => {
      const message = error instanceof Error
        ? ((error instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(error.message))
            ? "Unable to reach the sign-in service. Please verify network/CORS configuration and try again."
            : error.message)
        : "Unable to start Google sign-in right now. Please try again.";
      setLoginError(message);
      if (turnstileEnabled) resetTurnstile();
    });
  };

  return (
    <AuthShell title="Welcome" subtitle="Sign in or create your account to continue.">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: "easeOut" }}>
        <Button size="lg" className="w-full h-12 text-base font-medium shadow-md transition-all group" onClick={() => handleGoogleLogin("sign_in")} disabled={disabledReasons.length > 0}>
          <Chrome className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform" />
          {auth.loginInFlight ? "Starting Google sign-in..." : "Sign in with Google"}
        </Button>

        <Button size="lg" variant="outline" className="w-full h-12 text-base font-medium mt-3" onClick={() => handleGoogleLogin("create_account")} disabled={disabledReasons.length > 0}>
          <Chrome className="w-5 h-5 mr-3" />
          {auth.loginInFlight ? "Starting account setup..." : "Create account with Google"}
        </Button>

        <div className="my-5 flex items-center gap-4"><div className="h-px flex-1 bg-border" /><span className="text-sm text-muted-foreground">or</span><div className="h-px flex-1 bg-border" /></div>

        <div className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onBlur={() => setEmailTouched(true)}
            aria-invalid={Boolean(emailError)}
            aria-describedby={emailError ? "login-email-error" : undefined}
          />
          <FieldValidationMessage id="login-email-error" message={emailError} />
          <PasswordInput className="w-full border rounded px-3 py-2" placeholder="Password" autoComplete="current-password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} />
          <Button className="w-full" onClick={handlePasswordLogin} disabled={auth.loginInFlight || !emailInput || !passwordInput || Boolean(validateEmailInput(emailInput)) || (turnstileEnabled && !turnstileToken)}>Sign in with email</Button>
          <div className="text-sm flex justify-between"><Link href="/signup">Create account</Link><Link href="/forgot-password">Forgot password?</Link></div>
        </div>

        <div className="mt-6">{turnstileEnabled ? <TurnstileWidget /> : null}</div>

        {accessError ? <p className="mt-4 text-sm text-destructive text-center" role="alert">{accessError}</p> : null}
        {loginError ? <p className="mt-4 text-sm text-destructive text-center" role="alert">{loginError}</p> : null}
        {turnstileError ? <p className="mt-4 text-sm text-destructive text-center" role="alert">{turnstileError}</p> : null}
      </motion.div>
    </AuthShell>
  );
}
