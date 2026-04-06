import {
  Switch,
  Route,
  Router as WouterRouter,
  useLocation,
  useRoute,
} from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import React from "react";
import {
  AuthProvider,
  getLastAuthDebugEventSummary,
  useAuth,
  fetchPlatformAppMetadataBySlug,
  getDisallowedAuthRouteRedirect,
  getMfaPendingRoute,
  isAuthDebugEnabled,
  isMfaPendingStatus,
  isAuthRouteAllowed,
  logAuthDebug,
  type AuthRouteKind,
  type PlatformAppMetadata,
} from "@workspace/frontend-security";
import { MonitoringErrorBoundary } from "@workspace/frontend-observability";

import Login from "./pages/auth/Login";
import Signup from "./pages/auth/Signup";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import VerifyEmail from "./pages/auth/VerifyEmail";
import MfaEnroll from "./pages/auth/MfaEnroll";
import MfaChallenge from "./pages/auth/MfaChallenge";
import Onboarding from "./pages/auth/Onboarding";
import AdminDashboard from "./pages/admin/AdminDashboard";
import DashboardHome from "./pages/dashboard/DashboardHome";
import AppsDirectory from "./pages/dashboard/Apps";
import Members from "./pages/dashboard/Members";
import Invitations from "./pages/dashboard/Invitations";
import Billing from "./pages/dashboard/Billing";
import Settings from "./pages/dashboard/Settings";
import InvitationAccept from "./pages/auth/InvitationAccept";
import NotFound from "./pages/not-found";
import { adminAccessDeniedLoginPath } from "./pages/auth/accessDenied";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const CURRENT_APP_SLUG = import.meta.env.VITE_APP_SLUG ?? "admin";

type AuthAppAccessSnapshot = {
  appSlug: string;
  canAccess: boolean;
  requiredOnboarding: "none" | "organization" | "user";
  defaultRoute: string;
  normalizedAccessProfile: "superadmin" | "solo" | "organization";
};

function getCurrentAppAccess(
  user: ReturnType<typeof useAuth>["user"],
): AuthAppAccessSnapshot | null {
  const candidate = (user as (typeof user & { appAccess?: unknown }) | null)
    ?.appAccess;
  if (!candidate || typeof candidate !== "object") return null;
  const record = candidate as unknown as Record<string, unknown>;
  if (record["appSlug"] !== CURRENT_APP_SLUG) return null;
  if (typeof record["canAccess"] !== "boolean") return null;
  if (typeof record["appSlug"] !== "string") return null;
  if (
    record["requiredOnboarding"] !== "none" &&
    record["requiredOnboarding"] !== "organization" &&
    record["requiredOnboarding"] !== "user"
  )
    return null;
  if (typeof record["defaultRoute"] !== "string") return null;
  if (
    record["normalizedAccessProfile"] !== "superadmin" &&
    record["normalizedAccessProfile"] !== "solo" &&
    record["normalizedAccessProfile"] !== "organization"
  )
    return null;

  return {
    appSlug: record["appSlug"],
    canAccess: record["canAccess"],
    requiredOnboarding: record["requiredOnboarding"],
    defaultRoute: record["defaultRoute"],
    normalizedAccessProfile: record["normalizedAccessProfile"],
  };
}

function AuthLoading() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}

// Root redirects based on strict Phase B super-admin access.
function Home() {
  const [, setLocation] = useLocation();
  const auth = useAuth();

  React.useEffect(() => {
    if (auth.status !== "loading") {
      if (auth.status === "unauthenticated") {
        setLocation("/login");
        logAuthDebug("guard_redirect", {
          from: "/",
          to: "/login",
          reason: "home_unauthenticated",
        });
        return;
      }
      if (isMfaPendingStatus(auth.status)) {
        const route = getMfaPendingRoute(auth.status) ?? "/login";
        logAuthDebug("guard_redirect", {
          from: "/",
          to: route,
          reason: "home_mfa_pending",
        });
        setLocation(route);
        return;
      }

      const appAccess = getCurrentAppAccess(auth.user);
      if (
        appAccess?.requiredOnboarding === "organization" &&
        !appAccess.canAccess
      ) {
        logAuthDebug("guard_redirect", {
          from: "/",
          to: "/onboarding/organization",
          reason: "home_required_onboarding",
        });
        setLocation("/onboarding/organization");
        return;
      }
      if (appAccess?.requiredOnboarding === "user") {
        logAuthDebug("guard_redirect", {
          from: "/",
          to: "/onboarding/user",
          reason: "home_required_user_onboarding",
        });
        setLocation("/onboarding/user");
        return;
      }

      if (appAccess?.normalizedAccessProfile === "superadmin") {
        logAuthDebug("guard_redirect", {
          from: "/",
          to: auth.user?.isSuperAdmin
            ? "/dashboard"
            : adminAccessDeniedLoginPath(),
          reason: "home_superadmin_policy",
        });
        setLocation(
          auth.user?.isSuperAdmin ? "/dashboard" : adminAccessDeniedLoginPath(),
        );
        return;
      }

      if (appAccess && !appAccess.canAccess) {
        logAuthDebug("guard_redirect", {
          from: "/",
          to: adminAccessDeniedLoginPath(),
          reason: "home_app_access_denied",
        });
        setLocation(adminAccessDeniedLoginPath());
        return;
      }

      logAuthDebug("guard_redirect", {
        from: "/",
        to: "/dashboard",
        reason: "home_default",
      });
      setLocation("/dashboard");
    }
  }, [auth.status, auth.user?.isSuperAdmin, setLocation]);

  return <AuthLoading />;
}

function AuthRedirect({ to }: { to: string }) {
  const [from, setLocation] = useLocation();

  React.useEffect(() => {
    logAuthDebug("guard_redirect", {
      from,
      to,
      reason: "AuthRedirect_component",
    });
    setLocation(to);
  }, [from, setLocation, to]);

  return <AuthLoading />;
}

function useCurrentAppMetadata() {
  const [metadata, setMetadata] = React.useState<PlatformAppMetadata | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;

    fetchPlatformAppMetadataBySlug(CURRENT_APP_SLUG)
      .then((result) => {
        if (cancelled) return;
        setMetadata(result);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { metadata, loading };
}

function ConfigDrivenAuthRoute({
  routeKind,
  children,
}: {
  routeKind: AuthRouteKind;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const [location] = useLocation();
  const { metadata, loading } = useCurrentAppMetadata();

  if (routeKind === "invitation") {
    console.info("[INVITATION-FLOW] invitation route hit", {
      path: location,
      authStatus: auth.status,
      metadataLoaded: !loading,
      invitationRoutesAllowed:
        metadata?.authRoutePolicy?.allowInvitations ?? null,
    });
  }

  if (loading || auth.status === "loading") return <AuthLoading />;

  if (auth.status === "unauthenticated" && routeKind === "invitation") {
    console.info(
      "[INVITATION-FLOW] allowing unauthenticated invitation route render",
      {
        path: location,
      },
    );
    return <>{children}</>;
  }

  if (isMfaPendingStatus(auth.status)) {
    return <AuthRedirect to={getMfaPendingRoute(auth.status) ?? "/login"} />;
  }

  if (!isAuthRouteAllowed(metadata, routeKind)) {
    console.info("[INVITATION-FLOW] auth route disallowed by metadata policy", {
      routeKind,
      path: location,
      authStatus: auth.status,
      redirectTo: getDisallowedAuthRouteRedirect({
        app: metadata,
        authStatus: auth.status,
        isSuperAdmin: auth.user?.isSuperAdmin,
        deniedLoginPath: adminAccessDeniedLoginPath(),
      }),
      metadataPolicy: metadata?.authRoutePolicy ?? null,
    });
    return (
      <AuthRedirect
        to={getDisallowedAuthRouteRedirect({
          app: metadata,
          authStatus: auth.status,
          isSuperAdmin: auth.user?.isSuperAdmin,
          deniedLoginPath: adminAccessDeniedLoginPath(),
        })}
      />
    );
  }

  if (auth.status === "unauthenticated") {
    console.info(
      "[INVITATION-FLOW] redirecting unauthenticated user to generic login",
      {
        routeKind,
        path: location,
      },
    );
    return <AuthRedirect to="/login" />;
  }

  return <>{children}</>;
}

function ProtectedAppAccess({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (auth.status === "loading") return <AuthLoading />;

  if (auth.status === "unauthenticated") {
    return <AuthRedirect to="/login" />;
  }
  if (isMfaPendingStatus(auth.status)) {
    return <AuthRedirect to={getMfaPendingRoute(auth.status) ?? "/login"} />;
  }

  const appAccess = getCurrentAppAccess(auth.user);

  if (
    appAccess?.requiredOnboarding === "organization" &&
    !appAccess.canAccess
  ) {
    return <AuthRedirect to="/onboarding/organization" />;
  }
  if (appAccess?.requiredOnboarding === "user") {
    return <AuthRedirect to="/onboarding/user" />;
  }

  // Fail closed for super-admin profiles: if auth is not explicitly super admin, deny route rendering.
  if (
    appAccess?.normalizedAccessProfile === "superadmin" &&
    !auth.user?.isSuperAdmin
  ) {
    return <AuthRedirect to={adminAccessDeniedLoginPath()} />;
  }

  if (appAccess && !appAccess.canAccess) {
    return <AuthRedirect to={adminAccessDeniedLoginPath()} />;
  }

  return <>{children}</>;
}

function DashboardRoute() {
  const [isSectionMatch, sectionParams] = useRoute<{ section?: string }>(
    "/dashboard/:section",
  );
  const section = isSectionMatch ? sectionParams?.section : undefined;

  const auth = useAuth();
  const appAccess = getCurrentAppAccess(auth.user);

  if (appAccess?.normalizedAccessProfile === "superadmin") {
    return <AdminDashboard section={section} />;
  }

  const orgSection = section ?? "overview";
  switch (orgSection) {
    case "overview":
      return <DashboardHome />;
    case "apps":
      return <AppsDirectory />;
    case "members":
      return <Members />;
    case "invitations":
      return <Invitations />;
    case "billing":
      return <Billing />;
    case "settings":
      return <Settings />;
    default:
      return <NotFound />;
  }
}

function AuthDebugOverlay() {
  const auth = useAuth();
  const [location] = useLocation();
  const storageKey = "auth-debug-overlay-collapsed";
  const [isCollapsed, setIsCollapsed] = React.useState<boolean>(() => {
    try {
      return window.localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  const [lastEventSummary, setLastEventSummary] = React.useState<string | null>(
    () => getLastAuthDebugEventSummary(),
  );

  React.useEffect(() => {
    const update = () => {
      setLastEventSummary(getLastAuthDebugEventSummary());
    };
    update();
    const interval = window.setInterval(update, 500);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, String(isCollapsed));
    } catch {
      // no-op: localStorage may be unavailable in some environments
    }
  }, [isCollapsed]);

  if (!isAuthDebugEnabled()) {
    return null;
  }

  const shortUserId = auth.user?.id ? `${auth.user.id.slice(0, 8)}…` : "none";
  const isAuthenticated = auth.status === "authenticated_fully";
  const needsEnrollment =
    auth.status === "authenticated_mfa_pending_unenrolled";
  const parsedEvent = (() => {
    if (!lastEventSummary) return null;
    try {
      return JSON.parse(lastEventSummary) as {
        event?: string;
        flowId?: string;
        ts?: number;
        fields?: Record<string, unknown>;
      };
    } catch {
      return null;
    }
  })();
  const eventSummary = parsedEvent?.event ?? "none";
  const eventTs = parsedEvent?.ts
    ? new Date(parsedEvent.ts).toISOString()
    : null;
  const togglePanel = () => setIsCollapsed((current) => !current);
  const onToggleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      togglePanel();
    }
  };

  if (isCollapsed) {
    return (
      <aside className="fixed bottom-3 right-3 z-[10000]">
        <button
          type="button"
          aria-label="Expand auth debug panel"
          aria-expanded="false"
          onClick={togglePanel}
          onKeyDown={onToggleKeyDown}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950/95 text-zinc-100 shadow-lg transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          <span aria-hidden>⌃</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="fixed right-3 top-3 z-[10000] max-h-[80vh] w-[min(360px,calc(100vw-1.5rem))] overflow-auto rounded-md border border-zinc-700 bg-zinc-950/95 p-3 text-xs text-zinc-100 shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold tracking-wide text-amber-300">
          AUTH DEBUG
        </div>
        <button
          type="button"
          aria-label="Collapse auth debug panel"
          aria-expanded="true"
          onClick={togglePanel}
          onKeyDown={onToggleKeyDown}
          className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 text-zinc-100 transition-colors hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          <span aria-hidden>⌄</span>
        </button>
      </div>
      <dl className="space-y-1">
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">route</dt>
          <dd className="text-right">{location}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">status</dt>
          <dd className="text-right">{auth.status}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">authenticated</dt>
          <dd>{String(isAuthenticated)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">userId</dt>
          <dd>{shortUserId}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">mfaPending</dt>
          <dd>{String(auth.user?.mfaPending ?? false)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">mfaEnrolled</dt>
          <dd>{String(auth.user?.mfaEnrolled ?? false)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">nextStep</dt>
          <dd>{auth.user?.nextStep ?? "none"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">needsEnrollment</dt>
          <dd>{String(needsEnrollment)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-zinc-400">authBootstrapping</dt>
          <dd>{String(auth.authBootstrapping)}</dd>
        </div>
      </dl>
      <div className="mt-2 border-t border-zinc-700 pt-2">
        <div className="text-zinc-400">lastEvent</div>
        <div className="break-words">{eventSummary}</div>
        {eventTs ? (
          <div className="text-[10px] text-zinc-500">{eventTs}</div>
        ) : null}
      </div>
    </aside>
  );
}

function Router() {
  const auth = useAuth();

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/verify-email" component={VerifyEmail} />
      <Route path="/mfa/enroll">
        {() => {
          if (auth.status === "loading") return <AuthLoading />;
          if (auth.status === "unauthenticated")
            return <AuthRedirect to="/login" />;
          if (auth.status === "authenticated_fully")
            return <AuthRedirect to="/dashboard" />;
          if (auth.status === "authenticated_mfa_pending_enrolled")
            return <AuthRedirect to="/mfa/challenge" />;
          return <MfaEnroll />;
        }}
      </Route>
      <Route path="/mfa/challenge">
        {() => {
          if (auth.status === "loading") return <AuthLoading />;
          if (auth.status === "unauthenticated")
            return <AuthRedirect to="/login" />;
          if (auth.status === "authenticated_fully")
            return <AuthRedirect to="/dashboard" />;
          if (auth.status === "authenticated_mfa_pending_unenrolled")
            return <AuthRedirect to="/mfa/enroll" />;
          return <MfaChallenge />;
        }}
      </Route>
      <Route path="/onboarding/organization">
        {() => (
          <ConfigDrivenAuthRoute routeKind="onboarding">
            <Onboarding />
          </ConfigDrivenAuthRoute>
        )}
      </Route>
      <Route path="/onboarding/user">
        {() => (
          <ConfigDrivenAuthRoute routeKind="onboarding">
            <Onboarding />
          </ConfigDrivenAuthRoute>
        )}
      </Route>
      <Route path="/onboarding">
        {() => <AuthRedirect to="/onboarding/organization" />}
      </Route>
      <Route path="/invitations/:token/accept">
        {() => (
          <ConfigDrivenAuthRoute routeKind="invitation">
            <InvitationAccept />
          </ConfigDrivenAuthRoute>
        )}
      </Route>

      {/* App-access routes */}
      <Route path="/dashboard">
        {() => (
          <ProtectedAppAccess>
            <DashboardRoute />
          </ProtectedAppAccess>
        )}
      </Route>
      <Route path="/dashboard/:section">
        {() => (
          <ProtectedAppAccess>
            <DashboardRoute />
          </ProtectedAppAccess>
        )}
      </Route>

      {/* Fail-closed aliases for legacy routes */}
      <Route path="/apps/:slug">
        {() => (
          <ProtectedAppAccess>
            <AuthRedirect to="/dashboard/apps" />
          </ProtectedAppAccess>
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MonitoringErrorBoundary app="admin" fallback={<AuthLoading />}>
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthDebugOverlay />
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </AuthProvider>
      </MonitoringErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
