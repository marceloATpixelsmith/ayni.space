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
  if (!request.subject && request.templateRef === undefined) {
    throw new EmailValidationError("subject or templateRef is required", "missing_subject_or_template");
  }
  if (request.templateRef === undefined && !request.textBody && !request.htmlBody) {
    throw new EmailValidationError("textBody or htmlBody is required when templateRef is absent", "missing_body");
  }
  if (request.scheduledAt) {
    const scheduledAtDate = new Date(request.scheduledAt);
    if (Number.isNaN(scheduledAtDate.getTime())) {
      throw new EmailValidationError("scheduledAt must be a valid ISO datetime", "invalid_scheduled_at");
    }
    if (scheduledAtDate.getTime() <= Date.now()) {
      throw new EmailValidationError("scheduledAt must be in the future", "invalid_scheduling_window");
    }
  }
  if (request.templateParams !== undefined) {
    if (
      request.templateParams === null ||
      Array.isArray(request.templateParams) ||
      typeof request.templateParams !== "object"
    ) {
      throw new EmailValidationError("templateParams must be an object", "invalid_template_params_shape");
    }
  }
  if (request.attachments !== undefined) {
    if (!Array.isArray(request.attachments)) {
      throw new EmailValidationError("attachments must be an array", "invalid_attachments_shape");
    }
    for (const attachment of request.attachments) {
      if (!attachment || typeof attachment !== "object") {
        throw new EmailValidationError("attachment must be an object", "invalid_attachment");
      }
      if (!attachment.filename || typeof attachment.filename !== "string") {
        throw new EmailValidationError("attachment filename is required", "invalid_attachment_filename");
      }
      if (!attachment.contentBase64 || typeof attachment.contentBase64 !== "string") {
        throw new EmailValidationError("attachment contentBase64 is required", "invalid_attachment_content");
      }
      if (attachment.inline && (!attachment.contentId || typeof attachment.contentId !== "string")) {
        throw new EmailValidationError("inline attachment requires contentId", "invalid_inline_attachment");
      }
    }
  }

  const caps = PROVIDER_CAPABILITIES[provider];
  if (!caps.supportsReplyTo && request.replyTo) {
    throw new EmailValidationError("provider does not support reply-to", "unsupported_reply_to");
  }
  if (!caps.supportsCcBcc && ((request.cc?.length ?? 0) > 0 || (request.bcc?.length ?? 0) > 0)) {
    throw new EmailValidationError("provider does not support cc/bcc", "unsupported_cc_bcc");
  }
  if (!caps.supportsTemplates && request.templateRef !== undefined) {
    throw new EmailValidationError("provider does not support templates", "unsupported_templates");
  }
  if (request.templateRef !== undefined) {
    if (provider === "brevo") {
      if (typeof request.templateRef !== "number" || !Number.isFinite(request.templateRef) || Number.isNaN(request.templateRef)) {
        throw new EmailValidationError("brevo templateRef must be a finite number", "invalid_template_ref");
      }
    } else if (typeof request.templateRef !== "string" || request.templateRef.trim().length === 0) {
      throw new EmailValidationError("templateRef must be a non-empty string for this provider", "invalid_template_ref");
    }
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
