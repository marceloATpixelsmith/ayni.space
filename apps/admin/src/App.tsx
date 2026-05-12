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
      return
