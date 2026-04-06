import React from "react";
import {
  getGetMeQueryKey,
  getMe,
  useLogout,
  setCsrfTokenProvider,
  setCsrfTokenRefresher,
  useSwitchOrganization,
  type AuthUser,
  type SwitchOrgRequest,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { beginAuthDebugFlow, getAuthFlowId, logAuthDebug } from "./authDebug";

export type AuthStatus =
  | "loading"
  | "unauthenticated"
  | "authenticated_fully"
  | "authenticated_mfa_pending_enrolled"
  | "authenticated_mfa_pending_unenrolled";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  authBootstrapping: boolean;
  csrfToken: string | null;
  csrfReady: boolean;
  loginInFlight: boolean;
  refreshSession: (options?: { retryAfterDelay?: boolean }) => Promise<void>;
  loginWithGoogle: (
    turnstileToken?: string | null,
    intent?: "sign_in" | "create_account",
    returnToPath?: string | null,
  ) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  acceptInvitation: (
    token: string,
    turnstileToken?: string | null,
  ) => Promise<void>;
  loginWithPassword: (
    email: string,
    password: string,
    turnstileToken?: string | null,
    returnToPath?: string | null,
  ) => Promise<void>;
  signupWithPassword: (email: string, password: string, name?: string, turnstileToken?: string | null) => Promise<{ verifyToken?: string; appSlug?: string }>;
  forgotPassword: (email: string) => Promise<{ resetToken?: string }>;
  resetPassword: (token: string, password: string) => Promise<void>;
  verifyEmail: (token: string, appSlug?: string) => Promise<{ mfaRequired?: boolean; needsEnrollment?: boolean; nextPath?: string }>;
  startMfaEnrollment: () => Promise<{ factorId: string; secret: string; otpauthUrl: string; issuer: string }>;
  verifyMfaEnrollment: (factorId: string, code: string) => Promise<{ recoveryCodes: string[]; nextPath?: string }>;
  completeMfaChallenge: (code: string, rememberDevice: boolean, stayLoggedIn?: boolean) => Promise<void>;
  completeMfaRecovery: (recoveryCode: string, rememberDevice: boolean, stayLoggedIn?: boolean) => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const API_BASE =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_API_BASE_URL ?? "";

type GoogleUrlErrorPayload = {
  url?: string;
  error?: string;
  code?: string;
} | null;

type ApiErrorPayload = {
  error?: string;
  code?: string;
} | null;

const OAUTH_START_STORAGE_KEY = "auth:oauth-started-at";
const AUTH_TRANSITION_STORAGE_KEY = "auth:session-transition-at";
const OAUTH_GRACE_WINDOW_MS = 5 * 60 * 1000;
const OAUTH_STARTUP_DELAY_MS = 120;
const OAUTH_POST_REDIRECT_RETRY_DELAY_MS = 450;

export function isMfaPendingStatus(status: AuthStatus): boolean {
  return (
    status === "authenticated_mfa_pending_enrolled" ||
    status === "authenticated_mfa_pending_unenrolled"
  );
}

export function isFullyAuthenticatedStatus(status: AuthStatus): boolean {
  return status === "authenticated_fully";
}

export function getMfaPendingRoute(status: AuthStatus): "/mfa/challenge" | "/mfa/enroll" | null {
  if (status === "authenticated_mfa_pending_enrolled") {
    return "/mfa/challenge";
  }
  if (status === "authenticated_mfa_pending_unenrolled") {
    return "/mfa/enroll";
  }
  return null;
}

function classifyMfaPendingUser(payload: Pick<AuthUser, "mfaPending" | "mfaEnrolled" | "nextStep">) {
  const mfaPending = payload.mfaPending === true;
  const nextStep = payload.nextStep ?? null;
  const mfaEnrolled = payload.mfaEnrolled === true;
  const enrolled =
    nextStep === "mfa_challenge" ||
    (nextStep !== "mfa_enroll" && mfaEnrolled);

  return {
    mfaPending,
    nextStep,
    mfaEnrolled,
    enrolled,
    status: enrolled
      ? "authenticated_mfa_pending_enrolled" as const
      : "authenticated_mfa_pending_unenrolled" as const,
    needsEnrollment: !enrolled,
    route: enrolled ? "/mfa/challenge" as const : "/mfa/enroll" as const,
  };
}

function normalizeReturnToPath(path: string | null | undefined): string | null {
  if (typeof path !== "string") return null;
  const trimmed = path.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  return trimmed;
}

function normalizeEmailForSubmission(value: string): string {
  return value.trim().toLowerCase();
}

function toApiUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}

function isCredentialRequiredPath(path: string): boolean {
  return path.startsWith("/api/auth/") || path === "/api/csrf-token";
}

export async function fetchCsrfToken(): Promise<string> {
  logAuthDebug("csrf_fetch_start", { path: "/api/csrf-token", credentialsMode: "include" });
  const response = await fetch(toApiUrl("/api/csrf-token"), {
    method: "GET",
    credentials: "include",
    headers: {
      "x-auth-flow-id": getAuthFlowId(),
    },
  });

  if (!response.ok) {
    throw new Error(`CSRF token fetch failed with status ${response.status}`);
  }

  const data = (await response.json()) as { csrfToken?: string };
  if (!data.csrfToken) {
    throw new Error("CSRF token endpoint did not return a token.");
  }

  return data.csrfToken;
}

export async function secureApiFetch(
  path: string,
  init: RequestInit = {},
  csrfToken?: string | null,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  const credentialsMode = isCredentialRequiredPath(path)
    ? "include"
    : (init.credentials ?? "include");
  if (path.startsWith("/api/auth/")) {
    headers.set("x-auth-flow-id", getAuthFlowId());
    logAuthDebug("auth_request_start", { path, method, credentialsMode });
  }

  if (!SAFE_METHODS.has(method) && csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  return fetch(toApiUrl(path), {
    ...init,
    headers,
    credentials: credentialsMode,
  });
}

export function mapGoogleSignInError(
  response: Response | null,
  payload: GoogleUrlErrorPayload,
): string {
  const status = response?.status ?? 0;

  if (status === 429 || payload?.code === "RATE_LIMITED") {
    const retryAfterHeader = response?.headers.get("retry-after");
    const retrySeconds = retryAfterHeader
      ? Number.parseInt(retryAfterHeader, 10)
      : Number.NaN;
    const retryHint =
      Number.isFinite(retrySeconds) && retrySeconds > 0
        ? ` Please wait about ${retrySeconds} second${retrySeconds === 1 ? "" : "s"} and retry.`
        : " Please wait a moment and retry.";
    return `Too many attempts. Please wait and retry.${retryHint}`;
  }

  if (payload?.code === "TURNSTILE_MISSING_TOKEN") return "Verification required. Please complete the challenge.";
  if (payload?.code === "TURNSTILE_TOKEN_EXPIRED") return "Verification expired. Please complete the challenge again.";
  if (payload?.code === "TURNSTILE_INVALID_TOKEN") return "Verification failed. Please try again.";
  if (payload?.code === "TURNSTILE_MISCONFIGURED") return "Verification is temporarily unavailable due to configuration. Please contact support.";
  if (payload?.code === "TURNSTILE_UNAVAILABLE") return "Verification service is temporarily unavailable. Please try again.";
  if (payload?.code === "OAUTH_CONFIG_MISSING" || payload?.code === "OAUTH_URL_INVALID") {
    return "Sign-in is temporarily unavailable due to configuration. Please contact support.";
  }
  if (payload?.code === "ORIGIN_NOT_ALLOWED") return "Access origin is not allowed for sign-in.";

  if (status === 403)
    return payload?.error ?? "Verification failed. Please try again.";
  return (
    payload?.error ??
    "Unable to start Google sign-in right now. Please try again."
  );
}

export function mapVerifyEmailError(
  response: Response | null,
  payload: ApiErrorPayload,
): string {
  if (payload?.code === "VERIFICATION_TOKEN_ALREADY_USED") {
    return "This verification link was already used.";
  }
  if (payload?.code === "VERIFICATION_TOKEN_EXPIRED") {
    return "This verification link has expired.";
  }
  if (payload?.code === "VERIFICATION_TOKEN_INVALID") {
    return "This verification link is invalid.";
  }
  if (response?.status === 403 && payload?.error?.toLowerCase().includes("csrf")) {
    return "Security check failed. Please retry the verification link.";
  }
  return payload?.error ?? "Unable to verify email.";
}

export async function requireCsrfToken(
  currentToken: string | null | undefined,
  refreshCsrfState: () => Promise<string | null>,
  missingTokenMessage: string,
  options?: { forceRefresh?: boolean },
): Promise<string> {
  const token = options?.forceRefresh
    ? await refreshCsrfState()
    : (currentToken ?? (await refreshCsrfState()));
  if (!token) {
    throw new Error(missingTokenMessage);
  }
  return token;
}

export type NormalizedAccessProfile = "superadmin" | "solo" | "organization";
export type AuthRouteKind = "onboarding" | "invitation";

export type PlatformAppMetadata = {
  slug: string;
  normalizedAccessProfile: NormalizedAccessProfile;
  authRoutePolicy?: AppAuthRoutePolicy;
};

export type AppAuthRoutePolicy = {
  allowOnboarding: boolean;
  allowInvitations: boolean;
  allowCustomerRegistration: boolean;
};

export function deriveAppAuthRoutePolicy(
  app: PlatformAppMetadata | null | undefined,
): AppAuthRoutePolicy {
  if (!app) {
    return { allowOnboarding: false, allowInvitations: false, allowCustomerRegistration: false };
  }

  if (app.authRoutePolicy) {
    return app.authRoutePolicy;
  }

  if (app.normalizedAccessProfile === "organization") {
    return { allowOnboarding: true, allowInvitations: true, allowCustomerRegistration: false };
  }

  if (app.normalizedAccessProfile === "solo") {
    return { allowOnboarding: false, allowInvitations: false, allowCustomerRegistration: false };
  }

  return { allowOnboarding: false, allowInvitations: false, allowCustomerRegistration: false };
}

export function isAuthRouteAllowed(
  app: PlatformAppMetadata | null | undefined,
  routeKind: AuthRouteKind,
): boolean {
  const policy = deriveAppAuthRoutePolicy(app);
  return routeKind === "onboarding"
    ? policy.allowOnboarding
    : policy.allowInvitations;
}

export function getDisallowedAuthRouteRedirect({
  app,
  authStatus,
  isSuperAdmin,
  deniedLoginPath,
}: {
  app: PlatformAppMetadata | null | undefined;
  authStatus: AuthStatus;
  isSuperAdmin?: boolean;
  deniedLoginPath?: string;
}): string {
  if (app?.normalizedAccessProfile === "superadmin") {
    if (isFullyAuthenticatedStatus(authStatus)) {
      return isSuperAdmin ? "/dashboard" : (deniedLoginPath ?? "/login");
    }
    if (isMfaPendingStatus(authStatus)) {
      return getMfaPendingRoute(authStatus) ?? "/login";
    }
    return "/login";
  }

  if (isFullyAuthenticatedStatus(authStatus)) {
    return "/dashboard";
  }
  if (isMfaPendingStatus(authStatus)) {
    return getMfaPendingRoute(authStatus) ?? "/login";
  }

  return "/login";
}

function normalizePlatformAppMetadata(
  raw: unknown,
): PlatformAppMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate["slug"] !== "string") return null;
  if (
    candidate["normalizedAccessProfile"] !== "superadmin" &&
    candidate["normalizedAccessProfile"] !== "solo" &&
    candidate["normalizedAccessProfile"] !== "organization"
  )
    return null;

  const authRoutePolicyCandidate = candidate["authRoutePolicy"];
  const authRoutePolicy =
    authRoutePolicyCandidate &&
    typeof authRoutePolicyCandidate === "object" &&
    typeof (authRoutePolicyCandidate as Record<string, unknown>)["allowOnboarding"] === "boolean" &&
    typeof (authRoutePolicyCandidate as Record<string, unknown>)["allowInvitations"] === "boolean" &&
    typeof (authRoutePolicyCandidate as Record<string, unknown>)["allowCustomerRegistration"] === "boolean"
      ? {
          allowOnboarding: (authRoutePolicyCandidate as Record<string, boolean>)["allowOnboarding"],
          allowInvitations: (authRoutePolicyCandidate as Record<string, boolean>)["allowInvitations"],
          allowCustomerRegistration: (authRoutePolicyCandidate as Record<string, boolean>)["allowCustomerRegistration"],
        }
      : undefined;

  return {
    slug: candidate["slug"],
    normalizedAccessProfile: candidate["normalizedAccessProfile"],
    authRoutePolicy,
  };
}

export async function fetchPlatformAppMetadataBySlug(
  appSlug: string,
): Promise<PlatformAppMetadata | null> {
  const response = await secureApiFetch("/api/apps", { method: "GET" });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!Array.isArray(payload)) {
    return null;
  }

  for (const appCandidate of payload) {
    const normalized = normalizePlatformAppMetadata(appCandidate);
    if (normalized?.slug === appSlug) {
      return normalized;
    }
  }

  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [csrfToken, setCsrfToken] = React.useState<string | null>(null);
  const [csrfReady, setCsrfReady] = React.useState(false);
  const [loginInFlight, setLoginInFlight] = React.useState(false);
  const [sessionRevoked, setSessionRevoked] = React.useState(false);
  const [authBootstrapping, setAuthBootstrapping] = React.useState(true);
  const csrfTokenRef = React.useRef<string | null>(null);
  const csrfRefreshInFlightRef = React.useRef<Promise<string | null> | null>(null);
  const loginRequestRef = React.useRef<Promise<void> | null>(null);
  const authCheckRef = React.useRef<Promise<void> | null>(null);
  const startupAuthInitializedRef = React.useRef(false);

  const meQuery = useQuery({
    queryKey: getGetMeQueryKey(),
    queryFn: () => getMe(),
    enabled: false,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const logoutMutation = useLogout();
  const switchOrgMutation = useSwitchOrganization();

  const runAuthCheck = React.useCallback(
    async (options?: { retryAfterDelay?: boolean }) => {
      if (authCheckRef.current) {
        return authCheckRef.current;
      }

      const request = (async () => {
        logAuthDebug("auth_bootstrap_check_start", { retryAfterDelay: Boolean(options?.retryAfterDelay) });
        const firstAttempt = await meQuery.refetch();
        const firstData = firstAttempt.data ?? null;
        const firstUserId = firstData?.id ?? null;
        const firstAllow = firstAttempt.isSuccess && Boolean(firstData);
        const firstMfaClassification = firstData
          ? classifyMfaPendingUser({
            mfaPending: firstData.mfaPending,
            mfaEnrolled: firstData.mfaEnrolled,
            nextStep: firstData.nextStep,
          })
          : null;
        logAuthDebug("auth_bootstrap_check_result", {
          attempt: "initial",
          userId: firstUserId,
          allow: firstAllow,
          authenticated: firstData ? firstData.authenticated === true : false,
          mfaPending: firstData ? firstData.mfaPending === true : false,
          mfaEnrolled: firstData ? firstData.mfaEnrolled === true : false,
          nextStep: firstData?.nextStep ?? null,
          bootstrapStatus: firstData?.mfaPending ? firstMfaClassification?.status ?? null : null,
          needsEnrollment: firstData?.mfaPending ? firstMfaClassification?.needsEnrollment ?? null : null,
          route: firstData?.mfaPending ? firstMfaClassification?.route ?? null : null,
        });

        if (!options?.retryAfterDelay || firstAttempt.data) {
          return;
        }

        await new Promise((resolve) =>
          window.setTimeout(resolve, OAUTH_POST_REDIRECT_RETRY_DELAY_MS),
        );
        logAuthDebug("auth_bootstrap_check_start", { attempt: "retry" });
        const retryAttempt = await meQuery.refetch();
        const retryData = retryAttempt.data ?? null;
        const retryUserId = retryData?.id ?? null;
        const retryAllow = retryAttempt.isSuccess && Boolean(retryData);
        const retryMfaClassification = retryData
          ? classifyMfaPendingUser({
            mfaPending: retryData.mfaPending,
            mfaEnrolled: retryData.mfaEnrolled,
            nextStep: retryData.nextStep,
          })
          : null;
        logAuthDebug("auth_bootstrap_check_result", {
          attempt: "retry",
          userId: retryUserId,
          allow: retryAllow,
          authenticated: retryData ? retryData.authenticated === true : false,
          mfaPending: retryData ? retryData.mfaPending === true : false,
          mfaEnrolled: retryData ? retryData.mfaEnrolled === true : false,
          nextStep: retryData?.nextStep ?? null,
          bootstrapStatus: retryData?.mfaPending ? retryMfaClassification?.status ?? null : null,
          needsEnrollment: retryData?.mfaPending ? retryMfaClassification?.needsEnrollment ?? null : null,
          route: retryData?.mfaPending ? retryMfaClassification?.route ?? null : null,
        });
      })();

      authCheckRef.current = request;
      try {
        await request;
      } finally {
        if (authCheckRef.current === request) {
          authCheckRef.current = null;
        }
      }
    },
    [meQuery],
  );

  const refreshSession = React.useCallback(async (options?: { retryAfterDelay?: boolean }) => {
    await runAuthCheck({ retryAfterDelay: options?.retryAfterDelay });
  }, [runAuthCheck]);

  React.useEffect(() => {
    csrfTokenRef.current = csrfToken;
  }, [csrfToken]);

  React.useEffect(() => {
    setCsrfTokenProvider(() => csrfTokenRef.current);
    return () => {
      setCsrfTokenProvider(null);
    };
  }, []);

  const markAuthTransition = React.useCallback(() => {
    window.sessionStorage.setItem(AUTH_TRANSITION_STORAGE_KEY, String(Date.now()));
    logAuthDebug("auth_transition_marked", {});
  }, []);

  const refreshCsrfState = React.useCallback(async (): Promise<
    string | null
  > => {
    if (csrfRefreshInFlightRef.current) {
      return csrfRefreshInFlightRef.current;
    }
    setCsrfReady(false);
    const request = (async () => {
      try {
        const token = await fetchCsrfToken();
        setCsrfToken(token);
        csrfTokenRef.current = token;
        return token;
      } catch {
        setCsrfToken(null);
        csrfTokenRef.current = null;
        return null;
      } finally {
        setCsrfReady(true);
      }
    })();
    csrfRefreshInFlightRef.current = request;
    try {
      return await request;
    } finally {
      if (csrfRefreshInFlightRef.current === request) {
        csrfRefreshInFlightRef.current = null;
      }
    }
  }, []);

  React.useEffect(() => {
    void refreshCsrfState();
  }, [refreshCsrfState]);

  React.useEffect(() => {
    setCsrfTokenRefresher(() => refreshCsrfState);
    return () => {
      setCsrfTokenRefresher(null);
    };
  }, [refreshCsrfState]);

  React.useEffect(() => {
    if (startupAuthInitializedRef.current) {
      return;
    }

    startupAuthInitializedRef.current = true;

    const runStartupAuth = async () => {
      const now = Date.now();
      const oauthStartedAtRaw = window.sessionStorage.getItem(
        OAUTH_START_STORAGE_KEY,
      );
      const oauthStartedAt = oauthStartedAtRaw
        ? Number.parseInt(oauthStartedAtRaw, 10)
        : Number.NaN;
      const recentlyStartedOauth =
        Number.isFinite(oauthStartedAt) &&
        now - oauthStartedAt >= 0 &&
        now - oauthStartedAt <= OAUTH_GRACE_WINDOW_MS;
      const authTransitionStartedAtRaw = window.sessionStorage.getItem(
        AUTH_TRANSITION_STORAGE_KEY,
      );
      const authTransitionStartedAt = authTransitionStartedAtRaw
        ? Number.parseInt(authTransitionStartedAtRaw, 10)
        : Number.NaN;
      const recentlyTransitionedAuth =
        Number.isFinite(authTransitionStartedAt) &&
        now - authTransitionStartedAt >= 0 &&
        now - authTransitionStartedAt <= OAUTH_GRACE_WINDOW_MS;
      const shouldRetryAfterDelay = recentlyStartedOauth || recentlyTransitionedAuth;

      try {
        logAuthDebug("auth_bootstrap_start", {});
        await new Promise((resolve) =>
          window.setTimeout(resolve, OAUTH_STARTUP_DELAY_MS),
        );
        await runAuthCheck({ retryAfterDelay: shouldRetryAfterDelay });

        if (recentlyStartedOauth) {
          window.sessionStorage.removeItem(OAUTH_START_STORAGE_KEY);
        }
        if (recentlyTransitionedAuth) {
          window.sessionStorage.removeItem(AUTH_TRANSITION_STORAGE_KEY);
        }
      } finally {
        logAuthDebug("auth_bootstrap_end", {});
        setAuthBootstrapping(false);
      }
    };

    void runStartupAuth();
  }, [runAuthCheck]);

  React.useEffect(() => {
    const revalidateSession = () => {
      loginRequestRef.current = null;
      setLoginInFlight(false);
      if (sessionRevoked) {
        setSessionRevoked(false);
      }
      void meQuery.refetch();
      void runAuthCheck();
      if (!csrfTokenRef.current) {
        void refreshCsrfState();
      }
    };

    const handlePageShow = () => {
      revalidateSession();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        revalidateSession();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshCsrfState, runAuthCheck, sessionRevoked]);

  const loginWithGoogle = React.useCallback(
    async (
      turnstileToken?: string | null,
      intent: "sign_in" | "create_account" = "sign_in",
      returnToPath?: string | null,
    ) => {
      if (loginRequestRef.current) {
      return loginRequestRef.current;
      }

      const request = (async () => {
        const normalizedTurnstileToken = turnstileToken?.trim() ?? "";
        if (!normalizedTurnstileToken) {
          throw new Error("Please complete the verification challenge.");
        }
        const token = csrfTokenRef.current ?? (await refreshCsrfState());
        if (!token) {
          throw new Error("Security token is not ready. Please try again.");
        }

        const normalizedReturnToPath = normalizeReturnToPath(returnToPath);
        const response = await secureApiFetch(
          "/api/auth/google/url",
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "cf-turnstile-response": normalizedTurnstileToken,
            },
            body: JSON.stringify({
              "cf-turnstile-response": normalizedTurnstileToken,
              intent,
              returnToPath: normalizedReturnToPath,
            }),
          },
          token,
        );

        const payload = (await response
          .json()
          .catch(() => null)) as GoogleUrlErrorPayload;
        if (!response.ok || !payload?.url) {
          throw new Error(mapGoogleSignInError(response, payload));
        }

        window.sessionStorage.setItem(
          OAUTH_START_STORAGE_KEY,
          String(Date.now()),
        );
        window.location.assign(payload.url);
      })();

      loginRequestRef.current = request;
      setLoginInFlight(true);

      try {
        await request;
      } finally {
        if (loginRequestRef.current === request) {
          loginRequestRef.current = null;
          setLoginInFlight(false);
        }
      }
    },
    [refreshCsrfState],
  );

  const clearAuthState = React.useCallback(async () => {
    const meQueryKey = getGetMeQueryKey();

    await queryClient.cancelQueries({ queryKey: meQueryKey });
    queryClient.setQueryData(meQueryKey, null);
    queryClient.removeQueries({ queryKey: meQueryKey });
    queryClient.invalidateQueries({
      predicate: (query) => {
        return query.queryKey.some(
          (part) =>
            typeof part === "string" &&
            /(auth|csrf|session|bootstrap|security)/i.test(part),
        );
      },
    });
  }, [queryClient]);

  const logout = React.useCallback(async () => {
    setSessionRevoked(true);
    loginRequestRef.current = null;
    setLoginInFlight(false);
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Fail closed: if backend logout is partially successful, keep privileged UI revoked.
    } finally {
      setCsrfToken(null);
      setCsrfReady(false);
      csrfTokenRef.current = null;
      await clearAuthState();
      queryClient.clear();
      await refreshCsrfState();
    }
  }, [clearAuthState, logoutMutation, queryClient, refreshCsrfState]);

  const switchOrganization = React.useCallback(
    async (orgId: string) => {
      const payload: SwitchOrgRequest = { orgId };
      await switchOrgMutation.mutateAsync({ data: payload });
      await refreshSession();
    },
    [switchOrgMutation, refreshSession],
  );

  const acceptInvitation = React.useCallback(
    async (token: string, turnstileToken?: string | null) => {
      console.info("[INVITATION-FLOW] auth.acceptInvitation invoked", {
        tokenLength: token.length,
        hasTurnstileToken: Boolean(turnstileToken),
      });
      const headers: HeadersInit = {};
      if (turnstileToken) {
        headers["cf-turnstile-response"] = turnstileToken;
      }

      const csrfToken = await requireCsrfToken(
        csrfTokenRef.current,
        refreshCsrfState,
        "Security token is not ready. Please refresh and try accepting the invitation again.",
      );

      const response = await secureApiFetch(
        `/api/invitations/${token}/accept`,
        {
          method: "POST",
          headers,
        },
        csrfToken,
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorPayload;
        const error = new Error(payload?.error ?? "Failed to accept invitation.") as Error & { code?: string; status?: number };
        error.code = payload?.code;
        error.status = response.status;
        console.info("[INVITATION-FLOW] auth.acceptInvitation request failed", {
          status: response.status,
          code: payload?.code ?? null,
        });
        throw error;
      }

      console.info("[INVITATION-FLOW] auth.acceptInvitation request succeeded; refreshing session");
      await refreshSession();
      console.info("[INVITATION-FLOW] auth.acceptInvitation session refresh complete");
    },
    [refreshCsrfState, refreshSession],
  );



  const loginWithPassword = React.useCallback(async (
    email: string,
    password: string,
    turnstileToken?: string | null,
    returnToPath?: string | null,
  ) => {
    beginAuthDebugFlow("password_login");
    const normalizedEmail = normalizeEmailForSubmission(email);
    const normalizedReturnToPath = normalizeReturnToPath(returnToPath);
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try signing in again.",
    );
    const response = await secureApiFetch("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
      },
      body: JSON.stringify({
        email: normalizedEmail,
        password,
        "cf-turnstile-response": turnstileToken ?? undefined,
        returnToPath: normalizedReturnToPath,
      }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as (ApiErrorPayload & { mfaRequired?: boolean; needsEnrollment?: boolean; nextStep?: "mfa_enroll" | "mfa_challenge"; nextPath?: string });
    if (!response.ok) {
      logAuthDebug("login_response_received", { ok: false, status: response.status });
      throw new Error(payload?.error ?? "Invalid email or password.");
    }
    logAuthDebug("login_response_received", {
      ok: true,
      status: response.status,
      mfaRequired: Boolean(payload?.mfaRequired),
      needsEnrollment: Boolean(payload?.needsEnrollment),
      nextStep: payload?.nextStep ?? null,
      nextPath: payload?.nextPath ?? null,
    });
    if (payload?.mfaRequired) {
      const target = payload.nextStep === "mfa_enroll" || (payload.nextStep !== "mfa_challenge" && payload.needsEnrollment)
        ? "/mfa/enroll"
        : "/mfa/challenge";
      logAuthDebug("route_selected", { route: target, reason: "login_response" });
      markAuthTransition();
      logAuthDebug("post_login_bootstrap_start", { firstEndpoint: "/api/auth/me", reason: "mfa_required" });
      await refreshSession({ retryAfterDelay: true });
      logAuthDebug("post_login_bootstrap_end", { firstEndpoint: "/api/auth/me", reason: "mfa_required" });
      await refreshCsrfState();
      window.location.assign(target);
      return;
    }
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      logAuthDebug("route_selected", { route: payload.nextPath, reason: "login_response" });
      markAuthTransition();
      await refreshCsrfState();
      window.location.assign(payload.nextPath);
      return;
    }
    await refreshSession();
  }, [markAuthTransition, refreshCsrfState, refreshSession]);

  const signupWithPassword = React.useCallback(async (email: string, password: string, name?: string, turnstileToken?: string | null) => {
    const normalizedEmail = normalizeEmailForSubmission(email);
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try creating your account again.",
    );
    const response = await secureApiFetch("/api/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
      },
      body: JSON.stringify({ email: normalizedEmail, password, name, "cf-turnstile-response": turnstileToken ?? undefined }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as ({ verifyToken?: string; appSlug?: string } & ApiErrorPayload);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Unable to sign up.");
    }
    await refreshSession();
    return { verifyToken: payload?.verifyToken, appSlug: payload?.appSlug };
  }, [refreshCsrfState, refreshSession]);

  const forgotPassword = React.useCallback(async (email: string) => {
    const normalizedEmail = normalizeEmailForSubmission(email);
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try again.",
    );
    const response = await secureApiFetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as ({ resetToken?: string } & ApiErrorPayload);
    if (!response.ok) throw new Error(payload?.error ?? "Unable to process request.");
    return { resetToken: payload?.resetToken };
  }, [refreshCsrfState]);

  const resetPassword = React.useCallback(async (token: string, password: string) => {
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try resetting your password again.",
    );
    const response = await secureApiFetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload;
    if (!response.ok) throw new Error(payload?.error ?? "Unable to reset password.");
    await refreshSession();
  }, [refreshCsrfState, refreshSession]);

  const verifyEmail = React.useCallback(async (token: string, appSlug?: string) => {
    beginAuthDebugFlow("verify_email");
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please retry the verification link.",
    );
    const response = await secureApiFetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, appSlug: appSlug?.trim() || undefined }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload & { mfaRequired?: boolean; needsEnrollment?: boolean; nextStep?: "mfa_enroll" | "mfa_challenge"; nextPath?: string };
    logAuthDebug("verify_email_response_received", {
      ok: response.ok,
      status: response.status,
      mfaRequired: Boolean(payload?.mfaRequired),
      needsEnrollment: Boolean(payload?.needsEnrollment),
      nextStep: payload?.nextStep ?? null,
      nextPath: payload?.nextPath ?? null,
      appSlug: appSlug ?? null,
    });
    if (!response.ok) throw new Error(mapVerifyEmailError(response, payload));
    if (payload?.mfaRequired) {
      const target = payload.nextStep === "mfa_enroll" || (payload.nextStep !== "mfa_challenge" && payload.needsEnrollment)
        ? "/mfa/enroll"
        : "/mfa/challenge";
      logAuthDebug("route_selected", { route: target, reason: "verify_email_response" });
      markAuthTransition();
      await refreshSession({ retryAfterDelay: true });
      await refreshCsrfState();
      window.location.assign(target);
      return payload;
    }
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      logAuthDebug("route_selected", { route: payload.nextPath, reason: "verify_email_response" });
      markAuthTransition();
      await refreshSession({ retryAfterDelay: true });
      await refreshCsrfState();
      window.location.assign(payload.nextPath);
      return payload;
    }
    await refreshSession({ retryAfterDelay: true });
    return payload;
  }, [markAuthTransition, refreshCsrfState, refreshSession]);

  const startMfaEnrollment = React.useCallback(async () => {
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try two-step verification setup again.",
      { forceRefresh: true },
    );
    const response = await secureApiFetch("/api/auth/mfa/enroll/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
    }, csrfToken);
    const payload = (await response.json()) as { factorId: string; secret: string; otpauthUrl: string; issuer: string; nextStep?: "mfa_enroll" | "mfa_challenge" } & ApiErrorPayload;
    if (!response.ok) {
      if (response.status === 409 && payload?.nextStep === "mfa_challenge") {
        logAuthDebug("mfa_screen_mode_selected", { mode: "challenge", reason: "enroll_start_conflict" });
        markAuthTransition();
        window.location.assign("/mfa/challenge");
        throw new Error("Redirecting to two-step verification challenge.");
      }
      throw new Error(payload?.error ?? "Unable to start two-step verification setup.");
    }
    logAuthDebug("mfa_screen_mode_selected", { mode: "enroll", reason: "enroll_start_success" });
    return payload;
  }, [markAuthTransition, refreshCsrfState]);

  const finalizePostAuthNavigation = React.useCallback(async (nextPath: string) => {
    logAuthDebug("route_selected", { route: nextPath, reason: "post_auth_finalize" });
    markAuthTransition();
    await refreshSession({ retryAfterDelay: true });
    await refreshCsrfState();
    window.location.assign(nextPath);
  }, [markAuthTransition, refreshCsrfState, refreshSession]);

  const verifyMfaEnrollment = React.useCallback(async (factorId: string, code: string) => {
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try two-step verification again.",
      { forceRefresh: true },
    );
    const response = await secureApiFetch("/api/auth/mfa/enroll/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ factorId, code }),
    }, csrfToken);
    const payload = (await response.json()) as { recoveryCodes: string[]; nextPath?: string } & ApiErrorPayload;
    if (!response.ok) throw new Error(payload?.error ?? "Unable to verify two-step verification setup.");
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      await finalizePostAuthNavigation(payload.nextPath);
    }
    return { recoveryCodes: payload.recoveryCodes ?? [], nextPath: payload.nextPath };
  }, [finalizePostAuthNavigation, refreshCsrfState]);

  const completeMfaChallenge = React.useCallback(async (code: string, rememberDevice: boolean, stayLoggedIn = false) => {
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try two-step verification again.",
      { forceRefresh: true },
    );
    const response = await secureApiFetch("/api/auth/mfa/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, rememberDevice, stayLoggedIn }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload & { nextPath?: string };
    logAuthDebug("mfa_challenge_response_received", {
      ok: response.ok,
      status: response.status,
      rememberDevice,
      stayLoggedIn,
      nextPath: payload?.nextPath ?? null,
    });
    if (!response.ok) throw new Error(payload?.error ?? "Unable to complete two-step verification challenge.");
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      await finalizePostAuthNavigation(payload.nextPath);
      return;
    }
    await refreshSession({ retryAfterDelay: true });
    await refreshCsrfState();
  }, [finalizePostAuthNavigation, refreshCsrfState, refreshSession]);

  const completeMfaRecovery = React.useCallback(async (recoveryCode: string, rememberDevice: boolean, stayLoggedIn = false) => {
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try recovery again.",
      { forceRefresh: true },
    );
    const response = await secureApiFetch("/api/auth/mfa/recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recoveryCode, rememberDevice, stayLoggedIn }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload & { nextPath?: string };
    logAuthDebug("mfa_recovery_response_received", {
      ok: response.ok,
      status: response.status,
      rememberDevice,
      stayLoggedIn,
      nextPath: payload?.nextPath ?? null,
    });
    if (!response.ok) throw new Error(payload?.error ?? "Unable to complete two-step recovery.");
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      await finalizePostAuthNavigation(payload.nextPath);
      return;
    }
    await refreshSession({ retryAfterDelay: true });
    await refreshCsrfState();
  }, [finalizePostAuthNavigation, refreshCsrfState, refreshSession]);

  const status: AuthStatus = React.useMemo(() => {
    if (sessionRevoked) return "unauthenticated";
    if (authBootstrapping || meQuery.isLoading) return "loading";
    if (meQuery.isError || !meQuery.data) return "unauthenticated";

    if (meQuery.data.mfaPending) {
      return classifyMfaPendingUser({
        mfaPending: meQuery.data.mfaPending,
        mfaEnrolled: meQuery.data.mfaEnrolled,
        nextStep: meQuery.data.nextStep,
      }).status;
    }

    return "authenticated_fully";
  }, [authBootstrapping, meQuery.data, meQuery.isError, meQuery.isLoading, sessionRevoked]);

  const value: AuthContextValue = React.useMemo(
    () => ({
      status,
      user: status === "loading" || status === "unauthenticated" ? null : (meQuery.data ?? null),
      authBootstrapping,
      csrfToken,
      csrfReady,
      loginInFlight,
      refreshSession,
      loginWithGoogle,
      logout,
      switchOrganization,
      acceptInvitation,
      loginWithPassword,
      signupWithPassword,
      forgotPassword,
      resetPassword,
      verifyEmail,
      startMfaEnrollment,
      verifyMfaEnrollment,
      completeMfaChallenge,
      completeMfaRecovery,
    }),
    [
      status,
      meQuery.data,
      authBootstrapping,
      csrfToken,
      csrfReady,
      loginInFlight,
      refreshSession,
      loginWithGoogle,
      logout,
      switchOrganization,
      acceptInvitation,
      loginWithPassword,
      signupWithPassword,
      forgotPassword,
      resetPassword,
      verifyEmail,
      startMfaEnrollment,
      verifyMfaEnrollment,
      completeMfaChallenge,
      completeMfaRecovery,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}

export function RequireAuth({
  children,
  loadingFallback = null,
  unauthenticatedFallback = null,
}: {
  children: React.ReactNode;
  loadingFallback?: React.ReactNode;
  unauthenticatedFallback?: React.ReactNode;
}) {
  const auth = useAuth();

  if (auth.status === "loading") return <>{loadingFallback}</>;
  if (auth.status === "unauthenticated" || isMfaPendingStatus(auth.status)) {
    return <>{unauthenticatedFallback}</>;
  }

  return <>{children}</>;
}

export { useTurnstileToken } from "./turnstile";
export { logAuthDebug, isAuthDebugEnabled, getLastAuthDebugEventSummary } from "./authDebug";
