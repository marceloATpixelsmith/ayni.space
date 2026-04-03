export type EmailProvider = "brevo" | "mailchimp_transactional";

export type NormalizedDeliveryState =
  | "pending"
  | "accepted"
  | "scheduled"
  | "sent"
  | "delivered"
  | "opened"
  | "clicked"
  | "bounced_soft"
  | "bounced_hard"
  | "deferred"
  | "complained"
  | "unsubscribed"
  | "blocked"
  | "rejected"
  | "failed"
  | "cancelled";

export type NormalizedAttemptResult = "accepted" | "queued" | "rejected" | "failed";

export type EmailAddress = { email: string; name?: string };

export type EmailAttachment = {
  filename: string;
  contentType?: string;
  contentBase64: string;
  contentId?: string;
  inline?: boolean;
};

export type EmailTrackingOptions = {
  opens?: boolean;
  clicks?: boolean;
  unsubscribes?: boolean;
};

export type Lane2TransactionalEmailRequest = {
  orgId: string;
  appId: string;
  actorUserId?: string;
  correlationId: string;
  idempotencyKey?: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  subject?: string;
  textBody?: string;
  htmlBody?: string;
  templateRef?: string;
  templateParams?: Record<string, unknown>;
  attachments?: EmailAttachment[];
  tags?: string[];
  metadata?: Record<string, string>;
  headers?: Record<string, string>;
  scheduledAt?: string;
  tracking?: EmailTrackingOptions;
  providerOptions?: Record<string, unknown>;
};

export type ProviderCapabilities = {
  supportsTemplates: boolean;
  supportsScheduling: boolean;
  supportsMetadata: boolean;
  supportsTags: boolean;
  supportsInlineAttachments: boolean;
  supportsBatchSend: boolean;
  supportsWebhooks: boolean;
  supportsReplyTo: boolean;
  supportsCcBcc: boolean;
  supportsCustomHeaders: boolean;
};

export type NormalizedProviderError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type Lane2SendResult = {
  status: NormalizedAttemptResult;
  provider: EmailProvider;
  providerMessageId?: string;
  providerRequestId?: string;
  deliveryState: NormalizedDeliveryState;
  error?: NormalizedProviderError;
  rawResponseSnapshot?: Record<string, unknown>;
};

export type ProviderConnectionValidationState = "valid" | "invalid" | "degraded";

export type ProviderConnectionCredentials = {
  apiKey: string;
  serverPrefix?: string;
};

export type Lane2ProviderConnection = {
  id: string;
  orgId: string;
  appId: string;
  provider: EmailProvider;
  credentials: ProviderConnectionCredentials;
  defaultSenderName?: string;
  defaultSenderEmail?: string;
  defaultReplyTo?: string;
};

export type NormalizedWebhookEvent = {
  provider: EmailProvider;
  rawProviderEventType: string;
  normalizedEventType: NormalizedDeliveryState;
  providerMessageId?: string;
  recipient?: string;
  reason?: string;
  diagnostic?: string;
  rawPayload: Record<string, unknown>;
};
