import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "../App";

type AuthStateMock = {
  status: string;
  user: null | Record<string, unknown>;
  authBootstrapping: boolean;
  csrfToken: string | null;
  csrfReady: boolean;
  loginInFlight: boolean;
};

const { authState, metadataState, resolveAuthenticatedNextStepMock } = vi.hoisted(() => ({
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
  resolveAuthenticatedNextStepMock: vi.fn(() => ({
    destination: "/dashboard",
    reason: "default",
  })),
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
    resolveAuthenticatedNextStep: resolveAuthenticatedNextStepMock,
  };
});

vi.mock("../pages/auth/Login", async () => {
  const { useLocation } = await import("wouter");
  const { useAuth, resolveAuthenticatedNextStep } = await import("@workspace/frontend-security");

  return {
    default: () => {
      const [, setLocation] = useLocation();
      const auth = useAuth();

      React.useEffect(() => {
        if (auth.status !== "authenticated_fully") return;
        const nextStep = resolveAuthenticatedNextStep({
          authStatus: auth.status,
          user: auth.user,
          deniedLoginPath: "/login?error=access_denied",
          defaultPath: "/dashboard",
        });
        setLocation(nextStep.destination);
      }, [auth.status, auth.user, setLocation]);

      if (auth.status === "authenticated_fully") return null;
      return <h1>Welcome</h1>;
    },
  };
});
vi.mock("../pages/auth/Signup", async () => {
  const { useLocation } = await import("wouter");
  const {
    useCurrentPlatformAppMetadata,
    deriveAppAuthRoutePolicy,
  } = await import("@workspace/frontend-security");

  return {
    default: () => {
      const [location, setLocation] = useLocation();
      const { metadata, loading } = useCurrentPlatformAppMetadata();
      const signupAllowed = deriveAppAuthRoutePolicy(metadata).allowCustomerRegistration;

      React.useEffect(() => {
        if (loading || signupAllowed) return;
        if (location !== "/signup") return;
        setLocation("/login");
      }, [loading, signupAllowed, location, setLocation]);

      if (!signupAllowed) return null;
      return (
        <>
          <h1>Create account</h1>
          <button
            type="button"
            onClick={() => {
              const continuation = window.location.search;
              setLocation("/login");
              if (continuation) {
                window.history.replaceState({}, "", `/login${continuation}`);
              }
            }}
          >
            Already have an account
          </button>
        </>
      );
    },
  };
});
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
    resolveAuthenticatedNextStepMock.mockReset();
    resolveAuthenticatedNextStepMock.mockReturnValue({
      destination: "/dashboard",
      reason: "default",
    });
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

  it("preserves continuation through signup already-have-account branch and keeps onboarding precedence", async () => {
    setPath("/signup?next=/dashboard/apps");
    const view = render(<App />);

    await waitFor(() => expect(screen.getByText("Create account")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Already have an account" }));
    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(window.location.search).toBe("?next=/dashboard/apps");

    authState.status = "authenticated_fully";
    authState.user = {
      isSuperAdmin: false,
      pendingPostAuthContinuation: "/dashboard/apps",
      appAccess: {
        appSlug: "admin",
        canAccess: false,
        requiredOnboarding: "organization",
        normalizedAccessProfile: "organization",
        defaultRoute: "/dashboard",
      },
    };
    resolveAuthenticatedNextStepMock.mockReturnValue({
      destination: "/dashboard/apps",
      reason: "pending_continuation",
    });
    view.rerender(<App />);

    await waitFor(() =>
      expect(resolveAuthenticatedNextStepMock).toHaveBeenCalledWith(
        expect.objectContaining({
          authStatus: "authenticated_fully",
          user: expect.objectContaining({
            pendingPostAuthContinuation: "/dashboard/apps",
          }),
        }),
      ),
    );
    await waitFor(() => expect(window.location.pathname).toBe("/onboarding/organization"));
  });
});
