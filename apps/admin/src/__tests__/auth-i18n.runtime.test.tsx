import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthI18nProvider,
  AuthMethodDivider,
  formatAuthMessage,
  getAuthMessage,
  useAuthI18n,
} from "@workspace/auth-ui";
import { authEn } from "../../../../lib/auth-ui/src/locales/en/auth";
import {
  ensureTurnstileReadyForSubmit,
  getMissingPasswordRequirements,
  validateEmailInput,
  validatePasswordInput,
} from "@workspace/frontend-security";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");

const AUTH_COPY_SOURCES = [
  "apps/admin/src/pages/auth/Login.tsx",
  "apps/admin/src/pages/auth/Signup.tsx",
  "apps/admin/src/pages/auth/ForgotPassword.tsx",
  "apps/admin/src/pages/auth/ResetPassword.tsx",
  "apps/admin/src/pages/auth/VerifyEmail.tsx",
  "apps/admin/src/pages/auth/MfaEnroll.tsx",
  "apps/admin/src/pages/auth/MfaChallenge.tsx",
  "apps/admin/src/pages/auth/InvitationAccept.tsx",
  "apps/admin/src/pages/auth/Onboarding.tsx",
  "lib/auth-ui/src/AuthMethodDivider.tsx",
  "lib/frontend-security/src/auth-page-orchestration.ts",
  "lib/frontend-security/src/authValidation.ts",
  "lib/frontend-security/src/auth-form-runtime.ts",
  "lib/frontend-security/src/index.tsx",
  "lib/frontend-security/src/turnstile.tsx",
];

function readRepoFile(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function TranslationProbe() {
  const { t } = useAuthI18n();
  return (
    <>
      <span data-testid="known">{t("login_title")}</span>
      <span data-testid="signin">{t("signup_sign_in_link")}</span>
      <span data-testid="forgot-title">
        {t("forgot_password_title")}
      </span>
      <span data-testid="validation">{t("validation_email_required")}</span>
      <span data-testid="missing">
        {t("unknown_key" as never, "Missing Fallback")}
      </span>
    </>
  );
}

describe("auth i18n scaffolding", () => {
  it("renders default English strings", () => {
    render(
      <AuthI18nProvider>
        <TranslationProbe />
      </AuthI18nProvider>,
    );

    expect(screen.getByTestId("known").textContent).toBe("Welcome");
    expect(screen.getByTestId("signin").textContent).toBe("Sign in");
    expect(screen.getByTestId("missing").textContent).toBe("Missing Fallback");
    expect(screen.getByTestId("forgot-title").textContent).toBe(
      "Forgot password",
    );
    expect(screen.getByTestId("validation").textContent).toBe(
      "Email is required.",
    );
  });

  it("renders auth-ui primitive without missing key crash", () => {
    render(
      <AuthI18nProvider>
        <AuthMethodDivider />
      </AuthI18nProvider>,
    );

    expect(screen.getByText("OR")).toBeTruthy();
  });

  it("centralizes shared validation and auth-runtime messages behind auth keys", () => {
    expect(validateEmailInput("")).toBe(
      getAuthMessage("validation_email_required"),
    );
    expect(validateEmailInput("not-an-email")).toBe(
      getAuthMessage("validation_email_invalid"),
    );
    expect(validatePasswordInput("short")).toBe(
      getAuthMessage("validation_password_min_length"),
    );
    expect(getMissingPasswordRequirements("abcdefgh")).toContain(
      getAuthMessage("validation_password_uppercase"),
    );
    expect(ensureTurnstileReadyForSubmit({ enabled: true, token: null })).toBe(
      getAuthMessage("auth_error_turnstile_required"),
    );
  });

  it("formats auth messages with email, issuer, and retry timing replacements", () => {
    expect(
      formatAuthMessage("verify_email_sent_link_with_email", {
        email: "person@example.com",
      }),
    ).toBe(
      "We sent a verification link for person@example.com. After verification, we'll continue automatically.",
    );
    expect(
      formatAuthMessage("mfa_enroll_account_issuer", {
        issuer: "Ayni Admin",
      }),
    ).toBe("Account issuer: Ayni Admin");
    expect(
      formatAuthMessage("login_error_google_rate_retry_seconds", {
        seconds: 30,
        unit: "seconds",
      }),
    ).toBe(" Please wait about 30 seconds and retry.");
  });

  it("keeps auth copy source-backed for page and shared runtime translation keys", () => {
    const knownKeys = new Set(Object.keys(authEn));
    const missingKeys: string[] = [];

    for (const relativePath of AUTH_COPY_SOURCES) {
      const source = readRepoFile(relativePath);
      const keyPattern =
        /\b(?:t|format|getAuthMessage|formatAuthMessage)\(\s*["']([^"']+)["']/g;
      for (const match of source.matchAll(keyPattern)) {
        const key = match[1];
        if (!knownKeys.has(key)) {
          missingKeys.push(`${relativePath}:${key}`);
        }
      }
    }

    expect(missingKeys).toEqual([]);
  });

  it("guards against fallback-heavy auth page copy and manual interpolation", () => {
    const violations: string[] = [];
    const forbiddenVisibleCopy = [
      "Email verified. Redirecting...",
      "Set up your workspace",
      "Create an organization to start using apps and inviting your team.",
      "Organization Name",
      "Workspace URL",
      "Test reset token:",
      "Failed to set password for invitation.",
      "Invalid email or password.",
      "Unable to process request.",
      "Unable to reset password.",
      "Unable to complete two-step verification challenge.",
      "Loading security check…",
      "Verification failed. Please wait a few seconds while we retry.",
    ];

    for (const relativePath of AUTH_COPY_SOURCES) {
      const source = readRepoFile(relativePath);
      if (/\bt\(\s*["'][^"']+["']\s*,/.test(source)) {
        violations.push(`${relativePath}: fallback-heavy t()`);
      }
      if (/\.replace\(\s*["']\{(?:email|issuer|seconds)\}["']/.test(source)) {
        violations.push(`${relativePath}: manual auth interpolation`);
      }
      for (const copy of forbiddenVisibleCopy) {
        if (source.includes(copy)) {
          violations.push(`${relativePath}: hardcoded visible copy "${copy}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
