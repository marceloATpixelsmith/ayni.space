import React from "react";
import { getAuthMessage } from "@workspace/auth-ui";
import {
  AUTH_LOGIN_PATH,
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

  if (input.loginInFlight) {
    reasons.push("auth.loginInFlight");
  }

  if (!input.csrfReady) {
    reasons.push("!auth.csrfReady");
  }

  if (!input.csrfTokenPresent) {
    reasons.push("!auth.csrfToken");
  }

  if (input.turnstileEnabled && !input.turnstileReady) {
    reasons.push("turnstileEnabled&&!turnstileReady");
  }

  if (input.turnstileEnabled && !input.turnstileTokenPresent) {
    reasons.push("turnstileEnabled&&!turnstileToken");
  }

  return reasons;
}

export type LoginPageVisibilityPolicy = {
  allowGoogleLogin: boolean;
  allowEmailLogin: boolean;
  allowForgotPassword: boolean;
  allowCreateAccount: boolean;
};

export function deriveLoginPageVisibilityPolicy(
  metadata: Parameters<typeof deriveAppAuthRoutePolicy>[0],
): LoginPageVisibilityPolicy {
  if (!metadata) {
    return {
      allowGoogleLogin: false,
      allowEmailLogin: false,
      allowForgotPassword: false,
      allowCreateAccount: false,
    };
  }

  const authPolicy = deriveAppAuthRoutePolicy(metadata);

  if (metadata.normalizedAccessProfile === "superadmin") {
    return {
      allowGoogleLogin: true,
      allowEmailLogin: false,
      allowForgotPassword: false,
      allowCreateAccount: false,
    };
  }

  return {
    allowGoogleLogin: true,
    allowEmailLogin: true,
    allowForgotPassword: true,
    allowCreateAccount: authPolicy.allowCustomerRegistration,
  };
}

export function useLoginRouteComposition() {
  const auth = useAuth();

  const {
    metadata,
    resolutionError,
    diagnostic,
  } = useCurrentPlatformAppMetadata();

  const turnstile = useTurnstileToken();

  const loginPageVisibility =
    deriveLoginPageVisibilityPolicy(metadata);

  const hideSignupAffordances =
    !loginPageVisibility.allowCreateAccount;

  return {
    auth,
    metadata,
    turnstile,
    loginPageVisibility,
    hideSignupAffordances,
    metadataResolutionError: resolutionError,
    metadataResolutionDiagnostic: diagnostic,
  };
}

export function useLoginRoutePolicy(options: {
  search: string;
  onRedirect: (path: string) => void;
}) {
  const { search, onRedirect } = options;

  const {
    auth,
    metadata,
    turnstile,
    loginPageVisibility,
    hideSignupAffordances,
    metadataResolutionError,
  } = useLoginRouteComposition();

  const query = React.useMemo(
    () => new URLSearchParams(search),
    [search],
  );

  const nextPath = query.get("next");

  const accessError = getAuthErrorMessage(
    parseAuthErrorCode(query.get("error")),
  );

  const metadataError = metadataResolutionError
    ? getAuthMessage("auth_metadata_unavailable")
    : null;

  const combinedAccessError =
    accessError ?? metadataError;

  const deniedCleanupAttemptedRef =
    React.useRef(false);

  React.useEffect(() => {
    if (!combinedAccessError) {
      deniedCleanupAttemptedRef.current = false;
      return;
    }

    if (!isFullyAuthenticatedStatus(auth.status)) {
      return;
    }

    if (deniedCleanupAttemptedRef.current) {
      return;
    }

    deniedCleanupAttemptedRef.current = true;

    void auth.logout();
  }, [
    combinedAccessError,
    auth.status,
    auth.logout,
  ]);

  React.useEffect(() => {
    if (!isFullyAuthenticatedStatus(auth.status)) {
      return;
    }

    const nextStep = resolveAuthenticatedNextStep({
      authStatus: auth.status,
      user: auth.user,
      continuationPath: nextPath,
      deniedLoginPath: buildAdminAccessDeniedLoginPath(),
      defaultPath: DEFAULT_POST_AUTH_PATH,
    });

    onRedirect(nextStep.destination);
  }, [
    auth.status,
    auth.user,
    nextPath,
    onRedirect,
  ]);

  return {
    auth,
    metadata,
    turnstile,
    loginPageVisibility,
    hideSignupAffordances,
    nextPath,
    accessError: combinedAccessError,
  };
}

export function useLoginRouteActions(options: {
  auth: ReturnType<typeof useAuth>;
  turnstile: ReturnType<typeof useTurnstileToken>;
  nextPath?: string | null;
  allowCreateAccount: boolean;
  email: string;
  password: string;
  emailError?: string | null;
}) {
  const {
    auth,
    turnstile,
    nextPath,
    allowCreateAccount,
    email,
    password,
    emailError,
  } = options;

  const [loginError, setLoginError] =
    React.useState<string | null>(null);

  const handleGoogleLogin = React.useCallback(
    (intent: "sign_in" | "create_account" = "sign_in") => {
      const turnstileError =
        ensureTurnstileReadyForSubmit(turnstile);

      if (turnstileError) {
        setLoginError(turnstileError);
        return;
      }

      const safeIntent =
        intent === "create_account" && !allowCreateAccount
          ? "sign_in"
          : intent;

      void auth
        .loginWithGoogle(
          turnstile.token,
          safeIntent,
          nextPath ?? null,
        )
        .catch((error) => {
          handleTurnstileProtectedAuthError({
            error,
            turnstile,
            setError: setLoginError,
            fallbackMessage: getAuthMessage("login_error_google_start"),
          });
        });
    },
    [
      allowCreateAccount,
      auth,
      nextPath,
      turnstile,
    ],
  );

  const handlePasswordLogin = React.useCallback(() => {
    if (emailError) {
      setLoginError(emailError);
      return;
    }

    const normalizedEmail = normalizeEmailInput(email);

    if (!normalizedEmail || !password) {
      setLoginError(getAuthMessage("login_error_missing_credentials"));
      return;
    }

    const turnstileError =
      ensureTurnstileReadyForSubmit(turnstile);

    if (turnstileError) {
      setLoginError(turnstileError);
      return;
    }

    void auth
      .loginWithPassword(
        normalizedEmail,
        password,
        turnstile.token,
        nextPath ?? null,
      )
      .catch((error) => {
        handleTurnstileProtectedAuthError({
          error,
          turnstile,
          setError: setLoginError,
          fallbackMessage: getAuthMessage("login_error_invalid_credentials"),
        });
      });
  }, [
    auth,
    email,
    emailError,
    nextPath,
    password,
    turnstile,
  ]);

  return {
    loginError,
    setLoginError,
    handleGoogleLogin,
    handlePasswordLogin,
  };
}

export function getSignupDisabledReasons(input: {
  signupInFlight: boolean;
  emailPresent: boolean;
  passwordPresent: boolean;
  emailError: boolean;
  passwordError: boolean;
}) {
  const reasons: string[] = [];

  if (input.signupInFlight) {
    reasons.push("signup.inFlight");
  }

  if (!input.emailPresent) {
    reasons.push("!signup.email");
  }

  if (!input.passwordPresent) {
    reasons.push("!signup.password");
  }

  if (input.emailError) {
    reasons.push("signup.emailError");
  }

  if (input.passwordError) {
    reasons.push("signup.passwordError");
  }

  return reasons;
}

export function useSignupRoutePolicy(options: {
  locationPath: string;
  signupPath?: string;
  onRedirect: (path: string) => void;
}) {
  const { metadata, loading } =
    useCurrentPlatformAppMetadata();

  const metadataResolved = !loading;

  const authPolicy =
    deriveAppAuthRoutePolicy(metadata);

  const signupAllowed =
    authPolicy.allowCustomerRegistration;

  const signupPath =
    options.signupPath ?? "/signup";

  React.useEffect(() => {
    if (!metadataResolved) {
      return;
    }

    if (signupAllowed) {
      return;
    }

    if (options.locationPath !== signupPath) {
      return;
    }

    options.onRedirect(AUTH_LOGIN_PATH);
  }, [
    metadataResolved,
    signupAllowed,
    options.locationPath,
    options.onRedirect,
    signupPath,
  ]);

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

  if (input.appSlug) {
    query.set("appSlug", input.appSlug);
  }

  if (input.verifyToken) {
    query.set("token", input.verifyToken);
  }

  return `/verify-email?${query.toString()}`;
}

export function useSignupRouteActions(options: {
  auth: ReturnType<typeof useAuth>;
  turnstile: ReturnType<typeof useTurnstileToken>;
  email: string;
  password: string;
  emailError?: string | null;
  onRedirect: (path: string) => void;
}) {
  const {
    auth,
    turnstile,
    email,
    password,
    emailError,
    onRedirect,
  } = options;

  const submit = useAuthSubmitOrchestration();

  const handleSignup = React.useCallback(() => {
    if (emailError) {
      submit.setError(emailError);
      return;
    }

    const normalizedEmail = normalizeEmailInput(email);
    const passwordError = validatePasswordInput(password);

    if (passwordError) {
      submit.setError(passwordError);
      return;
    }

    const turnstileError =
      ensureTurnstileReadyForSubmit(turnstile);

    if (turnstileError) {
      submit.setError(turnstileError);
      return;
    }

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
          fallbackMessage: getAuthMessage("signup_error_fallback"),
        });
      });
  }, [
    auth,
    email,
    emailError,
    onRedirect,
    password,
    submit,
    turnstile,
  ]);

  return {
    submit,
    handleSignup,
  };
}

type InvitationAcceptStatus =
  | "idle"
  | "loading"
  | "ready"
  | "submitting"
  | "done"
  | "error";

function buildInvitationContinuationPath(token: string): string {
  return `/invitations/${encodeURIComponent(token)}/accept`;
}

export function useInvitationAcceptRouteRuntime(options: {
  token?: string | null;
  onRedirect: (path: string) => void;
}) {
  const auth = useAuth();
  const turnstile = useTurnstileToken();
  const [status, setStatus] =
    React.useState<InvitationAcceptStatus>("idle");
  const [message, setMessage] =
    React.useState<string | null>(null);
  const [resolutionError, setResolutionError] =
    React.useState<string | null>(null);
  const [submitError, setSubmitError] =
    React.useState<string | null>(null);
  const [password, setPassword] =
    React.useState("");
  const [passwordTouched, setPasswordTouched] =
    React.useState(false);
  const [passwordSubmitted, setPasswordSubmitted] =
    React.useState(false);
  const acceptanceAttemptedRef =
    React.useRef(false);

  const token =
    typeof options.token === "string"
      ? options.token.trim()
      : "";

  const loginContinuationPath = token
    ? `/login?next=${encodeURIComponent(
        buildInvitationContinuationPath(token),
      )}`
    : AUTH_LOGIN_PATH;

  const passwordError =
    passwordTouched || passwordSubmitted
      ? validatePasswordInput(password)
      : null;

  const missingPasswordRequirements =
    getMissingPasswordRequirements(password);

  const shouldShowPasswordFeedback =
    password.length > 0 &&
    missingPasswordRequirements.length > 0;

  const canSubmitPassword =
    Boolean(token) &&
    Boolean(password) &&
    !passwordError &&
    (!turnstile.enabled || Boolean(turnstile.token));

  const passwordSubmitting =
    status === "submitting";

  const shouldShowInvitationChoices =
    Boolean(token) &&
    auth.status === "unauthenticated" &&
    status !== "done" &&
    status !== "error";

  const shouldShowPasswordFields =
    shouldShowInvitationChoices;

  const shouldShowEmailSignInOption =
    shouldShowInvitationChoices;

  React.useEffect(() => {
    if (!token) {
      setStatus("error");
      setResolutionError(getAuthMessage("invitation_invalid_link"));
      setMessage(getAuthMessage("invitation_invalid_link"));
      return;
    }

    if (auth.status === "loading") {
      setStatus("loading");
      setMessage(getAuthMessage("invitation_loading"));
      return;
    }

    if (auth.status === "unauthenticated") {
      setStatus("ready");
      setMessage(getAuthMessage("invitation_sign_in_prompt"));
      acceptanceAttemptedRef.current = false;
      return;
    }

    if (acceptanceAttemptedRef.current) {
      return;
    }

    acceptanceAttemptedRef.current = true;
    setStatus("submitting");
    setMessage(getAuthMessage("invitation_accepting"));

    void auth
      .acceptInvitation(token, turnstile.token)
      .then((nextPath) => {
        setStatus("done");
        setMessage(getAuthMessage("invitation_accept_success"));
        options.onRedirect(nextPath ?? DEFAULT_POST_AUTH_PATH);
      })
      .catch((error) => {
        setStatus("error");
        const errorMessage = getAuthActionErrorMessage(
          error,
          getAuthMessage("invitation_accept_failed"),
        );
        setResolutionError(errorMessage);
        setMessage(errorMessage);

        if (turnstile.enabled) {
          turnstile.reset();
        }
      });
  }, [
    auth,
    options,
    token,
    turnstile,
  ]);

  const markPasswordTouched =
    React.useCallback(() => {
      setPasswordTouched(true);
    }, []);

  const startGoogleContinuation =
    React.useCallback(() => {
      if (!token) {
        setSubmitError(getAuthMessage("invitation_invalid_link"));
        return;
      }

      const turnstileError =
        ensureTurnstileReadyForSubmit(turnstile);

      if (turnstileError) {
        setSubmitError(turnstileError);
        return;
      }

      void auth
        .loginWithGoogle(
          turnstile.token,
          "sign_in",
          buildInvitationContinuationPath(token),
        )
        .catch((error) => {
          handleTurnstileProtectedAuthError({
            error,
            turnstile,
            setError: setSubmitError,
            fallbackMessage: getAuthMessage("invitation_accept_failed"),
          });
        });
    }, [
      auth,
      token,
      turnstile,
    ]);

  const submitInvitationPassword =
    React.useCallback(() => {
      setPasswordSubmitted(true);

      if (!token) {
        setSubmitError(getAuthMessage("invitation_invalid_link"));
        return;
      }

      if (passwordError) {
        setSubmitError(passwordError);
        return;
      }

      const turnstileError =
        ensureTurnstileReadyForSubmit(turnstile);

      if (turnstileError) {
        setSubmitError(turnstileError);
        return;
      }

      setStatus("submitting");
      setSubmitError(null);

      void auth
        .acceptInvitationWithPassword(
          token,
          password,
          turnstile.token,
        )
        .then((nextPath) => {
          setStatus("done");
          options.onRedirect(nextPath ?? DEFAULT_POST_AUTH_PATH);
        })
        .catch((error) => {
          setStatus("ready");
          handleTurnstileProtectedAuthError({
            error,
            turnstile,
            setError: setSubmitError,
            fallbackMessage: getAuthMessage("invitation_password_set_failed"),
          });
        });
    }, [
      auth,
      options,
      password,
      passwordError,
      token,
      turnstile,
    ]);

  return {
    auth,
    turnstile,
    status,
    message,
    resolutionError,
    submitError,
    password,
    setPassword,
    markPasswordTouched,
    passwordError,
    missingPasswordRequirements,
    shouldShowPasswordFeedback,
    passwordSubmitting,
    canSubmitPassword,
    shouldShowInvitationChoices,
    shouldShowPasswordFields,
    shouldShowEmailSignInOption,
    loginContinuationPath,
    startGoogleContinuation,
    submitInvitationPassword,
  };
}
