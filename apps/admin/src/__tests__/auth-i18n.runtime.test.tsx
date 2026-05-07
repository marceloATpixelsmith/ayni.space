import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AuthI18nProvider,
  AuthMethodDivider,
  getAuthMessage,
  useAuthI18n,
} from "@workspace/auth-ui";
import {
  ensureTurnstileReadyForSubmit,
  getMissingPasswordRequirements,
  validateEmailInput,
  validatePasswordInput,
} from "@workspace/frontend-security";

function TranslationProbe() {
  const { t } = useAuthI18n();
  return (
    <>
      <span data-testid="known">{t("login_title")}</span>
      <span data-testid="fallback">{t("signup_sign_in_link", "Fallback")}</span>
      <span data-testid="forgot-title">
        {t("forgot_password_title", "Fallback forgot")}
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
    expect(screen.getByTestId("fallback").textContent).toBe("Sign in");
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
});
