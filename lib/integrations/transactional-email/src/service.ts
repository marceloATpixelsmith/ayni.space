import { randomUUID } from "node:crypto";
import { BrevoEmailAdapter } from "./adapters/brevo";
import type { EmailProviderAdapter } from "./adapters/base";
import { MailchimpTransactionalEmailAdapter } from "./adapters/mailchimp-transactional";
import type { Lane2ProviderConnection, Lane2SendResult, Lane2TransactionalEmailRequest } from "./types";
import { validateLane2Request } from "./validation";
import { InMemoryTransactionalEmailRepository } from "./repository";

const ADAPTERS: Record<string, EmailProviderAdapter> = {
  brevo: new BrevoEmailAdapter(),
  mailchimp_transactional: new MailchimpTransactionalEmailAdapter(),
};

export class Lane2TransactionalEmailService {
  constructor(
    private readonly repository: Pick<InMemoryTransactionalEmailRepository, "createOutboundAttempt" | "markOutboundResult">,
    private readonly adapters: Record<string, EmailProviderAdapter> = ADAPTERS
  ) {}

  async send(request: Lane2TransactionalEmailRequest, connection: Lane2ProviderConnection): Promise<{ logId: string; result: Lane2SendResult }> {
    if (request.orgId !== connection.orgId || request.appId !== connection.appId) {
      throw new Error("request org/app context does not match provider connection");
    }

    validateLane2Request(connection.provider, request);

    const adapter = this.adapters[connection.provider];
    if (!adapter) {
      throw new Error(`unsupported provider: ${connection.provider}`);
    }

    const logId = randomUUID();
    await this.repository.createOutboundAttempt({
      id: logId,
      provider: connection.provider,
      providerConnectionId: connection.id,
      request,
    });

    const result = await adapter.send(connection, request);
    await this.repository.markOutboundResult(logId, result);
    return { logId, result };
  }
}
