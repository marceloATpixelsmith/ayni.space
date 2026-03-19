import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import React from "react";
import { AuthProvider, RequireAuth, useAuth } from "@workspace/frontend-security";
import { MonitoringErrorBoundary } from "@workspace/frontend-observability";

import Login from "./pages/auth/Login";
import Onboarding from "./pages/auth/Onboarding";
import DashboardHome from "./pages/dashboard/DashboardHome";
import AppsDirectory from "./pages/dashboard/Apps";
import Members from "./pages/dashboard/Members";
import Invitations from "./pages/dashboard/Invitations";
import Billing from "./pages/dashboard/Billing";
import Settings from "./pages/dashboard/Settings";
import ShipiboApp from "./pages/apps/Shipibo";
import AyniApp from "./pages/apps/Ayni";
import AdminDashboard from "./pages/admin/AdminDashboard";
import InvitationAccept from "./pages/auth/InvitationAccept";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Root redirects to /dashboard if authed, /login if not
function Home() {
  const [, setLocation] = useLocation();
  const auth = useAuth();

  React.useEffect(() => {
    if (auth.status !== "loading") {
      if (auth.status === "authenticated") {
        setLocation("/dashboard");
      } else {
        setLocation("/login");
      }
    }
  }, [auth.status, setLocation]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  return (
    <RequireAuth
      loadingFallback={<AuthLoading />}
      unauthenticatedFallback={
        <AuthRedirect onRedirect={() => setLocation("/login")} />
      }
    >
      {children}
    </RequireAuth>
  );
}

function AuthRedirect({ onRedirect }: { onRedirect: () => void }) {
  React.useEffect(() => {
    onRedirect();
  }, [onRedirect]);
  return <AuthLoading />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/invitations/:token/accept" component={InvitationAccept} />
      
      {/* Protected Dashboard Routes */}
      <Route path="/dashboard">{() => <Protected><DashboardHome /></Protected>}</Route>
      <Route path="/dashboard/apps">{() => <Protected><AppsDirectory /></Protected>}</Route>
      <Route path="/dashboard/members">{() => <Protected><Members /></Protected>}</Route>
      <Route path="/dashboard/invitations">{() => <Protected><Invitations /></Protected>}</Route>
      <Route path="/dashboard/billing">{() => <Protected><Billing /></Protected>}</Route>
      <Route path="/dashboard/settings">{() => <Protected><Settings /></Protected>}</Route>
      
      {/* App Modules */}
      <Route path="/apps/shipibo">{() => <Protected><ShipiboApp /></Protected>}</Route>
      <Route path="/apps/ayni">{() => <Protected><AyniApp /></Protected>}</Route>
      
      {/* Super Admin */}
      <Route path="/admin">{() => <Protected><AdminDashboard /></Protected>}</Route>
      <Route path="/admin/:section">{() => <Protected><AdminDashboard /></Protected>}</Route>
      
      {/* Fallback */}
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
