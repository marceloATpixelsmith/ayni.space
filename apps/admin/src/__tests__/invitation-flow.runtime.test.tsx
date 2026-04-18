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
    root?.unmount();
    invitationState.auth = { status: "unauthenticated", loginInFlight: false };
    invitationState.shouldShowInvitationChoices = true;
    invitationState.shouldShowPasswordFields = true;
    invitationState.shouldShowEmailSignInOption = true;
  });

  it("renders google continuation, password creation, and sign-in fallback", () => {
    renderInvitation();

    expect(hasText("Continue with Google")).toBe(true);
    expect(hasText("Create a password to log in")).toBe(true);
    expect(hasText("Set password and join")).toBe(true);
    expect(hasText("Sign in with email/password")).toBe(true);
  });

  it("renders invitation route in authenticated mode without dropping continuation options", () => {
    invitationState.auth = { status: "authenticated_fully", loginInFlight: false };
    renderInvitation();

    expect(hasText("Continue with Google")).toBe(true);
    expect(hasText("Sign in with email/password")).toBe(true);
  });
});
