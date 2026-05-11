import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Login from "../pages/auth/Login";

const routeState = vi.hoisted(() => ({
  hideSignupAffordances: false,
  loginPageVisibility: {
    allowGoogleLogin: true,
    allowEmailLogin: true,
    allowForgotPassword: true,
    allowCreateAccount: true,
  },
  accessError: null as string | null,
}));

const authMessages = vi.hoisted(() => ({
  login_title: "Welcome",
  login_subtitle_with_signup: "Sign in or create your account to continue.",
  login_subtitle_sign_in_only: "Sign in to continue.",
  login_google_sign_in_idle: "Sign in with Google",
  login_google_sign_in_loading: "Starting Google sign-in...",
  login_google_create_account_idle: "Create account with Google",
  login_google_create_account_loading: "Starting account setup...",
  login_email_placeholder: "Email",
  login_password_placeholder: "Password",
  login_email_button: "Sign in with email",
  login_forgot_password_link: "Forgot password?",
  login_create_account_link: "Create account",
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  useLocation: () => ["/login", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/password-input", () => ({
  PasswordInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}));

vi.mock("@workspace/auth-ui", () => ({
  AuthFormMotion: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AuthMethodDivider: () => <div>OR</div>,
  GoogleAuthButton: ({ idleLabel }: { idleLabel: string }) => (
    <button>{idleLabel}</button>
  ),
  AuthShell: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  AuthTurnstileSection: () => null,
  FieldValidationMessage: () => null,
  AuthStatusMessage: ({
    message,
    role,
  }: {
    message?: string | null;
    role?: string;
  }) => (message ? <div role={role}>{message}</div> : null),
  AuthI18nProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useAuthI18n: () => ({
    t: (key: keyof typeof authMessages, fallback?: string) =>
      authMessages[key] ?? fallback ?? key,
  }),
}));

vi.mock("@workspace/frontend-security", () => ({
  useLoginRoutePolicy: () => ({
    auth: {
      status: "unauthenticated",
      loginInFlight: false,
      csrfReady: true,
      csrfToken: "csrf",
    },
    turnstile: {
      enabled: false,
      ready: true,
      token: "turnstile",
      canSubmit: true,
      status: "ready",
      TurnstileWidget: () => null,
    },
    loginPageVisibility: routeState.loginPageVisibility,
    hideSignupAffordances: routeState.hideSignupAffordances,
    nextPath: null,
    accessError: routeState.accessError,
  }),
  useLoginRouteActions: () => ({
    loginError: null,
    handleGoogleLogin: vi.fn(),
    handlePasswordLogin: vi.fn(),
  }),
  useEmailValidationInteraction: () => ({
    error: null,
    markSubmitted: vi.fn(),
    markTouched: vi.fn(),
  }),
  validateEmailInput: () => null,
  getLoginDisabledReasons: () => [],
}));

describe("Login signup affordance gating", () => {
  it("renders Google sign-in only for superadmin policy", () => {
    routeState.hideSignupAffordances = true;
    routeState.loginPageVisibility = {
      allowGoogleLogin: true,
      allowEmailLogin: false,
      allowForgotPassword: false,
      allowCreateAccount: false,
    };
    routeState.accessError = null;
    render(<Login />);

    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Sign in with email" }),
    ).toBeNull();
    expect(screen.queryByPlaceholderText("Email")).toBeNull();
    expect(screen.queryByPlaceholderText("Password")).toBeNull();
    expect(screen.queryByText("OR")).toBeNull();
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Create account" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create account with Google" }),
    ).toBeNull();
  });

  it("renders email/password, forgot password, and create account for organization policy", () => {
    routeState.hideSignupAffordances = false;
    routeState.loginPageVisibility = {
      allowGoogleLogin: true,
      allowEmailLogin: true,
      allowForgotPassword: true,
      allowCreateAccount: true,
    };
    routeState.accessError = null;
    render(<Login />);

    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Sign in with email" }),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Email")).toBeTruthy();
    expect(screen.getByPlaceholderText("Password")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot password?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create account with Google" }),
    ).toBeTruthy();
  });

  it("renders email/password, forgot password, and create account for solo policy", () => {
    routeState.hideSignupAffordances = false;
    routeState.loginPageVisibility = {
      allowGoogleLogin: true,
      allowEmailLogin: true,
      allowForgotPassword: true,
      allowCreateAccount: true,
    };
    routeState.accessError = null;
    render(<Login />);

    expect(
      screen.getByRole("button", { name: "Sign in with Google" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Sign in with email" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot password?" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Create account" })).toBeTruthy();
  });

  it("renders safe generic metadata failure text without diagnostics", () => {
    routeState.hideSignupAffordances = true;
    routeState.loginPageVisibility = {
      allowGoogleLogin: false,
      allowEmailLogin: false,
      allowForgotPassword: false,
      allowCreateAccount: false,
    };
    routeState.accessError =
      "We could not load the sign-in configuration. Please try again later.";
    render(<Login />);

    expect(screen.getByRole("alert").textContent).toBe(
      "We could not load the sign-in configuration. Please try again later.",
    );
    expect(screen.queryByText(/app_metadata_not_found/)).toBeNull();
    expect(screen.queryByText(/requested=/)).toBeNull();
    expect(screen.queryByText(/available=/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign in with Google" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign in with email" }),
    ).toBeNull();
  });
});
