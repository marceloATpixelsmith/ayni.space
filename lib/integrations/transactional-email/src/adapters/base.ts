import type {
  EmailProvider,
  Lane2ProviderConnection,
  NormalizedWebhookEvent,
  Lane2SendResult,
  Lane2TransactionalEmailRequest,
  ProviderCapabilities,
  ProviderConnectionCredentials,
  ProviderConnectionValidationState,
} from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EmailProviderAdapter {
  readonly provider: EmailProvider;
  readonly capabilities: ProviderCapabilities;
  send(connection: Lane2ProviderConnection, request: Lane2TransactionalEmailRequest, fetcher?: FetchLike): Promise<Lane2SendResult>;
  validateConnection(credentials: ProviderConnectionCredentials, fetcher?: FetchLike): Promise<{
    state: ProviderConnectionValidationState;
    error?: string;
  }>;
  normalizeWebhook(payload: unknown): NormalizedWebhookEvent[];
}
