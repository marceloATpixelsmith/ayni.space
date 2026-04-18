import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import App from "../App";

const authState = {
  status: "unauthenticated",
  user: null as null | Record<string, unknown>,
  authBootstrapping: false,
  csrfToken: "csrf",
  csrfReady: true,
  loginInFlight: false,
};

const metadataState = {
  loading: false,
  currentAppSlug: "admin",
  metadata: {
    normalizedAccessProfile: "organization",
    authRoutePolicy: {
      allowInvitations: true,
      allowCustomerRegistration: true,
    },
  },
};

vi.mock("@workspace/frontend-observability", () => ({
  MonitoringErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@workspace/frontend-security", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@workspace/frontend-security");
  return {
    ...actual,
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAuth: () => authState,
    useCurrentPlatformAppMetadata: () => metadataState,
    getLastAuthDebugEventSummary: () => null,
    isAuthDebugEnabled: () => false,
    logAuthDebug: () => undefined,
  };
});

function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

describe("App auth routing runtime behavior", () => {
  beforeEach(() => {
    authState.status = "unauthenticated";
    authState.user = null;
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

  it("redirects unauthenticated users from protected routes to /login", async () => {
    setPath("/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("allows signup when route policy allows customer registration", async () => {
    setPath("/signup");
    render(<App />);

    expect(await screen.findByText("Create account")).toBeInTheDocument();
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
    expect(screen.getByText("Welcome")).toBeInTheDocument();
    expect(screen.queryByText("Create account with Google")).not.toBeInTheDocument();
  });

  it("routes MFA pending users to challenge when enrolled", async () => {
    authState.status = "authenticated_mfa_pending_enrolled";
    authState.user = { mfaPending: true, mfaEnrolled: true };

    setPath("/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/mfa/challenge"));
    expect(screen.getByText("Continue")).toBeInTheDocument();
  });

  it("routes MFA pending users to enrollment when unenrolled", async () => {
    authState.status = "authenticated_mfa_pending_unenrolled";
    authState.user = { mfaPending: true, mfaEnrolled: false };

    setPath("/dashboard");
    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe("/mfa/enroll"));
    expect(screen.getByText("Set up multi-factor authentication")).toBeInTheDocument();
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
    metadataState.metadata = {
      normalizedAccessProfile: "solo",
      authRoutePolicy: {
        allowInvitations: false,
        allowCustomerRegistration: true,
      },
    };

    setPath("/onboarding/organization");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));

    setPath("/invitations/test-token/accept");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
  });
});
