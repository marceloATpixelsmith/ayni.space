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

const MAILCHIMP_TX_ENDPOINT = "https://mandrillapp.com/api/1.0/messages/send.json";
const MAILCHIMP_TX_TEMPLATE_ENDPOINT = "https://mandrillapp.com/api/1.0/messages/send-template.json";
const MAILCHIMP_TX_PING_ENDPOINT = "https://mandrillapp.com/api/1.0/users/ping2.json";

function mapMailchimpPayload(connection: Lane2ProviderConnection, request: Lane2TransactionalEmailRequest): Record<string, unknown> {
  const headers: Record<string, string> = { ...(request.headers ?? {}) };
  if (request.replyTo?.email) {
    headers["Reply-To"] = request.replyTo.name
      ? `${request.replyTo.name} <${request.replyTo.email}>`
      : request.replyTo.email;
  }

  return {
    key: connection.credentials.apiKey,
    message: {
      from_email: request.fromEmail,
      from_name: request.fromName,
      headers,
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
    template_name: request.templateRef ?? undefined,
    template_content: request.templateRef ? [] : undefined,
    send_at: request.scheduledAt,
    ip_pool: request.providerOptions?.["ipPool"],
  };
}

export class MailchimpTransactionalEmailAdapter implements EmailProviderAdapter {
  readonly provider = "mailchimp_transactional" as const;
  readonly capabilities = PROVIDER_CAPABILITIES.mailchimp_transactional;

  async send(connection: Lane2ProviderConnection, request: Lane2TransactionalEmailRequest, fetcher: FetchLike = fetch): Promise<Lane2SendResult> {
    const payload = mapMailchimpPayload(connection, request);
    const endpoint = request.templateRef ? MAILCHIMP_TX_TEMPLATE_ENDPOINT : MAILCHIMP_TX_ENDPOINT;
    const response = await fetcher(endpoint, {
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
          ...normalizeProviderError({
            provider: "mailchimp_transactional",
            code: `mailchimp_transactional_${response.status}`,
            message: String(errorObject["message"] ?? "Mailchimp Transactional send failed"),
            retryable: response.status >= 500,
            normalizedType: "provider",
            details: sanitizeSnapshot(errorObject),
          }),
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
              ...normalizeProviderError({
                provider: "mailchimp_transactional",
                code: "mailchimp_transactional_rejected",
                message: String(first["reject_reason"] ?? "rejected"),
                retryable: false,
                normalizedType: "provider",
                details: sanitizeSnapshot(first),
              }),
            }
          : undefined,
      rawResponseSnapshot: sanitizeSnapshot(first),
    };
  }

  async validateConnection(credentials: ProviderConnectionCredentials, fetcher: FetchLike = fetch) {
    const response = await fetcher(MAILCHIMP_TX_PING_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: credentials.apiKey }),
    });
    if (!response.ok) {
      return { state: "invalid" as const, error: `Mailchimp Transactional authentication failed (${response.status})` };
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (String(body["PING"] ?? "") !== "PONG!") {
      return { state: "degraded" as const, error: "Mailchimp Transactional ping returned unexpected response" };
    }
    return { state: "valid" as const };
  }

  normalizeWebhook(payload: unknown): NormalizedWebhookEvent[] {
    const events = Array.isArray(payload) ? payload : [payload];
    return events.map((entry): NormalizedWebhookEvent => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const rawType = String(row["event"] ?? "unknown");
      const msg = (row["msg"] ?? {}) as Record<string, unknown>;
      const providerMessageId = typeof msg["_id"] === "string" ? msg["_id"] : undefined;
      const state = rawType === "send"
        ? "sent"
        : rawType === "deferral"
          ? "deferred"
          : rawType === "hard_bounce"
            ? "bounced_hard"
            : rawType === "soft_bounce"
              ? "bounced_soft"
              : rawType === "open"
                ? "opened"
                : rawType === "click"
                  ? "clicked"
                  : rawType === "spam"
                    ? "complained"
                    : rawType === "unsub"
                      ? "unsubscribed"
                      : rawType === "reject"
                        ? "rejected"
                        : "failed";
      return {
        provider: "mailchimp_transactional",
        rawProviderEventType: rawType,
        normalizedEventType: state,
        providerMessageId,
        recipient: typeof row["email"] === "string" ? row["email"] : undefined,
        reason: typeof row["reason"] === "string" ? row["reason"] : undefined,
        diagnostic: typeof row["diag"] === "string" ? row["diag"] : undefined,
        rawPayload: sanitizeSnapshot(row),
      };
    });
  }
}

export { mapMailchimpPayload };
