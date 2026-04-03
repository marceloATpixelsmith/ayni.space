import { PROVIDER_CAPABILITIES } from "../capabilities";
import type { EmailProviderAdapter, FetchLike } from "./base";
import type { Lane2ProviderConnection, Lane2SendResult, Lane2TransactionalEmailRequest } from "../types";
import { sanitizeSnapshot } from "../sanitization";

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

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
    templateId: request.templateRef ? Number(request.templateRef) : undefined,
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
    const payload = mapBrevoPayload(request);
    const response = await fetcher(BREVO_ENDPOINT, {
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
          code: `brevo_${response.status}`,
          message: String(body["message"] ?? "Brevo send failed"),
          retryable: response.status >= 500,
          details: sanitizeSnapshot(body),
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
}

export { mapBrevoPayload };
