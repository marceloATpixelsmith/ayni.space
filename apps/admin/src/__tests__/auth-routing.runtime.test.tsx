import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import App from "../App";

type AuthStateMock = {
  status: string;
  user: null | Record<string, unknown>;
  authBootstrapping: boolean;
  csrfToken: string | null;
  csrfReady: boolean;
  loginInFlight: boolean;
};

const { authState, metadataState } = vi.hoisted(() => ({
  authState: {
    status: "unauthenticated",
    user: null,
    authBootstrapping: false,
    csrfToken: "csrf",
    csrfReady: true,
    loginInFlight: false,
  } satisfies AuthStateMock,
  metadataState: {
    loading: false,
    currentAppSlug: "admin",
    metadata: {
      normalizedAccessProfile: "organization",
      authRoutePolicy: {
        allowInvitations: true,
        allowCustomerRegistration: true,
      },
    },
  },
}));

vi.mock("@workspace/frontend-observability", () => ({
  MonitoringErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@workspace/frontend-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/frontend-security")>();
  return {
    ...actual,
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAuth: () => authState,
    useCurrentPlatformAppMetadata: () => metadataState,
    getLastAuthDebugEventSummary: () => null,
    getDisallowedAuthRouteRedirect: () => "/login",
    getMfaPendingRoute: (status: string) =>
      status === "authenticated_mfa_pending_enrolled" ? "/mfa/challenge" : "/mfa/enroll",
    isAuthDebugEnabled: () => false,
    isMfaPendingStatus: (status: string) =>
      status === "authenticated_mfa_pending_enrolled" ||
      status === "authenticated_mfa_pending_unenrolled",
    isAuthRouteAllowed: (
      metadata: { authRoutePolicy?: { allowInvitations?: boolean; allowCustomerRegistration?: boolean } } | null,
      routeKind: string,
    ) => {
      if (!metadata?.authRoutePolicy) return true;
      if (routeKind === "signup") return metadata.authRoutePolicy.allowCustomerRegistration !== false;
      if (routeKind === "invitation") return metadata.authRoutePolicy.allowInvitations !== false;
      return true;
    },
    logAuthDebug: () => undefined,
    resolveAuthenticatedNextStep: () => ({ destination: "/dashboard", reason: "default" }),
  };
});

vi.mock("../pages/auth/Login", () => ({
  default: () => <h1>Welcome</h1>,
}));
vi.mock("../pages/auth/Signup", () => ({
  default: () => <h1>Create account</h1>,
}));
vi.mock("../pages/auth/ForgotPassword", () => ({
  default: () => <div>Forgot password page</div>,
}));
vi.mock("../pages/auth/ResetPassword", () => ({
  default: () => <div>Reset password page</div>,
}));
vi.mock("../pages/auth/VerifyEmail", () => ({
  default: () => <div>Verify email page</div>,
}));
vi.mock("../pages/auth/MfaEnroll", () => ({
  default: () => <h1>Set up multi-factor authentication</h1>,
}));
vi.mock("../pages/auth/MfaChallenge", () => ({
  default: () => <h1>Continue</h1>,
}));
vi.mock("../pages/auth/Onboarding", () => ({
  default: () => <div>Onboarding</div>,
}));
vi.mock("../pages/auth/InvitationAccept", () => ({
  default: () => <div>Invitation accept</div>,
}));
vi.mock("../pages/admin/AdminDashboard", () => ({
  default: () => <div>Admin dashboard</div>,
}));
vi.mock("../pages/dashboard/DashboardHome", () => ({
  default: () => <div>Dashboard home</div>,
}));
vi.mock("../pages/dashboard/Apps", () => ({
  default: () => <div>Apps</div>,
}));
vi.mock("../pages/dashboard/Members", () => ({
  default: () => <div>Members</div>,
}));
vi.mock("../pages/dashboard/Invitations", () => ({
  default: () => <div>Invitations</div>,
}));
vi.mock("../pages/dashboard/Billing", () => ({
  default: () => <div>Billing</div>,
}));
vi.mock("../pages/dashboard/Settings", () => ({
  default: () => <div>Settings</div>,
}));
vi.mock("../pages/not-found", () => ({
  default: () => <div>Not found</div>,
}));
vi.mock("../components/ui/toaster", () => ({
  Toaster: () => null,
}));
vi.mock("../components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

describe("App auth routing runtime behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.status = "unauthenticated";
    authState.user = null;
    authState.csrfToken = "csrf";
    authState.csrfReady = true;
    authState.loginInFlight = false;
    metadataState.loading = false;
    metadataState.currentAppSlug = "admin";
    metadataState.metadata = {
      normalizedAccessProfile: "organization",
      authRoutePolicy: {
        allowInvitations: true,
        allowCustomerRegistration: true,
      },
    };
    setPath("/");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  it("redirects unauthenticated users from protected routes to /login", async () => {
    setPath("/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(screen.getByText("Welcome")).toBeTruthy();
  });

  it("allows signup when route policy allows customer registration", async () => {
    setPath("/signup");
    render(<App />);

    await waitFor(() => expect(screen.getByText("Create account")).toBeTruthy());
  });

  it("blocks signup in superadmin mode", async () => {
    metadataState.metadata = {
      normalizedAccessProfile: "superadmin",
      authRoutePolicy: {
        allowInvitations: false,
        allowCustomerRegistration: false,
      },
    };

    setPath("/signup");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(screen.getByText("Welcome")).toBeTruthy();
    expect(screen.queryByText("Create account")).toBeNull();
  });

  it("routes MFA pending users to challenge when enrolled", async () => {
    authState.status = "authenticated_mfa_pending_enrolled";
    authState.user = { mfaPending: true, mfaEnrolled: true };

    setPath("/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/mfa/challenge"));
    expect(screen.getByText("Continue")).toBeTruthy();
  });

  it("routes MFA pending users to enrollment when unenrolled", async () => {
    authState.status = "authenticated_mfa_pending_unenrolled";
    authState.user = { mfaPending: true, mfaEnrolled: false };

    setPath("/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/mfa/enroll"));
    expect(screen.getByText("Set up multi-factor authentication")).toBeTruthy();
  });

  it("enforces onboarding and access denied rules for fully authenticated users", async () => {
    authState.status = "authenticated_fully";
    authState.user = {
      isSuperAdmin: false,
      appAccess: {
        appSlug: "admin",
        canAccess: false,
        requiredOnboarding: "organization",
        normalizedAccessProfile: "organization",
        defaultRoute: "/dashboard",
      },
    };

    setPath("/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/onboarding/organization"));
  });

  it("fails closed in solo mode for onboarding and invitations", async () => {
    authState.status = "authenticated_fully";
    authState.user = {
      isSuperAdmin: false,
      appAccess: {
        appSlug: "admin",
        canAccess: true,
        requiredOnboarding: "none",
        normalizedAccessProfile: "solo",
        defaultRoute: "/dashboard",
      },
    };

    setPath("/dashboard/invitations");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/dashboard/invitations"));
    expect(screen.getByText("Invitations")).toBeTruthy();
  });
});
