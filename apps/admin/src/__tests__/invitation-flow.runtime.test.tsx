import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import InvitationAccept from "../pages/auth/InvitationAccept";

const {
  invitationRuntimeState,
  mockSetPassword,
  mockMarkPasswordTouched,
  mockStartGoogleContinuation,
  mockSubmitInvitationPassword,
} = vi.hoisted(() => ({
  mockSetPassword: vi.fn(),
  mockMarkPasswordTouched: vi.fn(),
  mockStartGoogleContinuation: vi.fn(),
  mockSubmitInvitationPassword: vi.fn(),
  invitationRuntimeState: {
    auth: {
      status: "unauthenticated",
      loginInFlight: false,
    },
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
    shouldShowPasswordFields: true,
    password: "",
    setPassword: vi.fn(),
    passwordError: null,
    markPasswordTouched: vi.fn(),
    shouldShowPasswordFeedback: false,
    missingPasswordRequirements: [],
    passwordSubmitting: false,
    canSubmitPassword: true,
    shouldShowEmailSignInOption: true,
    loginContinuationPath: "/login?next=%2Finvitations%2Ftoken%2Faccept",
    startGoogleContinuation: vi.fn(),
    submitInvitationPassword: vi.fn(),
  },
}));

vi.mock("@workspace/frontend-security", () => ({
  useInvitationAcceptRouteRuntime: () => ({
    ...invitationRuntimeState,
    setPassword: mockSetPassword,
    markPasswordTouched: mockMarkPasswordTouched,
    startGoogleContinuation: mockStartGoogleContinuation,
    submitInvitationPassword: mockSubmitInvitationPassword,
  }),
}));

describe("Invitation accept runtime view", () => {
  beforeEach(() => {
    invitationRuntimeState.auth.status = "unauthenticated";
    invitationRuntimeState.auth.loginInFlight = false;
    invitationRuntimeState.shouldShowInvitationChoices = true;
    invitationRuntimeState.shouldShowPasswordFields = true;
    invitationRuntimeState.shouldShowEmailSignInOption = true;
    invitationRuntimeState.status = "idle";
    invitationRuntimeState.message = "";
    invitationRuntimeState.submitError = null;
    invitationRuntimeState.resolutionError = null;
    invitationRuntimeState.passwordSubmitting = false;
    invitationRuntimeState.canSubmitPassword = true;
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  it("renders google continuation, password creation, and sign-in fallback", async () => {
    render(
      <Router hook={() => ["/invitations/token/accept", vi.fn()] as [string, (p: string) => void]}>
        <InvitationAccept />
      </Router>,
    );

    await waitFor(() => expect(screen.getByText("Continue with Google")).toBeTruthy());

    expect(screen.getByText("Create a password to log in")).toBeTruthy();
    expect(screen.getByText("Set password and join")).toBeTruthy();
    expect(screen.getByText("Sign in with email/password")).toBeTruthy();
  });

  it("renders invitation route in authenticated mode without dropping continuation options", async () => {
    invitationRuntimeState.auth.status = "authenticated_fully";

    render(
      <Router hook={() => ["/invitations/token/accept", vi.fn()] as [string, (p: string) => void]}>
        <InvitationAccept />
      </Router>,
    );

    await waitFor(() => expect(screen.getByText("Continue with Google")).toBeTruthy());
    expect(screen.getByText("Sign in with email/password")).toBeTruthy();
  });
});
