import React from "react";
import {
  getGetMeQueryKey,
  getMe,
  useLogout,
  setCsrfTokenProvider,
  useSwitchOrganization,
  type AuthUser,
  type SwitchOrgRequest,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  csrfToken: string | null;
  csrfReady: boolean;
  loginInFlight: boolean;
  refreshSession: () => Promise<void>;
  loginWithGoogle: (
    turnstileToken?: string | null,
    intent?: "sign_in" | "create_account",
    returnToPath?: string | null,
    stayLoggedIn?: boolean,
  ) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  acceptInvitation: (
    token: string,
    turnstileToken?: string | null,
  ) => Promise<void>;
  loginWithPassword: (email: string, password: string, turnstileToken?: string | null, stayLoggedIn?: boolean) => Promise<void>;
  signupWithPassword: (email: string, password: string, name?: string, turnstileToken?: string | null) => Promise<{ verifyToken?: string; appSlug?: string }>;
  forgotPassword: (email: string) => Promise<{ resetToken?: string }>;
  resetPassword: (token: string, password: string) => Promise<void>;
  verifyEmail: (token: string, appSlug?: string) => Promise<{ mfaRequired?: boolean; needsEnrollment?: boolean; nextPath?: string }>;
  startMfaEnrollment: () => Promise<{ factorId: string; secret: string; otpauthUrl: string; issuer: string }>;
  verifyMfaEnrollment: (factorId: string, code: string) => Promise<{ recoveryCodes: string[]; nextPath?: string }>;
  completeMfaChallenge: (code: string, rememberDevice: boolean) => Promise<void>;
  completeMfaRecovery: (recoveryCode: string, rememberDevice: boolean) => Promise<void>;
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
const OAUTH_GRACE_WINDOW_MS = 5 * 60 * 1000;
const OAUTH_STARTUP_DELAY_MS = 120;
const OAUTH_POST_REDIRECT_RETRY_DELAY_MS = 450;

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
  console.log(
    "[AUTH-CHECK-TRACE] AUTH CLIENT REQUEST path=/api/csrf-token credentialsMode=include",
  );
  const response = await fetch(toApiUrl("/api/csrf-token"), {
    method: "GET",
    credentials: "include",
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
  console.log(
    `[AUTH-CHECK-TRACE] AUTH CLIENT REQUEST ` +
      `path=${path} ` +
      `credentialsMode=${credentialsMode}`,
  );

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
    if (authStatus === "authenticated") {
      return isSuperAdmin ? "/dashboard" : (deniedLoginPath ?? "/login");
    }
    return "/login";
  }

  if (authStatus === "authenticated") {
    return "/dashboard";
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
        console.log("[AUTH-CLIENT-TRACE] AUTH CHECK START");
        const firstAttempt = await meQuery.refetch();
        const firstUserId = firstAttempt.data?.id ?? null;
        const firstAllow = firstAttempt.isSuccess && Boolean(firstAttempt.data);
        console.log(
          `[AUTH-CLIENT-TRACE] AUTH CHECK RESULT userId=${firstUserId ?? "null"} allow=${firstAllow}`,
        );

        if (!options?.retryAfterDelay || firstAttempt.data) {
          return;
        }

        await new Promise((resolve) =>
          window.setTimeout(resolve, OAUTH_POST_REDIRECT_RETRY_DELAY_MS),
        );
        console.log("[AUTH-CLIENT-TRACE] AUTH CHECK START");
        const retryAttempt = await meQuery.refetch();
        const retryUserId = retryAttempt.data?.id ?? null;
        const retryAllow = retryAttempt.isSuccess && Boolean(retryAttempt.data);
        console.log(
          `[AUTH-CLIENT-TRACE] AUTH CHECK RESULT userId=${retryUserId ?? "null"} allow=${retryAllow}`,
        );
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

  const refreshSession = React.useCallback(async () => {
    await runAuthCheck();
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

  const refreshCsrfState = React.useCallback(async (): Promise<
    string | null
  > => {
    setCsrfReady(false);
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
  }, []);

  React.useEffect(() => {
    void refreshCsrfState();
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

      try {
        await new Promise((resolve) =>
          window.setTimeout(resolve, OAUTH_STARTUP_DELAY_MS),
        );
        await runAuthCheck({ retryAfterDelay: recentlyStartedOauth });

        if (recentlyStartedOauth) {
          window.sessionStorage.removeItem(OAUTH_START_STORAGE_KEY);
        }
      } finally {
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
      stayLoggedIn = false,
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
              stayLoggedIn,
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

      const response = await secureApiFetch(
        `/api/invitations/${token}/accept`,
        {
          method: "POST",
          headers,
        },
        csrfTokenRef.current,
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
    [refreshSession],
  );



  const loginWithPassword = React.useCallback(async (email: string, password: string, turnstileToken?: string | null, stayLoggedIn = false) => {
    const normalizedEmail = normalizeEmailForSubmission(email);
    const response = await secureApiFetch("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
      },
      body: JSON.stringify({ email: normalizedEmail, password, "cf-turnstile-response": turnstileToken ?? undefined, stayLoggedIn }),
    }, csrfTokenRef.current);
    const payload = (await response.json().catch(() => null)) as (ApiErrorPayload & { mfaRequired?: boolean; needsEnrollment?: boolean; nextPath?: string });
    if (!response.ok) {
      throw new Error(payload?.error ?? "Invalid email or password.");
    }
    if (payload?.mfaRequired) {
      const target = payload.needsEnrollment ? "/mfa/enroll" : "/mfa/challenge";
      window.location.assign(target);
      return;
    }
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      window.location.assign(payload.nextPath);
      return;
    }
    await refreshSession();
  }, [refreshSession]);

  const signupWithPassword = React.useCallback(async (email: string, password: string, name?: string, turnstileToken?: string | null) => {
    const normalizedEmail = normalizeEmailForSubmission(email);
    const response = await secureApiFetch("/api/auth/signup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(turnstileToken ? { "cf-turnstile-response": turnstileToken } : {}),
      },
      body: JSON.stringify({ email: normalizedEmail, password, name, "cf-turnstile-response": turnstileToken ?? undefined }),
    }, csrfTokenRef.current);
    const payload = (await response.json().catch(() => null)) as ({ verifyToken?: string; appSlug?: string } & ApiErrorPayload);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Unable to sign up.");
    }
    await refreshSession();
    return { verifyToken: payload?.verifyToken, appSlug: payload?.appSlug };
  }, [refreshSession]);

  const forgotPassword = React.useCallback(async (email: string) => {
    const normalizedEmail = normalizeEmailForSubmission(email);
    const response = await secureApiFetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: normalizedEmail }),
    }, csrfTokenRef.current);
    const payload = (await response.json().catch(() => null)) as ({ resetToken?: string } & ApiErrorPayload);
    if (!response.ok) throw new Error(payload?.error ?? "Unable to process request.");
    return { resetToken: payload?.resetToken };
  }, []);

  const resetPassword = React.useCallback(async (token: string, password: string) => {
    const response = await secureApiFetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, password }),
    }, csrfTokenRef.current);
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload;
    if (!response.ok) throw new Error(payload?.error ?? "Unable to reset password.");
    await refreshSession();
  }, [refreshSession]);

  const verifyEmail = React.useCallback(async (token: string, appSlug?: string) => {
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
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload & { mfaRequired?: boolean; needsEnrollment?: boolean; nextPath?: string };
    if (!response.ok) throw new Error(mapVerifyEmailError(response, payload));
    if (payload?.mfaRequired) {
      const target = payload.needsEnrollment ? "/mfa/enroll" : "/mfa/challenge";
      window.location.assign(target);
      return payload;
    }
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      window.location.assign(payload.nextPath);
      return payload;
    }
    await refreshSession();
    return payload;
  }, [refreshCsrfState, refreshSession]);

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
    const payload = (await response.json()) as { factorId: string; secret: string; otpauthUrl: string; issuer: string } & ApiErrorPayload;
    if (!response.ok) throw new Error(payload?.error ?? "Unable to start two-step verification setup.");
    return payload;
  }, [refreshCsrfState]);

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
    return { recoveryCodes: payload.recoveryCodes ?? [], nextPath: payload.nextPath };
  }, [refreshCsrfState]);

  const completeMfaChallenge = React.useCallback(async (code: string, rememberDevice: boolean) => {
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try two-step verification again.",
      { forceRefresh: true },
    );
    const response = await secureApiFetch("/api/auth/mfa/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, rememberDevice }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload & { nextPath?: string };
    if (!response.ok) throw new Error(payload?.error ?? "Unable to complete two-step verification challenge.");
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      window.location.assign(payload.nextPath);
      return;
    }
    await refreshSession();
  }, [refreshCsrfState, refreshSession]);

  const completeMfaRecovery = React.useCallback(async (recoveryCode: string, rememberDevice: boolean) => {
    const csrfToken = await requireCsrfToken(
      csrfTokenRef.current,
      refreshCsrfState,
      "Security token is not ready. Please refresh and try recovery again.",
      { forceRefresh: true },
    );
    const response = await secureApiFetch("/api/auth/mfa/recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ recoveryCode, rememberDevice }),
    }, csrfToken);
    const payload = (await response.json().catch(() => null)) as ApiErrorPayload & { nextPath?: string };
    if (!response.ok) throw new Error(payload?.error ?? "Unable to complete two-step recovery.");
    if (typeof payload?.nextPath === "string" && payload.nextPath.startsWith("/")) {
      window.location.assign(payload.nextPath);
      return;
    }
    await refreshSession();
  }, [refreshCsrfState, refreshSession]);

  const status: AuthStatus = sessionRevoked
    ? "unauthenticated"
    : authBootstrapping || meQuery.isLoading
      ? "loading"
      : meQuery.isError
        ? "unauthenticated"
        : meQuery.data
          ? "authenticated"
          : "unauthenticated";

  const value: AuthContextValue = React.useMemo(
    () => ({
      status,
      user: status === "authenticated" ? (meQuery.data ?? null) : null,
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
  if (auth.status === "unauthenticated") return <>{unauthenticatedFallback}</>;

  return <>{children}</>;
}

export { useTurnstileToken } from "./turnstile";
