import React from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chrome, ActivitySquare } from "lucide-react";
import {
  ADMIN_ACCESS_DENIED_ERROR,
  ADMIN_ACCESS_DENIED_MESSAGE,
  adminAccessDeniedLoginPath,
} from "./accessDenied";

export default function Login() {
  const [location, setLocation] = useLocation();
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const auth = useAuth();
  const {
    token: turnstileToken,
    error: turnstileError,
    enabled: turnstileEnabled,
    ready: turnstileReady,
    reset: resetTurnstile,
    TurnstileWidget,
  } = useTurnstileToken();

  const query = React.useMemo(() => new URLSearchParams(location.split("?")[1] ?? ""), [location]);
  const accessErrorCode = query.get("error");
  const accessError = accessErrorCode === ADMIN_ACCESS_DENIED_ERROR ? ADMIN_ACCESS_DENIED_MESSAGE : null;

  React.useEffect(() => {
    if (auth.status === "authenticated") {
      const next = new URLSearchParams(location.split("?")[1] ?? "").get("next");
      if (auth.user?.isSuperAdmin) {
        setLocation(next || "/dashboard");
      } else {
        setLocation(adminAccessDeniedLoginPath());
      }
    }
  }, [auth.status, setLocation, location]);

  if (auth.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <ActivitySquare className="w-10 h-10 text-primary animate-pulse" />
      </div>
    );
  }

  const handleGoogleLogin = () => {
    if (auth.loginInFlight) {
      return;
    }

    if (turnstileEnabled && !turnstileToken) {
      setLoginError("Please complete the verification challenge.");
      return;
    }

    setLoginError(null);
    auth.loginWithGoogle(turnstileToken).catch((error) => {
      console.error("Google sign-in failed", error);
      const message = error instanceof Error ? error.message : "Unable to start Google sign-in right now. Please try again.";
      setLoginError(message);
      if (turnstileEnabled) {
        resetTurnstile();
      }
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative bg-slate-50 dark:bg-slate-950 overflow-hidden">
      {/* Background Image */}
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
              <h1 className="text-3xl font-bold tracking-tight text-foreground mb-2">Welcome Back</h1>
              <p className="text-muted-foreground">Sign in to access the restricted super-admin console.</p>
            </div>

            {turnstileEnabled ? <TurnstileWidget /> : null}

            <Button 
              size="lg" 
              className="w-full h-12 text-base font-medium shadow-md transition-all group"
              onClick={handleGoogleLogin}
              disabled={auth.status === "authenticated" || auth.loginInFlight || (turnstileEnabled && (!turnstileToken || !turnstileReady))}
            >
              <Chrome className="w-5 h-5 mr-3 group-hover:scale-110 transition-transform" />
              {auth.loginInFlight ? "Starting Google sign-in..." : "Sign in with Google"}
            </Button>

            {accessError ? (
              <p className="mt-4 text-sm text-destructive text-center" role="alert">
                {accessError}
              </p>
            ) : null}

            {loginError ? (
              <p className="mt-4 text-sm text-destructive text-center" role="alert">
                {loginError}
              </p>
            ) : null}

            {turnstileError ? (
              <p className="mt-4 text-sm text-destructive text-center" role="alert">
                {turnstileError}
              </p>
            ) : null}

            <div className="mt-8 text-center text-sm text-muted-foreground">
              By signing in, you agree to our{" "}
              <a href="#" className="underline hover:text-primary transition-colors">Terms of Service</a>{" "}
              and{" "}
              <a href="#" className="underline hover:text-primary transition-colors">Privacy Policy</a>.
            </div>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
