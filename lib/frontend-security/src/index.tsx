import React from "react";
import {
  getGetMeQueryKey,
  useGetMe,
  useLogout,
  setCsrfTokenProvider,
  useSwitchOrganization,
  type AuthUser,
  type SwitchOrgRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  csrfToken: string | null;
  csrfReady: boolean;
  loginInFlight: boolean;
  refreshSession: () => Promise<void>;
  loginWithGoogle: (turnstileToken?: string | null) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (orgId: string) => Promise<void>;
  acceptInvitation: (token: string, turnstileToken?: string | null) => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const API_BASE = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL ?? "";

function toApiUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}

export async function fetchCsrfToken(): Promise<string> {
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

export async function secureApiFetch(path: string, init: RequestInit = {}, csrfToken?: string | null): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);

  if (!SAFE_METHODS.has(method) && csrfToken) {
    headers.set("x-csrf-token", csrfToken);
  }

  return fetch(toApiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [csrfToken, setCsrfToken] = React.useState<string | null>(null);
  const [csrfReady, setCsrfReady] = React.useState(false);
  const [loginInFlight, setLoginInFlight] = React.useState(false);
  const [sessionRevoked, setSessionRevoked] = React.useState(false);
  const csrfTokenRef = React.useRef<string | null>(null);
  const loginRequestRef = React.useRef<Promise<void> | null>(null);

  const meQuery = useGetMe();
  const logoutMutation = useLogout();
  const switchOrgMutation = useSwitchOrganization();

  const refreshSession = React.useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  React.useEffect(() => {
    csrfTokenRef.current = csrfToken;
  }, [csrfToken]);

  React.useEffect(() => {
    setCsrfTokenProvider(() => csrfTokenRef.current);
    return () => {
      setCsrfTokenProvider(null);
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;

    fetchCsrfToken()
      .then((token) => {
        if (!mounted) return;
        setCsrfToken(token);
        setCsrfReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setCsrfToken(null);
        setCsrfReady(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  React.useEffect(() => {
    const revalidateSession = () => {
      if (sessionRevoked) return;
      void meQuery.refetch();
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
  }, [meQuery, sessionRevoked]);

  const loginWithGoogle = React.useCallback(async (turnstileToken?: string | null) => {
    if (loginRequestRef.current) {
      return loginRequestRef.current;
    }

    const request = (async () => {
      const normalizedTurnstileToken = turnstileToken?.trim() ?? "";
      if (!normalizedTurnstileToken) {
        throw new Error("Please complete the verification challenge.");
      }

      const response = await secureApiFetch("/api/auth/google/url", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cf-turnstile-response": normalizedTurnstileToken,
        },
        body: JSON.stringify({
          "cf-turnstile-response": normalizedTurnstileToken,
        }),
      }, csrfTokenRef.current);

      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string; code?: string } | null;
      if (!response.ok || !payload?.url) {
        if (response.status === 429 || payload?.code === "RATE_LIMITED") {
          const retryAfterHeader = response.headers.get("retry-after");
          const retrySeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
          const retryHint = Number.isFinite(retrySeconds) && retrySeconds > 0
            ? ` Please wait about ${retrySeconds} second${retrySeconds === 1 ? "" : "s"} and retry.`
            : " Please wait a moment and retry.";
          throw new Error(`Sign-in is temporarily rate-limited.${retryHint}`);
        }

        if (payload?.code === "TURNSTILE_MISSING_TOKEN") throw new Error("Please complete the verification challenge.");
        if (payload?.code === "TURNSTILE_TOKEN_EXPIRED") throw new Error("Verification expired. Please complete the challenge again.");
        if (payload?.code === "TURNSTILE_INVALID_TOKEN") throw new Error("Security verification failed. Please try again.");
        if (response.status === 403) throw new Error(payload?.error ?? "Security verification failed. Please try again.");
        if (payload?.code === "OAUTH_CONFIG_MISSING" || payload?.code === "OAUTH_URL_INVALID") {
          throw new Error("Google OAuth is not configured correctly. Please contact support.");
        }
        if (payload?.code === "ORIGIN_NOT_ALLOWED") {
          throw new Error("This app origin is not allowed for sign-in. Please contact support.");
        }
        if (payload?.code === "TURNSTILE_MISCONFIGURED") {
          throw new Error("Verification is currently misconfigured. Please contact support.");
        }
        if (payload?.code === "TURNSTILE_UNAVAILABLE") {
          throw new Error("Verification service is temporarily unavailable. Please try again.");
        }
        throw new Error(payload?.error ?? "Unable to start Google sign-in right now. Please try again.");
      }

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
  }, []);


  const clearAuthState = React.useCallback(async () => {
    const meQueryKey = getGetMeQueryKey();

    await queryClient.cancelQueries({ queryKey: meQueryKey });
    queryClient.setQueryData(meQueryKey, null);
    queryClient.removeQueries({ queryKey: meQueryKey });
    queryClient.invalidateQueries({
      predicate: (query) => {
        const [scope] = query.queryKey;
        return typeof scope === "string" && scope.toLowerCase().includes("auth");
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
      csrfTokenRef.current = null;
      await clearAuthState();
      queryClient.clear();
    }
  }, [clearAuthState, logoutMutation, queryClient]);

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
      const headers: HeadersInit = {};
      if (turnstileToken) {
        headers["cf-turnstile-response"] = turnstileToken;
      }

      const response = await secureApiFetch(`/api/invitations/${token}/accept`, {
        method: "POST",
        headers,
      }, csrfTokenRef.current);

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Failed to accept invitation.");
      }

      await refreshSession();
    },
    [refreshSession],
  );

  const status: AuthStatus = sessionRevoked
    ? "unauthenticated"
    : meQuery.isLoading
      ? "loading"
      : meQuery.isError
        ? "unauthenticated"
        : meQuery.data
          ? "authenticated"
          : "unauthenticated";

  const value: AuthContextValue = React.useMemo(
    () => ({
      status,
      user: status === "authenticated" ? meQuery.data ?? null : null,
      csrfToken,
      csrfReady,
      loginInFlight,
      refreshSession,
      loginWithGoogle,
      logout,
      switchOrganization,
      acceptInvitation,
    }),
    [status, meQuery.data, csrfToken, csrfReady, loginInFlight, refreshSession, loginWithGoogle, logout, switchOrganization, acceptInvitation],
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
