import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Router } from "wouter";
import InvitationAccept from "../pages/auth/InvitationAccept";

let root: Root | undefined;
let container: HTMLDivElement;

function renderInvitation() {
  container = document.createElement("div");
  document.body.innerHTML = "";
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <Router hook={() => ["/invitations/token/accept", vi.fn()] as [string, (p: string) => void]}>
        <InvitationAccept />
      </Router>,
    );
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

const { authState, securityState, securityListeners } = vi.hoisted(() => ({
  authState: {
    status: "unauthenticated",
    loginInFlight: false,
    acceptInvitation: vi.fn(async () => "/dashboard"),
    acceptInvitationWithPassword: vi.fn(async () => "/dashboard"),
    loginWithGoogle: vi.fn(async () => undefined),
  },
  securityState: {
    shouldShowPasswordFields: true,
    shouldShowEmailSignInOption: true,
  },
  securityListeners: new Set<() => void>(),
}));

function notifySecurityState() {
  securityListeners.forEach((listener) => listener());
}

vi.mock("@workspace/frontend-security", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@workspace/frontend-security");
  return {
    ...actual,
    useAuth: () => authState,
    useTurnstileToken: () => ({
      enabled: false,
      token: null,
      canSubmit: true,
      status: "idle",
      guidanceMessage: null,
      TurnstileWidget: () => null,
    }),
    useInvitationAcceptRouteRuntime: () => {
      React.useSyncExternalStore(
        (listener) => {
          securityListeners.add(listener);
          return () => securityListeners.delete(listener);
        },
        () => securityState,
      );
      return {
        auth: authState,
        turnstile: {
          enabled: false,
          token: null,
          canSubmit: true,
          status: "idle",
          guidanceMessage: null,
          TurnstileWidget: () => null,
        },
        status: "idle",
        message: "",
        submitError: null,
        resolutionError: null,
        shouldShowInvitationChoices: true,
        shouldShowPasswordFields: securityState.shouldShowPasswordFields,
        password: "",
        setPassword: vi.fn(),
        passwordError: null,
        markPasswordTouched: vi.fn(),
        shouldShowPasswordFeedback: false,
        missingPasswordRequirements: [],
        passwordSubmitting: false,
        canSubmitPassword: true,
        shouldShowEmailSignInOption: securityState.shouldShowEmailSignInOption,
        loginContinuationPath: "/login?next=%2Finvitations%2Ftoken%2Faccept",
        startGoogleContinuation: vi.fn(),
        submitInvitationPassword: vi.fn(),
      };
    },
  };
});

describe("Invitation accept runtime view", () => {
  beforeEach(() => {
    root?.unmount();
    authState.status = "unauthenticated";
    authState.loginInFlight = false;
    securityState.shouldShowPasswordFields = true;
    securityState.shouldShowEmailSignInOption = true;
    notifySecurityState();
  });

  it("renders google continuation, password creation, and sign-in fallback", async () => {
    renderInvitation();
    await waitFor(() => expect(hasText("Continue with Google")).toBe(true));

    expect(hasText("Create a password to log in")).toBe(true);
    expect(hasText("Set password and join")).toBe(true);
    expect(hasText("Sign in with email/password")).toBe(true);
  });

  it("renders invitation route in authenticated mode without dropping continuation options", async () => {
    authState.status = "authenticated_fully";
    notifySecurityState();
    renderInvitation();

    await waitFor(() => expect(hasText("Continue with Google")).toBe(true));
    expect(hasText("Continue with Google")).toBe(true);
    expect(hasText("Sign in with email/password")).toBe(true);
  });
});
