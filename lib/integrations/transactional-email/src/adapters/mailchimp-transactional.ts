import { PROVIDER_CAPABILITIES } from "../capabilities";
import type { EmailProviderAdapter, FetchLike } from "./base";
import type { Lane2ProviderConnection, Lane2SendResult, Lane2TransactionalEmailRequest } from "../types";
import { sanitizeSnapshot } from "../sanitization";

const MAILCHIMP_TX_ENDPOINT = "https://mandrillapp.com/api/1.0/messages/send.json";

function mapMailchimpPayload(connection: Lane2ProviderConnection, request: Lane2TransactionalEmailRequest): Record<string, unknown> {
  return {
    key: connection.credentials.apiKey,
    message: {
      from_email: request.fromEmail,
      from_name: request.fromName,
      headers: request.headers,
      subject: request.subject,
      text: request.textBody,
      html: request.htmlBody,
      to: [
        ...request.to.map((item) => ({ email: item.email, name: item.name, type: "to" })),
        ...(request.cc ?? []).map((item) => ({ email: item.email, name: item.name, type: "cc" })),
        ...(request.bcc ?? []).map((item) => ({ email: item.email, name: item.name, type: "bcc" })),
      ],
      important: false,
      track_opens: request.tracking?.opens,
      track_clicks: request.tracking?.clicks,
      metadata: request.metadata,
      tags: request.tags,
      merge: Boolean(request.templateParams),
      merge_vars: request.templateParams
        ? [
            {
              rcpt: request.to[0]?.email,
              vars: Object.entries(request.templateParams).map(([name, content]) => ({ name, content })),
            },
          ]
        : undefined,
      attachments: request.attachments
        ?.filter((a) => !a.inline)
        .map((a) => ({ type: a.contentType, name: a.filename, content: a.contentBase64 })),
      images: request.attachments
        ?.filter((a) => a.inline)
        .map((a) => ({ type: a.contentType, name: a.filename, content: a.contentBase64 })),
    },
    send_at: request.scheduledAt,
    ip_pool: request.providerOptions?.["ipPool"],
  };
}

export class MailchimpTransactionalEmailAdapter implements EmailProviderAdapter {
  readonly provider = "mailchimp_transactional" as const;
  readonly capabilities = PROVIDER_CAPABILITIES.mailchimp_transactional;

  async send(connection: Lane2ProviderConnection, request: Lane2TransactionalEmailRequest, fetcher: FetchLike = fetch): Promise<Lane2SendResult> {
    const payload = mapMailchimpPayload(connection, request);
    const response = await fetcher(MAILCHIMP_TX_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => [])) as Array<Record<string, unknown>> | Record<string, unknown>;
    if (!response.ok || !Array.isArray(body)) {
      const errorObject = Array.isArray(body) ? body[0] ?? {} : body;
      return {
        status: "failed",
        provider: this.provider,
        deliveryState: "failed",
        error: {
          code: `mailchimp_transactional_${response.status}`,
          message: String(errorObject["message"] ?? "Mailchimp Transactional send failed"),
          retryable: response.status >= 500,
          details: sanitizeSnapshot(errorObject),
        },
        rawResponseSnapshot: sanitizeSnapshot(errorObject),
      };
    }

    const first = body[0] ?? {};
    const messageStatus = String(first["status"] ?? "sent");
    const resultStatus = messageStatus === "rejected" ? "rejected" : "accepted";
    const deliveryState = messageStatus === "scheduled" ? "scheduled" : messageStatus === "rejected" ? "rejected" : "accepted";

    return {
      status: resultStatus,
      provider: this.provider,
      providerMessageId: String(first["_id"] ?? ""),
      providerRequestId: String(first["queued_reason"] ?? ""),
      deliveryState,
      error:
        messageStatus === "rejected"
          ? {
              code: "mailchimp_transactional_rejected",
              message: String(first["reject_reason"] ?? "rejected"),
              retryable: false,
              details: sanitizeSnapshot(first),
            }
          : undefined,
      rawResponseSnapshot: sanitizeSnapshot(first),
    };
  }
}

export { mapMailchimpPayload };
