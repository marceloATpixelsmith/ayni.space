import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import InvitationAccept from "../pages/auth/InvitationAccept";

const invitationState: Record<string, unknown> = {
  status: "idle",
  message: "",
  resolutionError: null,
  auth: { status: "unauthenticated", loginInFlight: false },
  shouldShowInvitationChoices: true,
  shouldShowPasswordFields: true,
  shouldShowEmailSignInOption: true,
  loginContinuationPath: "/login?next=%2Finvitations%2Ftoken%2Faccept",
  startGoogleContinuation: vi.fn(),
  password: "",
  setPassword: vi.fn(),
  markPasswordTouched: vi.fn(),
  passwordError: null,
  shouldShowPasswordFeedback: false,
  missingPasswordRequirements: [],
  passwordSubmitting: false,
  canSubmitPassword: true,
  submitInvitationPassword: vi.fn(),
  submitError: null,
  turnstile: {
    enabled: false,
    TurnstileWidget: () => null,
    guidanceMessage: null,
    status: "idle",
  },
};

vi.mock("@workspace/frontend-security", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@workspace/frontend-security");
  return {
    ...actual,
    useInvitationAcceptRouteRuntime: () => invitationState,
  };
});

describe("Invitation accept runtime view", () => {
  beforeEach(() => {
    invitationState.auth = { status: "unauthenticated", loginInFlight: false };
    invitationState.shouldShowInvitationChoices = true;
    invitationState.shouldShowPasswordFields = true;
    invitationState.shouldShowEmailSignInOption = true;
  });

  it("renders google continuation, password creation, and sign-in fallback", () => {
    render(
      <Router hook={() => ["/invitations/token/accept", vi.fn()] as [string, (p: string) => void]}>
        <InvitationAccept />
      </Router>,
    );

    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
    expect(screen.getByText("Create a password to log in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set password and join" })).toBeInTheDocument();
    expect(screen.getByText("Sign in with email/password")).toBeInTheDocument();
  });

  it("renders invitation route in authenticated mode without dropping continuation options", () => {
    invitationState.auth = { status: "authenticated_fully", loginInFlight: false };

    render(
      <Router hook={() => ["/invitations/token/accept", vi.fn()] as [string, (p: string) => void]}>
        <InvitationAccept />
      </Router>,
    );

    expect(screen.getByText("Continue with Google")).toBeInTheDocument();
    expect(screen.getByText("Sign in with email/password")).toBeInTheDocument();
  });
});
