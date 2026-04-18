import React from "react";
import type { useTurnstileToken } from "./turnstile";

type TurnstileState = ReturnType<typeof useTurnstileToken>;

export function useEmailValidationInteraction(options: {
  value: string;
  validate: (value: string) => string | null;
}) {
  const [touched, setTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  const error = React.useMemo(
    () => (touched || submitted ? options.validate(options.value) : null),
    [options.value, options.validate, touched, submitted],
  );

  return {
    touched,
    submitted,
    error,
    markTouched: () => setTouched(true),
    markSubmitted: () => setSubmitted(true),
  };
}

export function ensureTurnstileReadyForSubmit(
  turnstile: Pick<TurnstileState, "enabled" | "token">,
): string | null {
  if (turnstile.enabled && !turnstile.token) {
    return "Please complete the verification challenge.";
  }
  return null;
}

export function resetTurnstileOnFailure(
  turnstile: Pick<TurnstileState, "enabled" | "reset">,
) {
  if (turnstile.enabled) {
    turnstile.reset();
  }
}

export function getAuthActionErrorMessage(
  error: unknown,
  fallback = "Request failed.",
): string {
  return error instanceof Error ? error.message : fallback;
}

export function isTurnstileChallengeError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" && maybeCode.startsWith("TURNSTILE_");
}

export function handleTurnstileProtectedAuthError(options: {
  error: unknown;
  turnstile: Pick<TurnstileState, "enabled" | "reset">;
  setError: (message: string) => void;
  fallbackMessage?: string;
  resetWhenTurnstileErrorOnly?: boolean;
}): void {
  const message = getAuthActionErrorMessage(
    options.error,
    options.fallbackMessage ?? "Request failed.",
  );
  options.setError(message);

  const shouldReset = options.resetWhenTurnstileErrorOnly
    ? isTurnstileChallengeError(options.error)
    : options.turnstile.enabled;
  if (shouldReset) {
    options.turnstile.reset();
  }
}

export function useAuthSubmitOrchestration() {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = React.useCallback(async <T,>(task: () => Promise<T>) => {
    setPending(true);
    setError(null);
    try {
      return await task();
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Request failed.";
      setError(message);
      throw caught;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, setError, clearError: () => setError(null), run };
}
