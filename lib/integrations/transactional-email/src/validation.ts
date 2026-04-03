import { PROVIDER_CAPABILITIES } from "./capabilities";
import type { Lane2TransactionalEmailRequest, EmailProvider } from "./types";

export class EmailValidationError extends Error {
  constructor(message: string, readonly code: string = "validation_failed") {
    super(message);
    this.name = "EmailValidationError";
  }
}

export function validateLane2Request(provider: EmailProvider, request: Lane2TransactionalEmailRequest): void {
  if (!request.orgId || !request.appId) {
    throw new EmailValidationError("orgId and appId are required", "missing_context");
  }
  if (request.to.length === 0) {
    throw new EmailValidationError("at least one recipient is required", "missing_recipient");
  }
  if (!request.subject && !request.templateRef) {
    throw new EmailValidationError("subject or templateRef is required", "missing_subject_or_template");
  }
  if (!request.templateRef && !request.textBody && !request.htmlBody) {
    throw new EmailValidationError("textBody or htmlBody is required when templateRef is absent", "missing_body");
  }

  const caps = PROVIDER_CAPABILITIES[provider];
  if (!caps.supportsReplyTo && request.replyTo) {
    throw new EmailValidationError("provider does not support reply-to", "unsupported_reply_to");
  }
  if (!caps.supportsCcBcc && ((request.cc?.length ?? 0) > 0 || (request.bcc?.length ?? 0) > 0)) {
    throw new EmailValidationError("provider does not support cc/bcc", "unsupported_cc_bcc");
  }
  if (!caps.supportsTemplates && request.templateRef) {
    throw new EmailValidationError("provider does not support templates", "unsupported_templates");
  }
  if (!caps.supportsScheduling && request.scheduledAt) {
    throw new EmailValidationError("provider does not support scheduling", "unsupported_scheduling");
  }
  if (!caps.supportsMetadata && request.metadata && Object.keys(request.metadata).length > 0) {
    throw new EmailValidationError("provider does not support metadata", "unsupported_metadata");
  }
  if (!caps.supportsTags && request.tags && request.tags.length > 0) {
    throw new EmailValidationError("provider does not support tags", "unsupported_tags");
  }
  if (!caps.supportsCustomHeaders && request.headers && Object.keys(request.headers).length > 0) {
    throw new EmailValidationError("provider does not support custom headers", "unsupported_headers");
  }
  if (!caps.supportsInlineAttachments && request.attachments?.some((item) => item.inline)) {
    throw new EmailValidationError("provider does not support inline attachments", "unsupported_inline_attachments");
  }
}
