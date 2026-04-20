// Runtime assertions and critical control tests
import assert from "assert";

export function runCriticalAssertions() {
  // Example: Ensure session cookie is secure in production
  if (process.env.NODE_ENV === "production") {
    assert(process.env.SESSION_SECRET, "SESSION_SECRET must be set in production");
    const rateLimitExplicitlyDisabled = process.env.RATE_LIMIT_ENABLED === "false";
    const rateLimitDisableAllowed = process.env.RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION === "true";
    assert(
      !rateLimitExplicitlyDisabled || rateLimitDisableAllowed,
      "RATE_LIMIT_ENABLED=false requires RATE_LIMIT_ALLOW_DISABLE_IN_PRODUCTION=true in production",
    );

    const turnstileExplicitlyDisabled = process.env.TURNSTILE_ENABLED === "false";
    const turnstileDisableAllowed = process.env.TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION === "true";
    assert(
      !turnstileExplicitlyDisabled || turnstileDisableAllowed,
      "TURNSTILE_ENABLED=false requires TURNSTILE_ALLOW_DISABLE_IN_PRODUCTION=true in production",
    );
  }
  // Add more assertions as needed for critical controls
}
