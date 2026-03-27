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
      const headers: HeadersInit = {};
      if (turnstileToken) {
        headers["cf-turnstile-response"] = turnstileToken;
      }

      const response = await secureApiFetch("/api/auth/google/url", {
        method: "POST",
        headers,
      }, csrfTokenRef.current);

      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !payload?.url) {
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retrySeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : Number.NaN;
          const retryHint = Number.isFinite(retrySeconds) && retrySeconds > 0
            ? ` Please wait about ${retrySeconds} second${retrySeconds === 1 ? "" : "s"} and retry.`
            : " Please wait a moment and retry.";
          throw new Error(`Sign-in is temporarily rate-limited.${retryHint}`);
        }

        throw new Error(payload?.error ?? "Google OAuth URL is not available.");
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

  const logout = React.useCallback(async () => {
    setSessionRevoked(true);
    setCsrfToken(null);
    csrfTokenRef.current = null;
    loginRequestRef.current = null;
    setLoginInFlight(false);
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // Fail closed: if backend logout is partially successful, keep privileged UI revoked.
    } finally {
      queryClient.clear();
      queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
    }
  }, [logoutMutation, queryClient]);

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
