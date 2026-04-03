import type {
  EmailProvider,
  Lane2ProviderConnection,
  Lane2SendResult,
  Lane2TransactionalEmailRequest,
  ProviderCapabilities,
} from "../types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface EmailProviderAdapter {
  readonly provider: EmailProvider;
  readonly capabilities: ProviderCapabilities;
  send(connection: Lane2ProviderConnection, request: Lane2TransactionalEmailRequest, fetcher?: FetchLike): Promise<Lane2SendResult>;
}
