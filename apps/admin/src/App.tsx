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
  getDisallowedAuthRouteRedirect,
  getMfaPendingRoute,
  isAuthDebugEnabled,
  useFrontendRuntimeSettings,
  isMfaPendingStatus,
  isAuthRouteAllowed,
  logAuthDebug,
  resolveAuthenticatedNextStep,
  useCurrentPlatformAppMetadata,
  DEFAULT_POST_AUTH_PATH,
  type AuthRouteKind,
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

type AuthAppAccessSnapshot = {
  appSlug: string;
  canAccess: boolean;
  requiredOnboarding: "none" | "organization" | "user";
  defaultRoute: string;
  normalizedAccessProfile: "superadmin" | "solo" | "organization";
};

function getCurrentAppAccess(
  user: ReturnType<typeof useAuth>["user"],
  currentAppSlug: string | null,
): AuthAppAccessSnapshot | null {
  const candidate = (user as (typeof user & { appAccess?: unknown }) | null)
    ?.appAccess;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;

  if (!currentAppSlug) {
    return null;
  }

  if (record["appSlug"] !== currentAppSlug) {
    return null;
  }

  if (typeof record["canAccess"] !== "boolean") {
    return null;
  }

  if (typeof record["appSlug"] !== "string") {
    return null;
  }

  if (
    record["requiredOnboarding"] !== "none" &&
    record["requiredOnboarding"] !== "organization" &&
    record["requiredOnboarding"] !== "user"
  ) {
    return null;
  }

  if (typeof record["defaultRoute"] !== "string") {
    return null;
  }

  if (
    record["normalizedAccessProfile"] !== "superadmin" &&
    record["normalizedAccessProfile"] !== "solo" &&
    record["normalizedAccessProfile"] !== "organization"
  ) {
    return null;
  }

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

function Home() {
  const [, setLocation] = useLocation();
  const auth = useAuth();

  React.useEffect(() => {
    if (auth.status === "loading") {
      return;
    }

    if (auth.status === "unauthenticated") {
      setLocation("/login");

      logAuthDebug("guard_redirect", {
        from: "/",
        to: "/login",
        reason: "home_unauthenticated",
      });

      return;
    }

    const nextStep = resolveAuthenticatedNextStep({
      authStatus: auth.status,
      user: auth.user,
      deniedLoginPath: adminAccessDeniedLoginPath(),
      defaultPath: DEFAULT_POST_AUTH_PATH,
    });

    if (
      (
        auth.user as (
          typeof auth.user & {
            appAccess?: {
              normalizedAccessProfile?: string;
            };
          }
        ) | null
      )?.appAccess?.normalizedAccessProfile === "superadmin"
    ) {
      setLocation(
        auth.user?.isSuperAdmin
          ? DEFAULT_POST_AUTH_PATH
          : adminAccessDeniedLoginPath(),
      );

      return;
    }

    logAuthDebug("guard_redirect", {
      from: "/",
      to: nextStep.destination,
      reason: `home_${nextStep.reason}`,
    });

    setLocation(nextStep.destination);
  }, [auth.status, auth.user, auth.user?.isSuperAdmin, setLocation]);

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

function ConfigDrivenAuthRoute({
  routeKind,
  children,
}: {
  routeKind: AuthRouteKind;
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const [location] = useLocation();
  const { metadata, loading } = useCurrentPlatformAppMetadata();

  if (loading || auth.status === "loading") {
    return <AuthLoading />;
  }

  if (!isAuthRouteAllowed(metadata, routeKind)) {
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
    if (routeKind === "invitation") {
      return <>{children}</>;
    }

    return <AuthRedirect to="/login" />;
  }

  if (isMfaPendingStatus(auth.status)) {
    return (
      <AuthRedirect
        to={getMfaPendingRoute(auth.status) ?? "/login"}
      />
    );
  }

  return <>{children}</>;
}

function AppModePublicAuthRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { metadata, loading } = useCurrentPlatformAppMetadata();

  if (loading) {
    return <AuthLoading />;
  }

  if (metadata?.normalizedAccessProfile === "superadmin") {
    return <AuthRedirect to="/login" />;
  }

  return <>{children}</>;
}

function AppModeTokenAuthRoute({
  children,
}: {
  children: React.ReactNode;
}) {
  const { metadata, loading } = useCurrentPlatformAppMetadata();

  if (loading) {
    return <AuthLoading />;
  }

  if (metadata?.normalizedAccessProfile === "superadmin") {
    return <AuthRedirect to="/login" />;
  }

  return <>{children}</>;
}

function UserOnboardingRoute() {
  const auth = useAuth();
  const { currentAppSlug } = useCurrentPlatformAppMetadata();

  if (auth.status === "loading") {
    return <AuthLoading />;
  }

  if (auth.status === "unauthenticated") {
    return <AuthRedirect to="/login" />;
  }

  if (isMfaPendingStatus(auth.status)) {
    return (
      <AuthRedirect
        to={getMfaPendingRoute(auth.status) ?? "/login"}
      />
    );
  }

  const appAccess = getCurrentAppAccess(
    auth.user,
    currentAppSlug,
  );

  if (appAccess?.normalizedAccessProfile === "superadmin") {
    return (
      <AuthRedirect
        to={
          auth.user?.isSuperAdmin
            ? DEFAULT_POST_AUTH_PATH
            : adminAccessDeniedLoginPath()
        }
      />
    );
  }

  if (
    appAccess?.normalizedAccessProfile === "organization"
  ) {
    if (
      appAccess.requiredOnboarding === "organization"
    ) {
      return <AuthRedirect to="/onboarding/organization" />;
    }

    return (
      <AuthRedirect
        to={
          appAccess.defaultRoute ||
          DEFAULT_POST_AUTH_PATH
        }
      />
    );
  }

  if (appAccess?.normalizedAccessProfile === "solo") {
    if (
      appAccess.requiredOnboarding === "user"
    ) {
      return <Onboarding />;
    }

    return (
      <AuthRedirect
        to={
          appAccess.defaultRoute ||
          DEFAULT_POST_AUTH_PATH
        }
      />
    );
  }

  return (
    <AuthRedirect
      to={adminAccessDeniedLoginPath()}
    />
  );
}

function ProtectedAppAccess({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = useAuth();
  const { currentAppSlug } =
    useCurrentPlatformAppMetadata();

  if (auth.status === "loading") {
    return <AuthLoading />;
  }

  if (auth.status === "unauthenticated") {
    return <AuthRedirect to="/login" />;
  }

  if (isMfaPendingStatus(auth.status)) {
    return (
      <AuthRedirect
        to={getMfaPendingRoute(auth.status) ?? "/login"}
      />
    );
  }

  const appAccess = getCurrentAppAccess(
    auth.user,
    currentAppSlug,
  );

  if (
    appAccess?.requiredOnboarding === "organization" &&
    !appAccess.canAccess
  ) {
    return (
      <AuthRedirect to="/onboarding/organization" />
    );
  }

  if (
    appAccess?.requiredOnboarding === "user"
  ) {
    return <AuthRedirect to="/onboarding/user" />;
  }

  if (
    appAccess?.normalizedAccessProfile ===
      "superadmin" &&
    !auth.user?.isSuperAdmin
  ) {
    return (
      <AuthRedirect
        to={adminAccessDeniedLoginPath()}
      />
    );
  }

  if (appAccess && !appAccess.canAccess) {
    return (
      <AuthRedirect
        to={adminAccessDeniedLoginPath()}
      />
    );
  }

  return <>{children}</>;
}

function DashboardRoute() {
  const [isSectionMatch, sectionParams] =
    useRoute<{ section?: string }>(
      "/dashboard/:section",
    );

  const section = isSectionMatch
    ? sectionParams?.section
    : undefined;

  const auth = useAuth();

  const { currentAppSlug } =
    useCurrentPlatformAppMetadata();

  const appAccess = getCurrentAppAccess(
    auth.user,
    currentAppSlug,
  );

  if (
    appAccess?.normalizedAccessProfile ===
    "superadmin"
  ) {
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
  return null;
}

function Router() {
  const auth = useAuth();

  return (
    <Switch>
      <Route path="/login" component={Login} />

      <Route path="/signup">
        {() => (
          <AppModePublicAuthRoute>
            <Signup />
          </AppModePublicAuthRoute>
        )}
      </Route>

      <Route path="/forgot-password">
        {() => (
          <AppModePublicAuthRoute>
            <ForgotPassword />
          </AppModePublicAuthRoute>
        )}
      </Route>

      <Route path="/reset-password">
        {() => (
          <AppModeTokenAuthRoute>
            <ResetPassword />
          </AppModeTokenAuthRoute>
        )}
      </Route>

      <Route path="/verify-email">
        {() => (
          <AppModeTokenAuthRoute>
            <VerifyEmail />
          </AppModeTokenAuthRoute>
        )}
      </Route>

      <Route path="/mfa/enroll">
        {() => {
          if (auth.status === "loading") {
            return <AuthLoading />;
          }

          if (auth.status === "unauthenticated") {
            return <AuthRedirect to="/login" />;
          }

          if (auth.status === "authenticated_fully") {
            const nextStep =
              resolveAuthenticatedNextStep({
                authStatus: auth.status,
                user: auth.user,
                deniedLoginPath:
                  adminAccessDeniedLoginPath(),
                defaultPath:
                  DEFAULT_POST_AUTH_PATH,
              });

            return (
              <AuthRedirect
                to={nextStep.destination}
              />
            );
          }

          if (
            auth.status ===
            "authenticated_mfa_pending_enrolled"
          ) {
            return (
              <AuthRedirect to="/mfa/challenge" />
            );
          }

          return <MfaEnroll />;
        }}
      </Route>

      <Route path="/mfa/challenge">
        {() => {
          if (auth.status === "loading") {
            return <AuthLoading />;
          }

          if (auth.status === "unauthenticated") {
            return <AuthRedirect to="/login" />;
          }

          if (auth.status === "authenticated_fully") {
            const nextStep =
              resolveAuthenticatedNextStep({
                authStatus: auth.status,
                user: auth.user,
                deniedLoginPath:
                  adminAccessDeniedLoginPath(),
                defaultPath:
                  DEFAULT_POST_AUTH_PATH,
              });

            return (
              <AuthRedirect
                to={nextStep.destination}
              />
            );
          }

          if (
            auth.status ===
            "authenticated_mfa_pending_unenrolled"
          ) {
            return (
              <AuthRedirect to="/mfa/enroll" />
            );
          }

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
        {() => <UserOnboardingRoute />}
      </Route>

      <Route path="/onboarding">
        {() => (
          <AuthRedirect to="/onboarding/organization" />
        )}
      </Route>

      <Route path="/invitations/:token/accept">
        {() => (
          <ConfigDrivenAuthRoute routeKind="invitation">
            <InvitationAccept />
          </ConfigDrivenAuthRoute>
        )}
      </Route>

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

      <Route path="/apps/:slug">
        {() => (
          <ProtectedAppAccess>
            <AuthRedirect to="/dashboard/apps" />
          </ProtectedAppAccess>
        )}
      </Route>

      <Route path={"/"} nest component={Home} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MonitoringErrorBoundary
        app="admin"
        fallback={<AuthLoading />}
      >
        <AuthProvider>
          <TooltipProvider>
            <WouterRouter
              base={import.meta.env.BASE_URL.replace(
                /\/$/,
                "",
              )}
            >
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
