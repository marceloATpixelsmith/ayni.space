import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import React from "react";
import { useGetMe } from "@workspace/api-client-react";

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
  const { data: user, isLoading, error } = useGetMe({ query: { retry: false } });

  React.useEffect(() => {
    if (!isLoading) {
      if (user) {
        setLocation("/dashboard");
      } else if (error) {
        setLocation("/login");
      }
    }
  }, [user, isLoading, error, setLocation]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/onboarding" component={Onboarding} />
      
      {/* Protected Dashboard Routes */}
      <Route path="/dashboard" component={DashboardHome} />
      <Route path="/dashboard/apps" component={AppsDirectory} />
      <Route path="/dashboard/members" component={Members} />
      <Route path="/dashboard/invitations" component={Invitations} />
      <Route path="/dashboard/billing" component={Billing} />
      <Route path="/dashboard/settings" component={Settings} />
      
      {/* App Modules */}
      <Route path="/apps/shipibo" component={ShipiboApp} />
      <Route path="/apps/ayni" component={AyniApp} />
      
      {/* Super Admin */}
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/:section" component={AdminDashboard} />
      
      {/* Fallback */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
