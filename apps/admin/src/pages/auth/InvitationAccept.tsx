import React from "react";
import { useLocation, useParams } from "wouter";
import { useAuth, useTurnstileToken } from "@workspace/frontend-security";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { motion } from "framer-motion";
import { AuthShell } from "./components/AuthShell";
import { AuthMethodDivider } from "./components/AuthMethodDivider";
import { FieldValidationMessage } from "./components/FieldValidationMessage";
import { GoogleAuthButton } from "./components/GoogleAuthButton";
import {
  getMissingPasswordRequirements,
  validatePasswordInput,
} from "./authValidation";

type Params = { token?: string };
type InvitationState =
  | "valid"
  | "pending"
  | "invalid"
  | "expired"
  | "accepted"
  | "revoked";
type EmailMode = "set_password" | "create_password" | "sign_in" | "none";
type InvitationResolveResponse = {
  invitation?: {
    state?: InvitationState;
    email?: string | null;
  };
  auth?: {
    googleAllowed?: boolean;
    emailMode?: EmailMode;
  };
};

function isInvitationState(value: unknown): value is InvitationState {
  return (
    value === "valid" ||
    value === "pending" ||
    value === "invalid" ||
    value === "expired" ||
    value === "accepted" ||
    value === "revoked"
  );
}

function isEmailMode(value: unknown): value is EmailMode {
  return (
    value === "set_password" ||
    value === "create_password" ||
    value === "sign_in" ||
    value === "none"
  );
}

function normalizeInvitationState(
  value: InvitationState,
): Exclude<InvitationState, "pending"> {
  return value === "pending" ? "valid" : value;
}

function normalizeEmailMode(
  value: EmailMode,
): Exclude<EmailMode, "create_password"> {
  return value === "create_password" ? "set_password" : value;
}

function isInvitationResolveResponse(
  value: unknown,
): value is InvitationResolveResponse {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  const invitation = payload["invitation"];
  const auth = payload["auth"];
  if (!invitation || typeof invitation !== "object") return false;
  if (!auth || typeof auth !== "object") return false;
  const invitationState = (invitation as Record<string, unknown>)["state"];
  const emailMode = (auth as Record<string, unknown>)["emailMode"];
  return isInvitationState(invitationState) && isEmailMode(emailMode);
}

export default function InvitationAccept() {
  const params = useParams<Params>();
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const turnstile = useTurnstileToken();
  const [status, setStatus] = React.useState<
    "idle" | "working" | "done" | "error"
  >("idle");
  const [message, setMessage] = React.useState(
    "Preparing invitation acceptance...",
  );
  const [loginError, setLoginError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [passwordTouched, setPasswordTouched] = React.useState(false);
  const [resolution, setResolution] =
    React.useState<InvitationResolveResponse | null>(null);
  const [resolutionStatus, setResolutionStatus] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [resolutionError, setResolutionError] = React.useState<string | null>(
    null,
  );
  const [passwordSubmitting, setPasswordSubmitting] = React.useState(false);
  const lastSubmittedRef = React.useRef<string | null>(null);
  const inFlightRef = React.useRef(false);
  const continuationPath = React.useMemo(
    () => (params.token ? `/invitations/${params.token}/accept` : null),
    [params.token],
  );
  const resolveApiUrl = React.useMemo(() => {
    const token = params.token;
    if (!token) return null;

    const invitationResolvePath = `/invitations/${token}/resolve`;
    const apiBase =
      (
        import.meta as ImportMeta & { env?: Record<string, string | undefined> }
      ).env?.VITE_API_BASE_URL?.trim() ?? "";
    if (!apiBase) {
      return `/api${invitationResolvePath}`;
    }

    const normalizedApiBase = apiBase.replace(/\/$/, "");
    const apiBaseIncludesApiPrefix = /\/api$/i.test(normalizedApiBase);
    const apiPrefix = apiBaseIncludesApiPrefix ? "" : "/api";
    return `${normalizedApiBase}${apiPrefix}${invitationResolvePath}`;
  }, [params.token]);
  const invitationState = resolution?.invitation?.state
    ? normalizeInvitationState(resolution.invitation.state)
    : undefined;
  const isValidPendingInvitation = invitationState === "valid";
  const resolutionAuth =
    resolution?.auth && resolution.auth.emailMode
      ? {
          ...resolution.auth,
          emailMode: normalizeEmailMode(resolution.auth.emailMode),
        }
      : undefined;
  // Contract guard: auth.status === "unauthenticated" && params.token && isValidPendingInvitation && resolutionStatus === "ready"
  const shouldShowInvitationChoices =
    auth.status === "unauthenticated" &&
    params.token &&
    isValidPendingInvitation &&
    resolutionStatus === "ready";
  const shouldShowPasswordFields =
    shouldShowInvitationChoices && resolutionAuth?.emailMode === "set_password";
  const passwordError =
    passwordTouched || passwordSubmitting
      ? validatePasswordInput(password)
      : null;
  const shouldShowPasswordFeedback = passwordTouched || password.length > 0;
  const missingPasswordRequirements = shouldShowPasswordFeedback
    ? getMissingPasswordRequirements(password)
    : [];
  const canSubmitPassword = Boolean(
    shouldShowPasswordFields &&
    password &&
    !passwordError &&
    turnstile.canSubmit,
  );

  React.useEffect(() => {
    if (!resolveApiUrl) {
      setResolution(null);
      setResolutionStatus("idle");
      setResolutionError(null);
      return;
    }
    let cancelled = false;
    setResolutionStatus("loading");
    setResolutionError(null);
    fetch(resolveApiUrl, { credentials: "include" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error("Unable to resolve invitation state.");
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        if (!isInvitationResolveResponse(payload)) {
          throw new Error("Invitation state payload was incomplete.");
        }
        setResolution(payload);
        setResolutionStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResolution(null);
        setResolutionStatus("error");
        setResolutionError(
          error instanceof Error
            ? error.message
            : "Unable to resolve invitation state.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [resolveApiUrl]);

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

    if (invitationState && invitationState !== "valid") {
      inFlightRef.current = false;
      setStatus("error");
      const terminalMessage =
        invitationState === "expired"
          ? "This invitation has expired."
          : invitationState === "accepted"
            ? "This invitation has already been accepted."
            : invitationState === "revoked"
              ? "This invitation has been revoked."
              : "This invitation is invalid.";
      setMessage(terminalMessage);
      return;
    }

    if (auth.status === "unauthenticated") {
      inFlightRef.current = false;
      setStatus("idle");
      setMessage("Sign in to continue accepting this invitation.");
      if (resolutionStatus === "loading") {
        setMessage("Checking invitation status...");
      } else if (resolutionStatus === "error") {
        setStatus("error");
        setMessage("We couldn't load this invitation right now. Please retry.");
      } else if (resolutionAuth?.emailMode === "set_password") {
        setMessage("Set your password to join this invitation.");
      }
      setLoginError(null);
      console.info(
        "[INVITATION-FLOW] invitation accept awaiting explicit sign-in action",
        {
          continuationPath: `/invitations/${token}/accept`,
        },
      );
      return;
    }

    if (turnstile.enabled && !turnstile.token) {
      inFlightRef.current = false;
      setStatus("idle");
      setMessage(
        turnstile.guidanceMessage ??
          "Complete verification to accept this invitation.",
      );
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
      .then((nextPath) => {
        if (cancelled) return;
        inFlightRef.current = false;
        setStatus("done");
        const destination = nextPath ?? "/dashboard";
        setMessage("Invitation accepted. Redirecting...");
        console.info("[INVITATION-FLOW] invitation accept API call succeeded", {
          nextNavigation: destination,
        });
        setTimeout(() => setLocation(destination), 900);
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
  }, [
    auth,
    params.token,
    resolutionStatus,
    resolutionAuth?.emailMode,
    setLocation,
    turnstile.enabled,
    turnstile.reset,
    turnstile.token,
    invitationState,
  ]);

  const handleGoogleContinue = React.useCallback(() => {
    if (!continuationPath || auth.loginInFlight) return;
    if (turnstile.enabled && !turnstile.token) {
      setLoginError("Please complete the verification challenge.");
      return;
    }
    setLoginError(null);
    auth
      .loginWithGoogle(turnstile.token, "sign_in", continuationPath)
      .catch((error) => {
        setLoginError(
          error instanceof Error
            ? error.message
            : "Unable to start Google sign-in.",
        );
        if (turnstile.enabled) {
          turnstile.reset();
        }
      });
  }, [
    auth,
    continuationPath,
    turnstile.enabled,
    turnstile.reset,
    turnstile.token,
  ]);

  const handleSetPassword = React.useCallback(() => {
    const token = params.token;
    if (!token || passwordSubmitting) return;
    const validationError = validatePasswordInput(password);
    if (validationError) {
      setPasswordTouched(true);
      setLoginError(validationError);
      return;
    }
    setLoginError(null);
    setPasswordSubmitting(true);
    auth
      .acceptInvitationWithPassword(token, password, turnstile.token)
      .then((nextPath) => {
        setMessage("Invitation accepted. Redirecting...");
        setStatus("done");
        setTimeout(() => setLocation(nextPath ?? "/dashboard"), 900);
      })
      .catch((error) => {
        setStatus("error");
        setLoginError(
          error instanceof Error ? error.message : "Failed to set password.",
        );
      })
      .finally(() => setPasswordSubmitting(false));
  }, [
    auth,
    params.token,
    passwordSubmitting,
    password,
    turnstile.token,
    setLocation,
  ]);

  return (
    <AuthShell
      title="Invitation"
      subtitle={shouldShowInvitationChoices ? undefined : message}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        {status === "error" ? (
          <div className="space-y-2">
            {resolutionError ? (
              <p className="text-destructive text-sm text-center">
                {resolutionError}
              </p>
            ) : null}
            <Button
              onClick={() =>
                setLocation(
                  auth.status === "unauthenticated" ? "/login" : "/dashboard",
                )
              }
              className="w-full"
            >
              {auth.status === "unauthenticated"
                ? "Back to sign in"
                : "Back to dashboard"}
            </Button>
          </div>
        ) : null}
        {shouldShowInvitationChoices ? (
          <div className="space-y-3">
            <GoogleAuthButton
              onClick={handleGoogleContinue}
              disabled={auth.loginInFlight}
              loading={auth.loginInFlight}
              idleLabel="Continue with Google"
              loadingLabel="Starting Google sign-in..."
            />

            {shouldShowPasswordFields ? (
              <>
                <AuthMethodDivider />
                <p className="text-sm text-foreground">
                  Create a password to log in
                </p>
                <PasswordInput
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onBlur={() => setPasswordTouched(true)}
                  className="w-full border rounded px-3 py-2"
                  placeholder="Password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={
                    passwordError ? "invite-password-error" : undefined
                  }
                />
                <FieldValidationMessage
                  id="invite-password-error"
                  message={passwordError}
                />
                {shouldShowPasswordFeedback &&
                missingPasswordRequirements.length > 0 ? (
                  <ul
                    className="text-xs text-destructive list-disc pl-5 space-y-1"
                    aria-live="polite"
                  >
                    {missingPasswordRequirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
                ) : null}
                <Button
                  onClick={handleSetPassword}
                  className="w-full"
                  disabled={passwordSubmitting || !canSubmitPassword}
                >
                  {passwordSubmitting
                    ? "Setting password..."
                    : "Set password and join"}
                </Button>
              </>
            ) : null}
            {loginError ? (
              <p className="text-destructive text-sm">{loginError}</p>
            ) : null}
          </div>
        ) : null}
        {turnstile.enabled && status !== "done" ? (
          <div className="mt-6 space-y-2">
            <turnstile.TurnstileWidget />
            {turnstile.guidanceMessage ? (
              <p
                className={`text-sm ${turnstile.status === "error" || turnstile.status === "expired" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {turnstile.guidanceMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </motion.div>
    </AuthShell>
  );
}
