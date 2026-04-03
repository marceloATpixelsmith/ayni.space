import { db } from "@workspace/db";
import { emailWebhookEventsTable, outboundEmailLogsTable, tenantEmailProviderConnectionsTable } from "@workspace/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import type {
  EmailProvider,
  Lane2SendResult,
  Lane2TransactionalEmailRequest,
  NormalizedDeliveryState,
  ProviderConnectionValidationState,
} from "./types";
import { sanitizeSnapshot } from "./sanitization";

export type OutboundLogCreateInput = {
  id: string;
  provider: "brevo" | "mailchimp_transactional";
  providerConnectionId: string;
  request: Lane2TransactionalEmailRequest;
};

export class TransactionalEmailRepository {
  async findActiveConnection(orgId: string, appId: string) {
    return db.query.tenantEmailProviderConnectionsTable.findFirst({
      where: and(
        eq(tenantEmailProviderConnectionsTable.orgId, orgId),
        eq(tenantEmailProviderConnectionsTable.appId, appId),
        eq(tenantEmailProviderConnectionsTable.isActive, true),
        isNull(tenantEmailProviderConnectionsTable.deletedAt),
      ),
      orderBy: [desc(tenantEmailProviderConnectionsTable.updatedAt)],
    });
  }

  async findConnectionById(connectionId: string) {
    return db.query.tenantEmailProviderConnectionsTable.findFirst({
      where: eq(tenantEmailProviderConnectionsTable.id, connectionId),
    });
  }

  async updateConnectionValidation(
    connectionId: string,
    validation: {
      state: ProviderConnectionValidationState;
      error?: string;
    }
  ): Promise<void> {
    await db
      .update(tenantEmailProviderConnectionsTable)
      .set({
        lastValidatedAt: new Date(),
        lastValidationStatus: validation.state,
        lastValidationError: validation.error ?? null,
        status: validation.state === "valid" ? "validated" : "invalid",
        updatedAt: new Date(),
      })
      .where(eq(tenantEmailProviderConnectionsTable.id, connectionId));
  }

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

  async markOutboundProviderMessage(logId: string, providerMessageId?: string, providerRequestId?: string): Promise<void> {
    await db
      .update(outboundEmailLogsTable)
      .set({
        providerMessageId: providerMessageId ?? null,
        providerRequestId: providerRequestId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(outboundEmailLogsTable.id, logId));
  }

  async findOutboundLogByProviderMessage(provider: EmailProvider, providerMessageId: string) {
    return db.query.outboundEmailLogsTable.findFirst({
      where: and(eq(outboundEmailLogsTable.provider, provider), eq(outboundEmailLogsTable.providerMessageId, providerMessageId)),
      orderBy: [desc(outboundEmailLogsTable.createdAt)],
    });
  }

  async updateOutboundDeliveryState(logId: string, state: NormalizedDeliveryState): Promise<void> {
    await db
      .update(outboundEmailLogsTable)
      .set({
        deliveryState: state,
        updatedAt: new Date(),
      })
      .where(eq(outboundEmailLogsTable.id, logId));
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
  connections: Array<{
    id: string;
    orgId: string;
    appId: string;
    provider: EmailProvider;
    encryptedCredentials: string;
    defaultSenderName?: string | null;
    defaultSenderEmail?: string | null;
    defaultReplyTo?: string | null;
    isActive?: boolean;
  }> = [];
  webhookEvents: Array<Record<string, unknown>> = [];

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

  async findActiveConnection(orgId: string, appId: string) {
    return this.connections.find((connection) => connection.orgId === orgId && connection.appId === appId && connection.isActive !== false);
  }

  async findConnectionById(connectionId: string) {
    return this.connections.find((connection) => connection.id === connectionId);
  }

  async updateConnectionValidation(connectionId: string, validation: { state: ProviderConnectionValidationState; error?: string }) {
    const connection = this.connections.find((item) => item.id === connectionId);
    if (!connection) return;
    (connection as Record<string, unknown>)["lastValidationStatus"] = validation.state;
    (connection as Record<string, unknown>)["lastValidationError"] = validation.error ?? null;
  }

  async markOutboundProviderMessage(logId: string, providerMessageId?: string, providerRequestId?: string) {
    const row = this.outboundLogs.find((entry) => entry["id"] === logId);
    if (!row) return;
    row["providerMessageId"] = providerMessageId;
    row["providerRequestId"] = providerRequestId;
  }

  async findOutboundLogByProviderMessage(provider: EmailProvider, providerMessageId: string) {
    return this.outboundLogs.find((entry) => entry["provider"] === provider && entry["providerMessageId"] === providerMessageId);
  }

  async updateOutboundDeliveryState(logId: string, state: NormalizedDeliveryState) {
    const row = this.outboundLogs.find((entry) => entry["id"] === logId);
    if (!row) return;
    row["deliveryState"] = state;
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
  }) {
    this.webhookEvents.push(event);
  }
}
