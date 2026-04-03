import { db } from "@workspace/db";
import { emailWebhookEventsTable, outboundEmailLogsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import type { Lane2SendResult, Lane2TransactionalEmailRequest, NormalizedDeliveryState } from "./types";
import { sanitizeSnapshot } from "./sanitization";

export type OutboundLogCreateInput = {
  id: string;
  provider: "brevo" | "mailchimp_transactional";
  providerConnectionId: string;
  request: Lane2TransactionalEmailRequest;
};

export class TransactionalEmailRepository {
  async createOutboundAttempt(input: OutboundLogCreateInput): Promise<void> {
    await db.insert(outboundEmailLogsTable).values({
      id: input.id,
      lane: "lane2",
      orgId: input.request.orgId,
      appId: input.request.appId,
      provider: input.provider,
      providerConnectionId: input.providerConnectionId,
      correlationId: input.request.correlationId,
      idempotencyKey: input.request.idempotencyKey,
      actorUserId: input.request.actorUserId,
      requestedPayloadSnapshot: sanitizeSnapshot(input.request),
      requestedSubject: input.request.subject,
      requestedFrom: input.request.fromEmail,
      requestedTo: input.request.to.map((r) => r.email),
      requestedTemplateReference: input.request.templateRef,
      requestedScheduledAt: input.request.scheduledAt ? new Date(input.request.scheduledAt) : null,
      attemptResult: "failed",
      deliveryState: "pending",
    });
  }

  async markOutboundResult(logId: string, result: Lane2SendResult): Promise<void> {
    const deliveryState: NormalizedDeliveryState = result.deliveryState;
    await db
      .update(outboundEmailLogsTable)
      .set({
        attemptResult: result.status,
        deliveryState,
        providerMessageId: result.providerMessageId,
        providerRequestId: result.providerRequestId,
        normalizedErrorCode: result.error?.code,
        normalizedErrorMessage: result.error?.message,
        providerResponseSnapshot: sanitizeSnapshot(result.rawResponseSnapshot ?? {}),
        acceptedAt: result.status === "accepted" || result.status === "queued" ? new Date() : null,
        failedAt: result.status === "failed" || result.status === "rejected" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(outboundEmailLogsTable.id, logId));
  }

  async insertWebhookEvent(event: {
    id: string;
    provider: "brevo" | "mailchimp_transactional";
    rawProviderEventType: string;
    normalizedEventType: NormalizedDeliveryState;
    providerMessageId?: string;
    recipient?: string;
    deliveryState?: NormalizedDeliveryState;
    reason?: string;
    diagnostic?: string;
    rawPayload: Record<string, unknown>;
    linkedOutboundEmailLogId?: string;
  }): Promise<void> {
    await db.insert(emailWebhookEventsTable).values({
      id: event.id,
      provider: event.provider,
      rawProviderEventType: event.rawProviderEventType,
      normalizedEventType: event.normalizedEventType,
      providerMessageId: event.providerMessageId,
      recipient: event.recipient,
      deliveryState: event.deliveryState,
      reason: event.reason,
      diagnostic: event.diagnostic,
      rawPayload: sanitizeSnapshot(event.rawPayload),
      linkedOutboundEmailLogId: event.linkedOutboundEmailLogId,
    });
  }
}

export class InMemoryTransactionalEmailRepository {
  outboundLogs: Array<Record<string, unknown>> = [];

  async createOutboundAttempt(input: OutboundLogCreateInput): Promise<void> {
    this.outboundLogs.push({
      id: input.id,
      lane: "lane2",
      provider: input.provider,
      providerConnectionId: input.providerConnectionId,
      request: sanitizeSnapshot(input.request),
      status: "pending",
    });
  }

  async markOutboundResult(logId: string, result: Lane2SendResult): Promise<void> {
    const row = this.outboundLogs.find((entry) => entry["id"] === logId);
    if (!row) {
      return;
    }
    row["status"] = result.status;
    row["result"] = sanitizeSnapshot(result);
  }
}
