import type { EmailProvider, NormalizedProviderError } from "./types";

export function normalizeProviderError(input: {
  provider: EmailProvider;
  code: string;
  message: string;
  retryable: boolean;
  normalizedType?: NormalizedProviderError["normalizedType"];
  details?: Record<string, unknown>;
}): NormalizedProviderError {
  return {
    provider: input.provider,
    code: input.code,
    message: input.message,
    normalizedType: input.normalizedType ?? "provider",
    retryable: input.retryable,
    details: input.details,
  };
}
