import { Switch, Route, Router as WouterRouter, useLocation, useRoute } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import React from "react";
import { AuthProvider, useAuth } from "@workspace/frontend-security";
import { MonitoringErrorBoundary } from "@workspace/frontend-observability";

import Login from "./pages/auth/Login";
import Onboarding from "./pages/auth/Onboarding";
import AdminDashboard from "./pages/admin/AdminDashboard";
import InvitationAccept from "./pages/auth/InvitationAccept";
import NotFound from "./pages/not-found";
import Unauthorized from "./pages/auth/Unauthorized";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
        return;
      }

      setLocation(auth.user?.isSuperAdmin ? "/dashboard" : "/unauthorized");
    }
  }, [auth.status, auth.user?.isSuperAdmin, setLocation]);

  return <AuthLoading />;
}

function AuthRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();

  React.useEffect(() => {
    setLocation(to);
  }, [setLocation, to]);

  return <AuthLoading />;
}

function ProtectedSuperAdmin({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (auth.status === "loading") return <AuthLoading />;

  // Fail closed: if auth is not explicitly super admin, deny route rendering.
  if (auth.status !== "authenticated" || !auth.user?.isSuperAdmin) {
    const target = auth.status === "unauthenticated" ? "/login" : "/unauthorized";
    return <AuthRedirect to={target} />;
  }

  return <>{children}</>;
}

function DashboardRoute() {
  const [isSectionMatch, sectionParams] = useRoute<{ section?: string }>("/dashboard/:section");
  const section = isSectionMatch ? sectionParams?.section : undefined;

  return <AdminDashboard section={section} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/unauthorized" component={Unauthorized} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/invitations/:token/accept" component={InvitationAccept} />

      {/* Restricted super-admin routes */}
      <Route path="/dashboard">{() => <ProtectedSuperAdmin><AdminDashboard /></ProtectedSuperAdmin>}</Route>
      <Route path="/dashboard/:section">{() => <ProtectedSuperAdmin><DashboardRoute /></ProtectedSuperAdmin>}</Route>
      <Route path="/admin">{() => <ProtectedSuperAdmin><AdminDashboard /></ProtectedSuperAdmin>}</Route>
      <Route path="/admin/:section">{() => <ProtectedSuperAdmin><AdminDashboard /></ProtectedSuperAdmin>}</Route>

      {/* Fail-closed aliases for legacy routes */}
      <Route path="/apps/:slug">{() => <ProtectedSuperAdmin><AuthRedirect to="/dashboard" /></ProtectedSuperAdmin>}</Route>

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
