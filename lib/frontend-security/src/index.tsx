import React from "react";
import {
  getGetGoogleAuthUrlQueryKey,
  useGetGoogleAuthUrl,
  useGetMe,
  useLogout,
  setCsrfTokenProvider,
  useSwitchOrganization,
  type AuthUser,
  type SwitchOrgRequest,
} from "@workspace/api-client-react";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  csrfToken: string | null;
  csrfReady: boolean;
  refreshSession: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
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
  const [csrfToken, setCsrfToken] = React.useState<string | null>(null);
  const [csrfReady, setCsrfReady] = React.useState(false);
  const csrfTokenRef = React.useRef<string | null>(null);

  const meQuery = useGetMe();
  const googleUrlQuery = useGetGoogleAuthUrl({
    query: {
      enabled: false,
      queryKey: getGetGoogleAuthUrlQueryKey(),
    },
  });
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

  const loginWithGoogle = React.useCallback(async () => {
    const latest = await googleUrlQuery.refetch();
    const latestUrl = latest.data?.url;

    if (!latestUrl) {
      const queryError = latest.error instanceof Error ? latest.error.message : null;
      throw new Error(
        queryError
          ? `Google OAuth URL is not available: ${queryError}`
          : "Google OAuth URL is not available.",
      );
    }

    window.location.assign(latestUrl);
  }, [googleUrlQuery]);

  const logout = React.useCallback(async () => {
    await logoutMutation.mutateAsync();
    await refreshSession();
  }, [logoutMutation, refreshSession]);

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

  const status: AuthStatus = meQuery.isLoading
    ? "loading"
    : meQuery.data
      ? "authenticated"
      : "unauthenticated";

  const value: AuthContextValue = React.useMemo(
    () => ({
      status,
      user: meQuery.data ?? null,
      csrfToken,
      csrfReady,
      refreshSession,
      loginWithGoogle,
      logout,
      switchOrganization,
      acceptInvitation,
    }),
    [status, meQuery.data, csrfToken, csrfReady, refreshSession, loginWithGoogle, logout, switchOrganization, acceptInvitation],
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
