import { db } from "@workspace/db";
import { emailWebhookEventsTable, outboundEmailLogsTable, tenantEmailProviderConnectionsTable } from "@workspace/db/schema";
import { and, desc, eq, gte, ilike, isNull, lte, ne, type SQL } from "drizzle-orm";
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

export type RedactedConnectionSummary = {
  id: string;
  orgId: string;
  appId: string;
  provider: EmailProvider;
  status: "pending" | "validated" | "invalid" | "disabled";
  isActive: boolean;
  displayLabel: string;
  defaultSenderName: string | null;
  defaultSenderEmail: string | null;
  defaultReplyTo: string | null;
  credentialKeyVersion: string;
  redactedCredential: string;
  lastValidatedAt: Date | null;
  lastValidationStatus: string | null;
  lastValidationError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ConnectionListFilters = {
  orgId: string;
  appId?: string;
  provider?: EmailProvider;
  includeInactive?: boolean;
};

export type OutboundLogQueryFilters = {
  orgId?: string;
  appId?: string;
  lane?: "lane2";
  provider?: EmailProvider;
  providerConnectionId?: string;
  attemptResult?: "accepted" | "queued" | "rejected" | "failed";
  deliveryState?: NormalizedDeliveryState;
  recipient?: string;
  subject?: string;
  providerMessageId?: string;
  correlationId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
  offset: number;
};

export type EmailEventQueryFilters = {
  orgId?: string;
  provider?: EmailProvider;
  normalizedEventType?: NormalizedDeliveryState;
  providerMessageId?: string;
  recipient?: string;
  linkedOutboundEmailLogId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit: number;
  offset: number;
};

function redactApiCredential(encrypted: string): string {
  const visible = encrypted.slice(-4);
  return `enc_***${visible}`;
}

function toRedactedConnectionSummary(connection: typeof tenantEmailProviderConnectionsTable.$inferSelect): RedactedConnectionSummary {
  return {
    id: connection.id,
    orgId: connection.orgId,
    appId: connection.appId,
    provider: connection.provider,
    status: connection.status,
    isActive: connection.isActive,
    displayLabel: connection.displayLabel,
    defaultSenderName: connection.defaultSenderName,
    defaultSenderEmail: connection.defaultSenderEmail,
    defaultReplyTo: connection.defaultReplyTo,
    credentialKeyVersion: connection.credentialKeyVersion,
    redactedCredential: redactApiCredential(connection.encryptedCredentials),
    lastValidatedAt: connection.lastValidatedAt,
    lastValidationStatus: connection.lastValidationStatus,
    lastValidationError: connection.lastValidationError,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}

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

  async createConnection(input: {
    id: string;
    orgId: string;
    appId: string;
    provider: EmailProvider;
    displayLabel: string;
    encryptedCredentials: string;
    credentialKeyVersion: string;
    defaultSenderName?: string | null;
    defaultSenderEmail?: string | null;
    defaultReplyTo?: string | null;
    deactivateOtherConnectionsForOrgApp?: boolean;
  }): Promise<RedactedConnectionSummary> {
    if (input.deactivateOtherConnectionsForOrgApp) {
      await db
        .update(tenantEmailProviderConnectionsTable)
        .set({ isActive: false, status: "disabled", updatedAt: new Date() })
        .where(
          and(
            eq(tenantEmailProviderConnectionsTable.orgId, input.orgId),
            eq(tenantEmailProviderConnectionsTable.appId, input.appId),
            eq(tenantEmailProviderConnectionsTable.isActive, true),
            isNull(tenantEmailProviderConnectionsTable.deletedAt)
          )
        );
    }

    const [row] = await db
      .insert(tenantEmailProviderConnectionsTable)
      .values({
        id: input.id,
        orgId: input.orgId,
        appId: input.appId,
        provider: input.provider,
        displayLabel: input.displayLabel,
        encryptedCredentials: input.encryptedCredentials,
        credentialKeyVersion: input.credentialKeyVersion,
        defaultSenderName: input.defaultSenderName ?? null,
        defaultSenderEmail: input.defaultSenderEmail ?? null,
        defaultReplyTo: input.defaultReplyTo ?? null,
        status: "pending",
        isActive: true,
      })
      .returning();

    return toRedactedConnectionSummary(row);
  }

  async listConnections(filters: ConnectionListFilters): Promise<RedactedConnectionSummary[]> {
    const clauses: SQL<unknown>[] = [eq(tenantEmailProviderConnectionsTable.orgId, filters.orgId), isNull(tenantEmailProviderConnectionsTable.deletedAt)];
    if (!filters.includeInactive) clauses.push(eq(tenantEmailProviderConnectionsTable.isActive, true));
    if (filters.appId) clauses.push(eq(tenantEmailProviderConnectionsTable.appId, filters.appId));
    if (filters.provider) clauses.push(eq(tenantEmailProviderConnectionsTable.provider, filters.provider));

    const rows = await db.query.tenantEmailProviderConnectionsTable.findMany({
      where: and(...clauses),
      orderBy: [desc(tenantEmailProviderConnectionsTable.updatedAt)],
    });
    return rows.map(toRedactedConnectionSummary);
  }

  async updateConnectionNonSecret(
    connectionId: string,
    updates: Partial<{
      displayLabel: string;
      defaultSenderName: string | null;
      defaultSenderEmail: string | null;
      defaultReplyTo: string | null;
    }>
  ): Promise<RedactedConnectionSummary | null> {
    const [row] = await db
      .update(tenantEmailProviderConnectionsTable)
      .set({
        ...(updates.displayLabel !== undefined ? { displayLabel: updates.displayLabel } : {}),
        ...(updates.defaultSenderName !== undefined ? { defaultSenderName: updates.defaultSenderName } : {}),
        ...(updates.defaultSenderEmail !== undefined ? { defaultSenderEmail: updates.defaultSenderEmail } : {}),
        ...(updates.defaultReplyTo !== undefined ? { defaultReplyTo: updates.defaultReplyTo } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tenantEmailProviderConnectionsTable.id, connectionId))
      .returning();
    return row ? toRedactedConnectionSummary(row) : null;
  }

  async rotateConnectionCredential(
    connectionId: string,
    encryptedCredentials: string,
    credentialKeyVersion: string
  ): Promise<RedactedConnectionSummary | null> {
    const [row] = await db
      .update(tenantEmailProviderConnectionsTable)
      .set({
        encryptedCredentials,
        credentialKeyVersion,
        status: "pending",
        lastValidatedAt: null,
        lastValidationStatus: null,
        lastValidationError: null,
        updatedAt: new Date(),
      })
      .where(eq(tenantEmailProviderConnectionsTable.id, connectionId))
      .returning();
    return row ? toRedactedConnectionSummary(row) : null;
  }

  async setConnectionActiveState(connectionId: string, isActive: boolean): Promise<RedactedConnectionSummary | null> {
    const [connection] = await db
      .update(tenantEmailProviderConnectionsTable)
      .set({
        isActive,
        status: isActive ? "pending" : "disabled",
        updatedAt: new Date(),
      })
      .where(eq(tenantEmailProviderConnectionsTable.id, connectionId))
      .returning();

    if (!connection) return null;

    if (isActive) {
      await db
        .update(tenantEmailProviderConnectionsTable)
        .set({ isActive: false, status: "disabled", updatedAt: new Date() })
        .where(
          and(
            eq(tenantEmailProviderConnectionsTable.orgId, connection.orgId),
            eq(tenantEmailProviderConnectionsTable.appId, connection.appId),
            eq(tenantEmailProviderConnectionsTable.isActive, true),
            isNull(tenantEmailProviderConnectionsTable.deletedAt),
            ne(tenantEmailProviderConnectionsTable.id, connection.id)
          )
        );
    }

    return toRedactedConnectionSummary(connection);
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

  async listOutboundLogs(filters: OutboundLogQueryFilters) {
    const whereClauses: SQL<unknown>[] = [];
    if (filters.orgId) whereClauses.push(eq(outboundEmailLogsTable.orgId, filters.orgId));
    if (filters.appId) whereClauses.push(eq(outboundEmailLogsTable.appId, filters.appId));
    if (filters.lane) whereClauses.push(eq(outboundEmailLogsTable.lane, filters.lane));
    if (filters.provider) whereClauses.push(eq(outboundEmailLogsTable.provider, filters.provider));
    if (filters.providerConnectionId) whereClauses.push(eq(outboundEmailLogsTable.providerConnectionId, filters.providerConnectionId));
    if (filters.attemptResult) whereClauses.push(eq(outboundEmailLogsTable.attemptResult, filters.attemptResult));
    if (filters.deliveryState) whereClauses.push(eq(outboundEmailLogsTable.deliveryState, filters.deliveryState));
    if (filters.providerMessageId) whereClauses.push(eq(outboundEmailLogsTable.providerMessageId, filters.providerMessageId));
    if (filters.correlationId) whereClauses.push(eq(outboundEmailLogsTable.correlationId, filters.correlationId));
    if (filters.dateFrom) whereClauses.push(gte(outboundEmailLogsTable.createdAt, filters.dateFrom));
    if (filters.dateTo) whereClauses.push(lte(outboundEmailLogsTable.createdAt, filters.dateTo));
    if (filters.subject) whereClauses.push(ilike(outboundEmailLogsTable.requestedSubject, `%${filters.subject}%`));

    const whereExpr = whereClauses.length ? and(...whereClauses) : undefined;
    return db.query.outboundEmailLogsTable.findMany({
      where: whereExpr,
      orderBy: [desc(outboundEmailLogsTable.createdAt)],
      limit: filters.limit,
      offset: filters.offset,
    });
  }

  async findOutboundLogById(logId: string) {
    return db.query.outboundEmailLogsTable.findFirst({
      where: eq(outboundEmailLogsTable.id, logId),
    });
  }

  async listEvents(filters: EmailEventQueryFilters) {
    const whereClauses: SQL<unknown>[] = [];
    if (filters.provider) whereClauses.push(eq(emailWebhookEventsTable.provider, filters.provider));
    if (filters.normalizedEventType) whereClauses.push(eq(emailWebhookEventsTable.normalizedEventType, filters.normalizedEventType));
    if (filters.providerMessageId) whereClauses.push(eq(emailWebhookEventsTable.providerMessageId, filters.providerMessageId));
    if (filters.recipient) whereClauses.push(ilike(emailWebhookEventsTable.recipient, `%${filters.recipient}%`));
    if (filters.linkedOutboundEmailLogId) whereClauses.push(eq(emailWebhookEventsTable.linkedOutboundEmailLogId, filters.linkedOutboundEmailLogId));
    if (filters.dateFrom) whereClauses.push(gte(emailWebhookEventsTable.receivedAt, filters.dateFrom));
    if (filters.dateTo) whereClauses.push(lte(emailWebhookEventsTable.receivedAt, filters.dateTo));

    const whereExpr = whereClauses.length ? and(...whereClauses) : undefined;
    return db.query.emailWebhookEventsTable.findMany({
      where: whereExpr,
      orderBy: [desc(emailWebhookEventsTable.receivedAt)],
      limit: filters.limit,
      offset: filters.offset,
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
