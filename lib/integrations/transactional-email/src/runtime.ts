import { randomUUID } from "node:crypto";
import { decryptJson } from "./crypto";
import type { EmailProviderAdapter } from "./adapters/base";
import { BrevoEmailAdapter } from "./adapters/brevo";
import { MailchimpTransactionalEmailAdapter } from "./adapters/mailchimp-transactional";
import { TransactionalEmailRepository } from "./repository";
import { Lane2TransactionalEmailService } from "./service";
import type { Lane2TransactionalEmailRequest, NormalizedWebhookEvent, ProviderConnectionCredentials, ProviderConnectionValidationState } from "./types";
import { sanitizeSnapshot } from "./sanitization";

const ADAPTERS: Record<string, EmailProviderAdapter> = {
  brevo: new BrevoEmailAdapter(),
  mailchimp_transactional: new MailchimpTransactionalEmailAdapter(),
};

export class Lane2TransactionalEmailRuntime {
  constructor(
    private readonly repository: Pick<
      TransactionalEmailRepository,
      | "findActiveConnection"
      | "findConnectionById"
      | "updateConnectionValidation"
      | "findOutboundLogByProviderMessage"
      | "updateOutboundDeliveryState"
      | "insertWebhookEvent"
      | "createOutboundAttempt"
      | "markOutboundResult"
    >,
    private readonly adapters: Record<string, EmailProviderAdapter> = ADAPTERS
  ) {}

  private getEncryptionKey() {
    const key = process.env["EMAIL_CREDENTIALS_ENCRYPTION_KEY"];
    if (!key) throw new Error("EMAIL_CREDENTIALS_ENCRYPTION_KEY is required");
    return key;
  }

  private decodeCredentials(encryptedCredentials: string): ProviderConnectionCredentials {
    return decryptJson<ProviderConnectionCredentials>(encryptedCredentials, this.getEncryptionKey());
  }

  async send(request: Lane2TransactionalEmailRequest) {
    const connection = await this.repository.findActiveConnection(request.orgId, request.appId);
    if (!connection) {
      throw new Error("No active provider connection configured for org/app");
    }
    const adapter = this.adapters[connection.provider];
    if (!adapter) {
      throw new Error(`Unsupported provider: ${connection.provider}`);
    }
    const service = new Lane2TransactionalEmailService(this.repository as any, this.adapters);
    return service.send(request, {
      id: connection.id,
      orgId: connection.orgId,
      appId: connection.appId,
      provider: connection.provider,
      credentials: this.decodeCredentials(connection.encryptedCredentials),
      defaultReplyTo: connection.defaultReplyTo ?? undefined,
      defaultSenderEmail: connection.defaultSenderEmail ?? undefined,
      defaultSenderName: connection.defaultSenderName ?? undefined,
    });
  }

  async validateConnection(connectionId: string): Promise<{ state: ProviderConnectionValidationState; error?: string }> {
    const connection = await this.repository.findConnectionById(connectionId);
    if (!connection) {
      throw new Error("Provider connection not found");
    }
    const adapter = this.adapters[connection.provider];
    if (!adapter) {
      throw new Error(`Unsupported provider: ${connection.provider}`);
    }
    const validation = await adapter.validateConnection(this.decodeCredentials(connection.encryptedCredentials));
    await this.repository.updateConnectionValidation(connection.id, validation);
    return validation;
  }

  async ingestWebhook(provider: "brevo" | "mailchimp_transactional", payload: unknown) {
    const adapter = this.adapters[provider];
    let normalizedEvents: NormalizedWebhookEvent[];
    try {
      normalizedEvents = adapter.normalizeWebhook(payload);
    } catch (error) {
      normalizedEvents = [
        {
          provider,
          rawProviderEventType: "unknown",
          normalizedEventType: "failed" as const,
          reason: "normalization_failed",
          diagnostic: error instanceof Error ? error.message : "unknown normalization error",
          rawPayload: sanitizeSnapshot({ payload }),
        },
      ];
    }
    for (const event of normalizedEvents) {
      try {
        const log = event.providerMessageId
          ? await this.repository.findOutboundLogByProviderMessage(event.provider, event.providerMessageId)
          : null;
        await this.repository.insertWebhookEvent({
          id: randomUUID(),
          provider: event.provider,
          rawProviderEventType: event.rawProviderEventType,
          normalizedEventType: event.normalizedEventType,
          providerMessageId: event.providerMessageId,
          recipient: event.recipient,
          deliveryState: event.normalizedEventType,
          reason: event.reason ?? (event.rawProviderEventType === "unknown" ? "unknown_event_type" : undefined),
          diagnostic: event.diagnostic,
          rawPayload: event.rawPayload,
          linkedOutboundEmailLogId: (log?.id as string | undefined) ?? undefined,
          correlationStatus: log?.id ? "linked" : "unlinked",
        });
        if (log?.id) {
          await this.repository.updateOutboundDeliveryState(String(log.id), event.normalizedEventType);
        }
      } catch {
        await this.repository.insertWebhookEvent({
          id: randomUUID(),
          provider: event.provider,
          rawProviderEventType: "unknown",
          normalizedEventType: "failed",
          providerMessageId: event.providerMessageId,
          recipient: event.recipient,
          deliveryState: "failed",
          reason: "webhook_processing_failed",
          diagnostic: "failed to process normalized webhook event",
          rawPayload: sanitizeSnapshot(event.rawPayload),
          correlationStatus: "unlinked",
        });
      }
    }
    return normalizedEvents.length;
  }
}
