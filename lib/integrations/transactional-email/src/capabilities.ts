import type { EmailProvider, ProviderCapabilities } from "./types";

export const PROVIDER_CAPABILITIES: Record<EmailProvider, ProviderCapabilities> = {
  brevo: {
    supportsTemplates: true,
    supportsScheduling: true,
    supportsMetadata: true,
    supportsTags: true,
    supportsInlineAttachments: true,
    supportsBatchSend: true,
    supportsWebhooks: true,
    supportsReplyTo: true,
    supportsCcBcc: true,
    supportsCustomHeaders: true,
  },
  mailchimp_transactional: {
    supportsTemplates: true,
    supportsScheduling: true,
    supportsMetadata: true,
    supportsTags: true,
    supportsInlineAttachments: true,
    supportsBatchSend: true,
    supportsWebhooks: true,
    supportsReplyTo: true,
    supportsCcBcc: true,
    supportsCustomHeaders: true,
  },
};
