import React from "react";
import {
  DEFAULT_POST_AUTH_PATH,
  buildAdminAccessDeniedLoginPath,
  getAuthErrorMessage,
  isFullyAuthenticatedStatus,
  parseAuthErrorCode,
  resolveAuthenticatedNextStep,
  deriveAppAuthRoutePolicy,
  useAuth,
  useCurrentPlatformAppMetadata,
  useTurnstileToken,
} from "./index";
import {
  ensureTurnstileReadyForSubmit,
  getAuthActionErrorMessage,
  handleTurnstileProtectedAuthError,
  useAuthSubmitOrchestration,
} from "./auth-form-runtime";
import {
  getMissingPasswordRequirements,
  normalizeEmailInput,
  validatePasswordInput,
} from "./authValidation";

export function getLoginDisabledReasons(input: {
  authStatus: ReturnType<typeof useAuth>["status"];
  loginInFlight: boolean;
  csrfReady: boolean;
  csrfTokenPresent: boolean;
  turnstileEnabled: boolean;
  turnstileReady: boolean;
  turnstileTokenPresent: boolean;
}) {
  const reasons: string[] = [];
  if (input.authStatus === "authenticated_fully") {
    reasons.push("auth.status===authenticated_fully");
  }
  if (input.loginInFlight) reasons.push("auth.loginInFlight");
  if (!input.csrfReady) reasons.push("!auth.csrfReady");
  if (!input.csrfTokenPresent) reasons.push("!auth.csrfToken");
  if (input.turnstileEnabled && !input.turnstileReady) reasons.push("turnstileEnabled&&!turnstileReady");
  if (input.turnstileEnabled && !input.turnstileTokenPresent) reasons.push("turnstileEnabled&&!turnstileToken");
  return reasons;
}

export function useLoginRouteComposition() {
  const auth = useAuth();
  const { metadata } = useCurrentPlatformAppMetadata();
  const turnstile = useTurnstileToken();

  const hideSignupAffordances =
    metadata?.authRoutePolicy?.allowCustomerRegistration === false ||
    metadata?.normalizedAccessProfile === "superadmin";

  return {
    auth,
    metadata,
    turnstile,
    hideSignupAffordances,
  };
}

export function useLoginRoutePolicy(options: {
  search: string;
  onRedirect: (path: string) => void;
}) {
  const { search, onRedirect } = options;
  const { auth, metadata, turnstile, hideSignupAffordances } =
    useLoginRouteComposition();
  const query = React.useMemo(
    () => new URLSearchParams(search),
    [search],
  );
  const nextPath = query.get("next");
  const accessError = getAuthErrorMessage(parseAuthErrorCode(query.get("error")));
  const deniedCleanupAttemptedRef = React.useRef(false);

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
    if (!isFullyAuthenticatedStatus(auth.status)) return;

    const nextStep = resolveAuthenticatedNextStep({
      authStatus: auth.status,
      user: auth.user,
      continuationPath: nextPath,
      deniedLoginPath: buildAdminAccessDeniedLoginPath(),
      defaultPath: DEFAULT_POST_AUTH_PATH,
    });
    onRedirect(nextStep.destination);
  }, [auth.status, auth.user, nextPath, onRedirect]);

  return {
    auth,
    metadata,
    turnstile,
    hideSignupAffordances,
    nextPath,
    accessError,
  };
}

export function useSignupRoutePolicy(options: {
  locationPath: string;
  signupPath?: string;
  onRedirect: (path: string) => void;
}) {
  const { metadata, loading } = useCurrentPlatformAppMetadata();
  const metadataResolved = !loading;
  const signupAllowed = deriveAppAuthRoutePolicy(metadata).allowCustomerRegistration;
  const signupPath = options.signupPath ?? "/signup";

  React.useEffect(() => {
    if (!metadataResolved || signupAllowed) return;
    if (options.locationPath !== signupPath) return;
    options.onRedirect("/login");
  }, [metadataResolved, signupAllowed, options.locationPath, options.onRedirect, signupPath]);

  return {
    metadataResolved,
    signupAllowed,
  };
}

function buildVerifyEmailPath(input: {
  email: string;
  appSlug?: string;
  verifyToken?: string;
}): string {
  const query = new URLSearchParams();
  query.set("email", input.email);
  if (input.appSlug) query.set("appSlug", input.appSlug);
  if (input.verifyToken) query.set("token", input.verifyToken);
  return `/verify-email?${query.toString()}`;
}

export function getSignupDisabledReasons(input: {
  signupInFlight: boolean;
  emailPresent: boolean;
  passwordPresent: boolean;
  emailError: boolean;
  passwordError: boolean;
}) {
  const reasons: string[] = [];
  if (input.signupInFlight) reasons.push("auth.signupInFlight");
  if (!input.emailPresent) reasons.push("!email");
  if (!input.passwordPresent) reasons.push("!password");
  if (input.emailError) reasons.push("email.invalid");
  if (input.passwordError) reasons.push("password.invalid");
  return reasons;
}

export function useSignupRouteActions(options: {
  auth: ReturnType<typeof useAuth>;
  turnstile: ReturnType<typeof useTurnstileToken>;
  email: string;
  password: string;
  emailError: string | null;
  onRedirect: (path: string) => void;
}) {
  const submit = useAuthSubmitOrchestration();
  const { auth, turnstile, email, password, emailError, onRedirect } = options;

  const handleSignup = React.useCallback(() => {
    if (!auth.csrfReady || !auth.csrfToken) {
      submit.setError(
        "Security token is not ready. Please wait a moment and try again.",
      );
      return;
    }
    if (emailError) {
      submit.setError(emailError);
      return;
    }
    const passwordError = validatePasswordInput(password);
    if (passwordError) {
      submit.setError(passwordError);
      return;
    }
    const turnstileError = ensureTurnstileReadyForSubmit(turnstile);
    if (turnstileError) {
      submit.setError(turnstileError);
      return;
    }

    const normalizedEmail = normalizeEmailInput(email);
    void submit
      .run(() =>
        auth.signupWithPassword(
          normalizedEmail,
          password,
          turnstile.token,
        ),
      )
      .then((result) => {
        onRedirect(
          buildVerifyEmailPath({
            email: normalizedEmail,
            appSlug: result.appSlug,
            verifyToken: result.verifyToken,
          }),
        );
      })
      .catch((error) => {
        handleTurnstileProtectedAuthError({
          error,
          turnstile,
          setError: submit.setError,
          fallbackMessage: "Unable to sign up.",
        });
      });
  }, [auth, email, emailError, onRedirect, password, submit, turnstile]);

  return {
    submit,
    handleSignup,
  };
}

export function useLoginRouteActions(options: {
  auth: ReturnType<typeof useAuth>;
  turnstile: ReturnType<typeof useTurnstileToken>;
  nextPath: string | null;
  hideSignupAffordances: boolean;
  email: string;
  password: string;
  emailError: string | null;
}) {
  const submit = useAuthSubmitOrchestration();
  const [loginError, setLoginError] = React.useState<string | null>(null);

  const handlePasswordLogin = React.useCallback(() => {
    if (options.emailError) {
      setLoginError(options.emailError);
      return;
    }
    const turnstileError = ensureTurnstileReadyForSubmit(options.turnstile);
    if (turnstileError) {
      setLoginError(turnstileError);
      return;
    }

    setLoginError(null);
    const turnstileToken = options.turnstile.token;
    void submit
      .run(() =>
        options.auth.loginWithPassword(
          options.email,
          options.password,
          turnstileToken,
          options.nextPath,
        ),
      )
      .catch((error) => {
        setLoginError(
          getAuthActionErrorMessage(error, "Unable to sign in."),
        );
      });
  }, [
    options.auth,
    options.email,
    options.emailError,
    options.nextPath,
    options.password,
    options.turnstile,
    submit,
  ]);

  const handleGoogleLogin = React.useCallback(
    (intent: "sign_in" | "create_account") => {
      if (options.auth.loginInFlight) return;
      if (options.hideSignupAffordances && intent === "create_account") return;

      const turnstileError = ensureTurnstileReadyForSubmit(options.turnstile);
      if (turnstileError) {
        setLoginError(turnstileError);
        return;
      }

      setLoginError(null);
      const turnstileToken = options.turnstile.token;
      if (!turnstileToken) {
        setLoginError("Please complete verification before continuing.");
        return;
      }
      void submit
        .run(() =>
          options.auth.loginWithGoogle(
            turnstileToken,
            intent,
            options.nextPath,
          ),
        )
        .catch((error) => {
          const maybeNetworkError =
            error instanceof TypeError ||
            (error instanceof Error &&
              /Failed to fetch|NetworkError|Load failed/i.test(error.message));
          handleTurnstileProtectedAuthError({
            error: maybeNetworkError
              ? new Error(
                  "Unable to reach the sign-in service. Please verify network/CORS configuration and try again.",
                )
              : error,
            turnstile: options.turnstile,
            setError: setLoginError,
            fallbackMessage:
              "Unable to start Google sign-in right now. Please try again.",
          });
        });
    },
    [options.auth, options.hideSignupAffordances, options.nextPath, options.turnstile, submit],
  );

  return {
    submit,
    loginError,
    setLoginError,
    handlePasswordLogin,
    handleGoogleLogin,
  };
}

type InvitationState = "valid" | "pending" | "invalid" | "expired" | "accepted" | "revoked";
type InvitationTerminalState = Exclude<InvitationState, "pending" | "valid">;
type EmailMode = "create_password" | "sign_in" | "none";
type InvitationResolveResponse = {
  invitation: {
    state: InvitationState;
    email?: string | null;
  };
  auth: {
    googleAllowed?: boolean;
    emailMode: EmailMode;
  };
};

function isInvitationState(value: unknown): value is InvitationState {
  return value === "valid" || value === "pending" || value === "invalid" || value === "expired" || value === "accepted" || value === "revoked";
}

function isEmailMode(value: unknown): value is EmailMode {
  return value === "create_password" || value === "sign_in" || value === "none";
}

function isInvitationResolveResponse(value: unknown): value is InvitationResolveResponse {
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

function normalizeInvitationState(value: InvitationState): InvitationState {
  return value === "pending" ? "valid" : value;
}

function getTerminalInvitationMessage(state: InvitationTerminalState): string {
  if (state === "expired") return "This invitation has expired.";
  if (state === "accepted") return "This invitation has already been accepted.";
  if (state === "revoked") return "This invitation has been revoked.";
  return "This invitation is invalid.";
}

function getInvitationResolveApiUrl(token: string | undefined): string | null {
  if (!token) return null;
  const invitationResolvePath = `/invitations/${token}/resolve`;
  const apiBase = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE_URL?.trim() ?? "";
  if (!apiBase) return `/api${invitationResolvePath}`;
  const normalizedApiBase = apiBase.replace(/\/$/, "");
  const apiBaseIncludesApiPrefix = /\/api$/i.test(normalizedApiBase);
  const apiPrefix = apiBaseIncludesApiPrefix ? "" : "/api";
  return `${normalizedApiBase}${apiPrefix}${invitationResolvePath}`;
}

type InvitationSubmitState = "idle" | "working" | "done" | "error";
type InvitationResolutionState = "idle" | "loading" | "ready" | "error";

export function useInvitationAcceptRouteRuntime(options: {
  token?: string;
  onRedirect: (path: string) => void;
}) {
  const token = options.token;
  const onRedirect = options.onRedirect;
  const auth = useAuth();
  const turnstile = useTurnstileToken();
  const continuationPath = React.useMemo(
    () => (token ? `/invitations/${token}/accept` : null),
    [token],
  );
  const resolveApiUrl = React.useMemo(
    () => getInvitationResolveApiUrl(token),
    [token],
  );

  const [status, setStatus] = React.useState<InvitationSubmitState>("idle");
  const [message, setMessage] = React.useState("Preparing invitation acceptance...");
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [resolution, setResolution] = React.useState<InvitationResolveResponse | null>(null);
  const [resolutionStatus, setResolutionStatus] = React.useState<InvitationResolutionState>("idle");
  const [resolutionError, setResolutionError] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState("");
  const [passwordTouched, setPasswordTouched] = React.useState(false);
  const [passwordSubmitting, setPasswordSubmitting] = React.useState(false);
  const lastSubmittedRef = React.useRef<string | null>(null);
  const inFlightRef = React.useRef(false);

  const invitationState = resolution?.invitation?.state
    ? normalizeInvitationState(resolution.invitation.state)
    : undefined;
  const isValidPendingInvitation = invitationState === "valid";
  const resolutionAuth = resolution?.auth;
  const shouldShowInvitationChoices =
    auth.status === "unauthenticated" &&
    Boolean(token) &&
    isValidPendingInvitation &&
    resolutionStatus === "ready";
  const shouldShowPasswordFields =
    shouldShowInvitationChoices && resolutionAuth?.emailMode === "create_password";
  const passwordError =
    passwordTouched || passwordSubmitting ? validatePasswordInput(password) : null;
  const shouldShowPasswordFeedback = passwordTouched || password.length > 0;
  const missingPasswordRequirements = shouldShowPasswordFeedback
    ? getMissingPasswordRequirements(password)
    : [];
  const canSubmitPassword = Boolean(
    shouldShowPasswordFields && password && !passwordError && turnstile.canSubmit,
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
        if (!response.ok) throw new Error("Unable to resolve invitation state.");
        if (!isInvitationResolveResponse(payload)) {
          throw new Error("Invitation state payload was incomplete.");
        }
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setResolution(payload);
        setResolutionStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResolution(null);
        setResolutionStatus("error");
        setResolutionError(
          error instanceof Error ? error.message : "Unable to resolve invitation state.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [resolveApiUrl]);

  React.useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Invitation token is missing.");
      return;
    }
    if (auth.status === "loading") return;

    if (
      invitationState &&
      invitationState !== "valid" &&
      invitationState !== "pending"
    ) {
      inFlightRef.current = false;
      setStatus("error");
      setMessage(getTerminalInvitationMessage(invitationState));
      return;
    }

    if (auth.status === "unauthenticated") {
      inFlightRef.current = false;
      setStatus("idle");
      if (resolutionStatus === "loading") {
        setMessage("Checking invitation status...");
      } else if (resolutionStatus === "error") {
        setStatus("error");
        setMessage("We couldn't load this invitation right now. Please retry.");
      } else if (resolutionAuth?.emailMode === "create_password") {
        setMessage("Set your password to join this invitation.");
      } else {
        setMessage("Continue to accept this invitation.");
      }
      setSubmitError(null);
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
    if (inFlightRef.current || lastSubmittedRef.current === submissionKey) return;

    let cancelled = false;
    inFlightRef.current = true;
    lastSubmittedRef.current = submissionKey;
    setStatus("working");
    setMessage("Accepting invitation...");

    auth
      .acceptInvitation(token, turnstile.token)
      .then((nextPath) => {
        if (cancelled) return;
        inFlightRef.current = false;
        setStatus("done");
        setMessage("Invitation accepted. Redirecting...");
        window.setTimeout(() => onRedirect(nextPath ?? "/dashboard"), 900);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatus("error");
        const typedError = error as Error & { code?: string };
        setMessage(typedError.message || "Failed to accept invitation.");
        inFlightRef.current = false;
        if (typedError.code?.startsWith("TURNSTILE_")) {
          lastSubmittedRef.current = null;
          handleTurnstileProtectedAuthError({
            error: typedError,
            turnstile,
            setError: () => undefined,
            resetWhenTurnstileErrorOnly: true,
          });
        }
      });

    return () => {
      cancelled = true;
      inFlightRef.current = false;
    };
  }, [
    auth,
    invitationState,
    token,
    onRedirect,
    resolutionAuth?.emailMode,
    resolutionStatus,
    turnstile,
  ]);

  const startGoogleContinuation = React.useCallback(() => {
    if (!continuationPath || auth.loginInFlight) return;
    if (turnstile.enabled && !turnstile.token) {
      setSubmitError("Please complete the verification challenge.");
      return;
    }
    setSubmitError(null);
    auth.loginWithGoogle(turnstile.token, "sign_in", continuationPath).catch((error) => {
      handleTurnstileProtectedAuthError({
        error,
        turnstile,
        setError: setSubmitError,
        fallbackMessage: "Unable to start Google sign-in.",
      });
    });
  }, [auth, continuationPath, turnstile]);
  const loginContinuationPath = React.useMemo(() => {
    if (!continuationPath) return "/login";
    return `/login?next=${encodeURIComponent(continuationPath)}`;
  }, [continuationPath]);
  const shouldShowEmailSignInOption =
    shouldShowInvitationChoices && resolutionAuth?.emailMode === "sign_in";

  const submitInvitationPassword = React.useCallback(() => {
    if (!token || passwordSubmitting) return;
    const turnstileError = ensureTurnstileReadyForSubmit(turnstile);
    if (turnstileError) {
      setSubmitError(turnstileError);
      return;
    }
    const validationError = validatePasswordInput(password);
    if (validationError) {
      setPasswordTouched(true);
      setSubmitError(validationError);
      return;
    }
    setSubmitError(null);
    setPasswordSubmitting(true);
    auth
      .acceptInvitationWithPassword(token, password, turnstile.token)
      .then((nextPath) => {
        setStatus("done");
        setMessage("Invitation accepted. Redirecting...");
        window.setTimeout(() => onRedirect(nextPath ?? "/dashboard"), 900);
      })
      .catch((error) => {
        setStatus("error");
        handleTurnstileProtectedAuthError({
          error,
          turnstile,
          setError: setSubmitError,
          fallbackMessage: "Failed to set password.",
          resetWhenTurnstileErrorOnly: true,
        });
      })
      .finally(() => setPasswordSubmitting(false));
  }, [auth, token, onRedirect, password, passwordSubmitting, turnstile]);

  return {
    auth,
    turnstile,
    status,
    message,
    submitError,
    resolutionError,
    shouldShowInvitationChoices,
    shouldShowPasswordFields,
    password,
    setPassword,
    passwordError,
    markPasswordTouched: () => setPasswordTouched(true),
    shouldShowPasswordFeedback,
    missingPasswordRequirements,
    passwordSubmitting,
    canSubmitPassword,
    shouldShowEmailSignInOption,
    loginContinuationPath,
    startGoogleContinuation,
    submitInvitationPassword,
  };
}
