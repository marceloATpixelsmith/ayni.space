import { boolean, index, jsonb, pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { platform } from "./_schemas";

export const emailProviderEnum = pgEnum("email_provider", ["brevo", "mailchimp_transactional"]);
export const emailConnectionStatusEnum = pgEnum("email_connection_status", ["pending", "validated", "invalid", "disabled"]);
export const emailLaneEnum = pgEnum("email_lane", ["lane1", "lane2"]);
export const emailAttemptResultEnum = pgEnum("email_attempt_result", ["accepted", "queued", "rejected", "failed"]);
export const emailDeliveryStateEnum = pgEnum("email_delivery_state", [
  "pending",
  "accepted",
  "scheduled",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced_soft",
  "bounced_hard",
  "deferred",
  "complained",
  "unsubscribed",
  "blocked",
  "rejected",
  "failed",
  "cancelled",
]);
export const emailNormalizedEventTypeEnum = pgEnum("email_normalized_event_type", [
  "pending",
  "accepted",
  "scheduled",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced_soft",
  "bounced_hard",
  "deferred",
  "complained",
  "unsubscribed",
  "blocked",
  "rejected",
  "failed",
  "cancelled",
]);
export const emailWebhookCorrelationStatusEnum = pgEnum("email_webhook_correlation_status", ["linked", "unlinked"]);

export const tenantEmailProviderConnectionsTable = platform.table(
  "tenant_email_provider_connections",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    appId: text("app_id").notNull(),
    provider: emailProviderEnum("provider").notNull(),
    status: emailConnectionStatusEnum("status").notNull().default("pending"),
    displayLabel: text("display_label").notNull(),
    defaultSenderName: text("default_sender_name"),
    defaultSenderEmail: text("default_sender_email"),
    defaultReplyTo: text("default_reply_to"),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    credentialKeyVersion: text("credential_key_version").notNull().default("v1"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastValidationStatus: text("last_validation_status"),
    lastValidationError: text("last_validation_error"),
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("tenant_email_provider_connections_org_idx").on(t.orgId),
    index("tenant_email_provider_connections_app_idx").on(t.appId),
    index("tenant_email_provider_connections_org_app_provider_idx").on(t.orgId, t.appId, t.provider),
  ]
);

export const outboundEmailLogsTable = platform.table(
  "outbound_email_logs",
  {
    id: text("id").primaryKey(),
    lane: emailLaneEnum("lane").notNull().default("lane2"),
    orgId: text("org_id"),
    appId: text("app_id").notNull(),
    provider: emailProviderEnum("provider").notNull(),
    providerConnectionId: text("provider_connection_id"),
    correlationId: text("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key"),
    actorUserId: text("actor_user_id"),
    requestedPayloadSnapshot: jsonb("requested_payload_snapshot").notNull().default({}),
    requestedSubject: text("requested_subject"),
    requestedFrom: text("requested_from"),
    requestedTo: text("requested_to").array().notNull().default([]),
    requestedTemplateReference: text("requested_template_reference"),
    requestedScheduledAt: timestamp("requested_scheduled_at", { withTimezone: true }),
    attemptResult: emailAttemptResultEnum("attempt_result").notNull().default("failed"),
    deliveryState: emailDeliveryStateEnum("delivery_state").notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    providerRequestId: text("provider_request_id"),
    normalizedErrorCode: text("normalized_error_code"),
    normalizedErrorMessage: text("normalized_error_message"),
    providerResponseSnapshot: jsonb("provider_response_snapshot").notNull().default({}),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("outbound_email_logs_org_idx").on(t.orgId),
    index("outbound_email_logs_provider_msg_idx").on(t.provider, t.providerMessageId),
    index("outbound_email_logs_correlation_idx").on(t.correlationId),
    index("outbound_email_logs_state_idx").on(t.deliveryState),
  ]
);

export const emailWebhookEventsTable = platform.table(
  "email_webhook_events",
  {
    id: text("id").primaryKey(),
    provider: emailProviderEnum("provider").notNull(),
    rawProviderEventType: text("raw_provider_event_type").notNull(),
    normalizedEventType: emailNormalizedEventTypeEnum("normalized_event_type").notNull(),
    providerMessageId: text("provider_message_id"),
    recipient: text("recipient"),
    deliveryState: emailDeliveryStateEnum("delivery_state"),
    reason: text("reason"),
    diagnostic: text("diagnostic"),
    rawPayload: jsonb("raw_payload").notNull().default({}),
    correlationStatus: emailWebhookCorrelationStatusEnum("correlation_status").notNull().default("linked"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    linkedOutboundEmailLogId: text("linked_outbound_email_log_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_webhook_events_provider_msg_idx").on(t.provider, t.providerMessageId),
    index("email_webhook_events_linked_log_idx").on(t.linkedOutboundEmailLogId),
    index("email_webhook_events_received_idx").on(t.receivedAt),
  ]
);
