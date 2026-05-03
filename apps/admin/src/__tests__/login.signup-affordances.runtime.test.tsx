import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Login from "../pages/auth/Login";

const routeState = vi.hoisted(() => ({
  hideSignupAffordances: false,
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  useLocation: () => ["/login", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/password-input", () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@workspace/auth-ui", () => ({
  AuthFormMotion: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AuthMethodDivider: () => <hr />,
  GoogleAuthButton: ({ idleLabel }: { idleLabel: string }) => <button>{idleLabel}</button>,
  AuthShell: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  AuthTurnstileSection: () => null,
  FieldValidationMessage: () => null,
  AuthStatusMessage: () => null,
  AuthI18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuthI18n: () => ({ t: (_: string, fallback: string) => fallback }),
}));

vi.mock("@workspace/frontend-security", () => ({
  useLoginRoutePolicy: () => ({
    auth: { status: "unauthenticated", loginInFlight: false, csrfReady: true, csrfToken: "csrf" },
    turnstile: {
      enabled: false,
      ready: true,
      token: "turnstile",
      canSubmit: true,
      status: "ready",
      TurnstileWidget: () => null,
    },
    hideSignupAffordances: routeState.hideSignupAffordances,
    nextPath: null,
    accessError: null,
  }),
  useLoginRouteActions: () => ({
    loginError: null,
    handleGoogleLogin: vi.fn(),
    handlePasswordLogin: vi.fn(),
  }),
  useEmailValidationInteraction: () => ({ error: null, markSubmitted: vi.fn(), markTouched: vi.fn() }),
  validateEmailInput: () => null,
  getLoginDisabledReasons: () => [],
}));

describe("Login signup affordance gating", () => {
  it("hides create-account affordances for superadmin policy", () => {
    routeState.hideSignupAffordances = true;
    render(<Login />);

    expect(screen.queryByRole("link", { name: "Create account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create account with Google" })).toBeNull();
  });

  it("shows create-account affordances when signup is allowed", () => {
    routeState.hideSignupAffordances = false;
    render(<Login />);

    expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account with Google" })).toBeTruthy();
  });
});
