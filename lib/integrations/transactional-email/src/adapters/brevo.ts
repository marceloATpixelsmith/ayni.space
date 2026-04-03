import { PROVIDER_CAPABILITIES } from "../capabilities";
import type { EmailProviderAdapter, FetchLike } from "./base";
import type {
  Lane2ProviderConnection,
  Lane2SendResult,
  Lane2TransactionalEmailRequest,
  NormalizedWebhookEvent,
  ProviderConnectionCredentials,
} from "../types";
import { sanitizeSnapshot } from "../sanitization";
import { normalizeProviderError } from "../errors";

function resolveBrevoBaseUrl(): string {
  return process.env["BREVO_API_BASE_URL"] ?? "https://api.brevo.com";
}

function mapBrevoPayload(request: Lane2TransactionalEmailRequest): Record<string, unknown> {
  return {
    sender: { email: request.fromEmail, name: request.fromName },
    to: request.to,
    cc: request.cc,
    bcc: request.bcc,
    replyTo: request.replyTo,
    subject: request.subject,
    textContent: request.textBody,
    htmlContent: request.htmlBody,
    templateId: request.templateRef !== undefined ? request.templateRef : undefined,
    params: request.templateParams,
    attachment: request.attachments?.filter((a) => !a.inline).map((a) => ({
      name: a.filename,
      content: a.contentBase64,
      type: a.contentType,
    })),
    inlineImage: request.attachments?.filter((a) => a.inline).map((a) => ({
      name: a.filename,
      content: a.contentBase64,
      type: a.contentType,
    })),
    tags: request.tags,
    headers: request.headers,
    scheduledAt: request.scheduledAt,
    messageVersions: request.providerOptions?.["messageVersions"],
  };
}

export class BrevoEmailAdapter implements EmailProviderAdapter {
  readonly provider = "brevo" as const;
  readonly capabilities = PROVIDER_CAPABILITIES.brevo;

  async send(connection: Lane2ProviderConnection, request: Lane2TransactionalEmailRequest, fetcher: FetchLike = fetch): Promise<Lane2SendResult> {
    const brevoBaseUrl = resolveBrevoBaseUrl();
    const payload = mapBrevoPayload(request);
    const response = await fetcher(`${brevoBaseUrl}/v3/smtp/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": connection.credentials.apiKey,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return {
        status: "failed",
        provider: this.provider,
        deliveryState: "failed",
        error: {
          ...normalizeProviderError({
            provider: "brevo",
            code: `brevo_${response.status}`,
            message: String(body["message"] ?? "Brevo send failed"),
            retryable: response.status >= 500,
            normalizedType: "provider",
            details: sanitizeSnapshot(body),
          }),
        },
        rawResponseSnapshot: sanitizeSnapshot(body),
      };
    }

    return {
      status: "accepted",
      provider: this.provider,
      deliveryState: request.scheduledAt ? "scheduled" : "accepted",
      providerMessageId: String(body["messageId"] ?? ""),
      rawResponseSnapshot: sanitizeSnapshot(body),
    };
  }

  async validateConnection(credentials: ProviderConnectionCredentials, fetcher: FetchLike = fetch) {
    const brevoBaseUrl = resolveBrevoBaseUrl();
    const response = await fetcher(`${brevoBaseUrl}/v3/account`, {
      method: "GET",
      headers: {
        "api-key": credentials.apiKey,
      },
    });
    if (!response.ok) {
      return { state: "invalid" as const, error: `Brevo authentication failed (${response.status})` };
    }
    return { state: "valid" as const };
  }

  normalizeWebhook(payload: unknown): NormalizedWebhookEvent[] {
    const events = Array.isArray(payload) ? payload : [payload];
    return events.map((entry): NormalizedWebhookEvent => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const rawType = String(row["event"] ?? "unknown");
      const messageId = typeof row["message-id"] === "string" ? row["message-id"] : undefined;
      const email = typeof row["email"] === "string" ? row["email"] : undefined;
      const state = rawType === "sent"
        ? "sent"
        : rawType === "delivered"
          ? "delivered"
          : rawType === "open"
            ? "opened"
            : rawType === "click"
              ? "clicked"
              : rawType === "hard_bounce"
                ? "bounced_hard"
                : rawType === "soft_bounce"
                  ? "bounced_soft"
                  : rawType === "blocked"
                    ? "blocked"
                    : rawType === "spam"
                      ? "complained"
                      : rawType === "deferred"
                        ? "deferred"
                        : rawType === "invalid"
                          ? "failed"
                          : rawType === "unsubscribed"
                            ? "unsubscribed"
                            : "failed";
      return {
        provider: "brevo",
        rawProviderEventType: rawType,
        normalizedEventType: state,
        providerMessageId: messageId,
        recipient: email,
        reason: typeof row["reason"] === "string" ? row["reason"] : undefined,
        diagnostic: typeof row["description"] === "string" ? row["description"] : undefined,
        rawPayload: sanitizeSnapshot(row),
      };
    });
  }
}

export { mapBrevoPayload };
