import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "../App";

let root: Root | undefined;
let container: HTMLDivElement;

function renderApp() {
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<App />);
  });
}

function hasText(text: string) {
  return (document.body.textContent ?? "").includes(text);
}

async function waitFor(assertion: () => void, timeoutMs = 1000, intervalMs = 10) {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("waitFor timed out");
}

type AuthStateMock = {
  status: string;
  user: null | Record<string, unknown>;
  authBootstrapping: boolean;
  csrfToken: string | null;
  csrfReady: boolean;
  loginInFlight: boolean;
  refreshSession: () => Promise<void>;
  startMfaEnrollment: () => Promise<{
    factorId: string;
    secret: string;
    issuer: string;
    otpauthUrl: string;
  }>;
  completeMfaChallenge: (
    code: string,
    remember: boolean,
    stayLoggedIn: boolean,
  ) => Promise<void>;
  completeMfaRecovery: (
    recoveryCode: string,
    remember: boolean,
    stayLoggedIn: boolean,
  ) => Promise<void>;
};

const {
  authState,
  metadataState,
  secureApiFetchMock,
} = vi.hoisted(() => ({
  authState: {
    status: "unauthenticated",
    user: null,
    authBootstrapping: false,
    csrfToken: "csrf",
    csrfReady: true,
    loginInFlight: false,
    refreshSession: async () => undefined,
    startMfaEnrollment: async () => ({
      factorId: "factor-1",
      secret: "SECRET",
      issuer: "Ayni",
      otpauthUrl: "otpauth://totp/Ayni:test?secret=SECRET&issuer=Ayni",
    }),
    completeMfaChallenge: async () => undefined,
    completeMfaRecovery: async () => undefined,
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
  secureApiFetchMock: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      mfaPending: true,
      mfaEnrolled: false,
      nextStep: "mfa_enroll",
    }),
  })),
}));

vi.mock("@workspace/frontend-observability", () => ({
  MonitoringErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@workspace/frontend-security", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@workspace/frontend-security",
  );
  return {
    ...actual,
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAuth: () => authState,
    useCurrentPlatformAppMetadata: () => metadataState,
    secureApiFetch: secureApiFetchMock,
    useTurnstileToken: () => ({
      enabled: false,
      token: null,
      status: "idle",
      guidanceMessage: null,
      TurnstileWidget: (() => null) as React.ComponentType,
    }),
  };
});

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
    authState.refreshSession = vi.fn(async () => undefined);
    authState.startMfaEnrollment = vi.fn(async () => ({
      factorId: "factor-1",
      secret: "SECRET",
      issuer: "Ayni",
      otpauthUrl: "otpauth://totp/Ayni:test?secret=SECRET&issuer=Ayni",
    }));
    authState.completeMfaChallenge = vi.fn(async () => undefined);
    authState.completeMfaRecovery = vi.fn(async () => undefined);
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
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = undefined;
    document.body.innerHTML = "";
  });

  it("redirects unauthenticated users from protected routes to /login", async () => {
    setPath("/dashboard");
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(hasText("Welcome")).toBe(true);
  });

  it("allows signup when route policy allows customer registration", async () => {
    setPath("/signup");
    renderApp();

    await waitFor(() => expect(hasText("Create account")).toBe(true));
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
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(hasText("Welcome")).toBe(true);
    expect(hasText("Create account with Google")).toBe(false);
  });

  it("routes MFA pending users to challenge when enrolled", async () => {
    authState.status = "authenticated_mfa_pending_enrolled";
    authState.user = { mfaPending: true, mfaEnrolled: true };

    setPath("/dashboard");
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/mfa/challenge"));
    expect(hasText("Continue")).toBe(true);
  });

  it("routes MFA pending users to enrollment when unenrolled", async () => {
    authState.status = "authenticated_mfa_pending_unenrolled";
    authState.user = { mfaPending: true, mfaEnrolled: false };

    setPath("/dashboard");
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/mfa/enroll"));
    expect(hasText("Set up multi-factor authentication")).toBe(true);
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
    renderApp();

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
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));

    setPath("/invitations/test-token/accept");
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/dashboard"));
  });
});
