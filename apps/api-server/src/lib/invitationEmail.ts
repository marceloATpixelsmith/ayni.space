import { randomUUID } from "node:crypto";
import { type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { appsTable, outboundEmailLogsTable, organizationsTable, usersTable } from "@workspace/db/schema";
import { EMAIL_TEMPLATE_TYPES, renderTemplatedString, resolveEmailTemplate, TEMPLATE_TOKEN_ALLOWLIST, type EmailTemplateType } from "./emailTemplates.js";

export const INVITATION_TEMPLATE_TOKENS = TEMPLATE_TOKEN_ALLOWLIST.invitation;

type Lane1SendRequest = {
  orgId: string;
  appId: string;
  actorUserId?: string;
  correlationId: string;
  fromEmail: string;
  fromName?: string;
  replyTo?: EmailAddress;
  to: EmailAddress[];
  subject: string;
  htmlBody: string;
  textBody?: string;
  metadata: Record<string, string>;
};

type EmailAddress = { email: string; name?: string };

type Lane1SendResult = {
  status: "accepted" | "queued" | "rejected" | "failed";
  provider: "brevo";
  deliveryState: "accepted" | "scheduled" | "rejected" | "failed";
  providerMessageId?: string;
  providerRequestId?: string;
  error?: { code: string; message: string };
  rawResponseSnapshot?: Record<string, unknown>;
};

export function deriveInviteeName(input: { firstName?: string | null; lastName?: string | null }): string {
  const first = input.firstName?.trim() ?? "";
  const last = input.lastName?.trim() ?? "";
  return [first, last].filter(Boolean).join(" ").trim();
}

export function renderInvitationTemplate(template: string, context: Record<string, string>, options: { escapeValues: boolean }) {
  return renderTemplatedString(template, context, { escapeValues: options.escapeValues, allowlist: TEMPLATE_TOKEN_ALLOWLIST.invitation });
}

function resolveInvitationBaseUrl(req: Request): string {
  const headers = [req.headers.origin, req.headers.referer].filter((v): v is string => typeof v === "string");
  const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const candidate of [...headers, ...allowedOrigins]) {
    try {
      const parsed = new URL(candidate);
      if (allowedOrigins.includes(parsed.origin)) {
        return parsed.origin;
      }
    } catch {
      // ignore malformed origin/referer
    }
  }

  return "http://localhost:5173";
}

function resolveLane1Provider(): "brevo" {
  const configured = process.env["PLATFORM_TRANSACTIONAL_EMAIL_PROVIDER"] ?? "brevo";
  if (configured !== "brevo") {
    throw new Error(`Unsupported PLATFORM_TRANSACTIONAL_EMAIL_PROVIDER: ${configured}`);
  }
  return "brevo";
}

function resolveLane1ProviderApiKey(provider: "brevo"): string {
  const value = process.env["PLATFORM_BREVO_API_KEY"];
  if (!value && process.env["NODE_ENV"] !== "production") {
    return "test-platform-brevo-key";
  }
  if (!value) {
    throw new Error(`PLATFORM_BREVO_API_KEY is required for lane1 ${provider} email sending`);
  }
  return value;
}

export class InvitationEmailConfigError extends Error {}
export class AuthVerificationEmailConfigError extends Error {}
export class PasswordResetEmailConfigError extends Error {}

function sanitizeSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function sendViaPlatformBrevo(request: Lane1SendRequest, apiKey: string): Promise<Lane1SendResult> {
  if (process.env["NODE_ENV"] !== "production" && process.env["PLATFORM_BREVO_API_KEY"] === undefined) {
    return {
      status: "accepted",
      provider: "brevo",
      deliveryState: "accepted",
      providerMessageId: "test-message-id",
      rawResponseSnapshot: { simulated: true },
    };
  }
  const response = await fetch(`${process.env["BREVO_API_BASE_URL"] ?? "https://api.brevo.com"}/v3/smtp/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: { email: request.fromEmail, name: request.fromName },
      to: request.to,
      replyTo: request.replyTo,
      subject: request.subject,
      htmlContent: request.htmlBody,
      textContent: request.textBody,
      headers: {
        "x-ayni-correlation-id": request.correlationId,
      },
    }),
  });
  const raw = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return {
      status: "failed",
      provider: "brevo",
      deliveryState: "failed",
      error: {
        code: `brevo_${response.status}`,
        message: String(raw["message"] ?? "Brevo send failed"),
      },
      rawResponseSnapshot: sanitizeSnapshot(raw),
    };
  }
  return {
    status: "accepted",
    provider: "brevo",
    deliveryState: "accepted",
    providerMessageId: String(raw["messageId"] ?? ""),
    rawResponseSnapshot: sanitizeSnapshot(raw),
  };
}

async function sendLane1TemplatedEmail(params: {
  req: Request;
  appId: string;
  orgId: string | null;
  actorUserId: string;
  recipientEmail: string;
  recipientName?: string;
  templateType: EmailTemplateType;
  templateContext: Record<string, string>;
  requestedTemplateReference: string;
  metadata: Record<string, string>;
}) {
  const app = await db.query.appsTable.findFirst({ where: and(eq(appsTable.id, params.appId), eq(appsTable.isActive, true)) });
  if (!app) {
    throw new InvitationEmailConfigError("App context for lane1 email was not found");
  }

  if (!app.transactionalFromEmail) {
    throw new InvitationEmailConfigError("Missing app transactional_from_email configuration");
  }

  const { template, source } = await resolveEmailTemplate(params.appId, params.templateType);
  if (!template) {
    throw new InvitationEmailConfigError(`Missing ${params.templateType} email template configuration`);
  }

  const subject = renderTemplatedString(template.subjectTemplate, params.templateContext, {
    escapeValues: false,
    allowlist: TEMPLATE_TOKEN_ALLOWLIST[params.templateType],
  });
  const htmlBody = renderTemplatedString(template.htmlTemplate, params.templateContext, {
    escapeValues: true,
    allowlist: TEMPLATE_TOKEN_ALLOWLIST[params.templateType],
  });
  const textBody = template.textTemplate
    ? renderTemplatedString(template.textTemplate, params.templateContext, {
      escapeValues: false,
      allowlist: TEMPLATE_TOKEN_ALLOWLIST[params.templateType],
    })
    : undefined;

  const provider = resolveLane1Provider();
  const correlationId = randomUUID();
  const logId = randomUUID();

  const request: Lane1SendRequest = {
    orgId: params.orgId ?? "platform",
    appId: params.appId,
    actorUserId: params.actorUserId,
    correlationId,
    fromEmail: app.transactionalFromEmail,
    fromName: app.transactionalFromName ?? undefined,
    replyTo: app.transactionalReplyToEmail ? { email: app.transactionalReplyToEmail } : undefined,
    to: [{ email: params.recipientEmail, name: params.recipientName || undefined }],
    subject,
    htmlBody,
    textBody,
    metadata: {
      lane: "lane1",
      template_type: params.templateType,
      ...params.metadata,
    },
  };

  await db.insert(outboundEmailLogsTable).values({
    id: logId,
    lane: "lane1",
    orgId: params.orgId,
    appId: params.appId,
    provider,
    providerConnectionId: null,
    correlationId,
    actorUserId: params.actorUserId,
    requestedPayloadSnapshot: sanitizeSnapshot(request),
    requestedSubject: subject,
    requestedFrom: app.transactionalFromEmail,
    requestedTo: [params.recipientEmail],
    requestedTemplateReference: source === "app" ? `app.${params.templateType}` : `platform.${params.templateType}`,
    attemptResult: "failed",
    deliveryState: "pending",
  });

  let result: Lane1SendResult;
  try {
    result = await sendViaPlatformBrevo(request, resolveLane1ProviderApiKey(provider));
  } catch (error) {
    result = {
      status: "failed",
      provider,
      deliveryState: "failed",
      error: {
        code: "provider_request_exception",
        message: error instanceof Error ? error.message : "provider request failed",
      },
    };
  }

  await db
    .update(outboundEmailLogsTable)
    .set({
      attemptResult: result.status,
      deliveryState: result.deliveryState,
      providerMessageId: result.providerMessageId ?? null,
      providerRequestId: result.providerRequestId ?? null,
      normalizedErrorCode: result.error?.code ?? null,
      normalizedErrorMessage: result.error?.message ?? null,
      providerResponseSnapshot: sanitizeSnapshot(result.rawResponseSnapshot ?? {}),
      acceptedAt: result.status === "accepted" || result.status === "queued" ? new Date() : null,
      failedAt: result.status === "failed" || result.status === "rejected" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(outboundEmailLogsTable.id, logId));

  if (result.status === "failed" || result.status === "rejected") {
    throw new Error(result.error?.message ?? "Lane1 email send failed");
  }

  return { logId, correlationId, provider, result, requestedTemplateReference: params.requestedTemplateReference };
}

export async function sendLane1InvitationEmail(params: {
  req: Request;
  appId: string;
  orgId: string;
  invitationId: string;
  invitationToken: string;
  invitationExpiresAt: Date;
  inviteeEmail: string;
  inviteeFirstName?: string | null;
  inviteeLastName?: string | null;
  invitedByUserId: string;
  actorUserId: string;
}) {
  const app = await db.query.appsTable.findFirst({ where: and(eq(appsTable.id, params.appId), eq(appsTable.isActive, true)) });
  if (!app) {
    throw new InvitationEmailConfigError("App context for invitation email was not found");
  }
  const org = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, params.orgId) });
  if (!org) {
    throw new InvitationEmailConfigError("Organization context for invitation email was not found");
  }
  const inviter = await db.query.usersTable.findFirst({ where: eq(usersTable.id, params.invitedByUserId) });
  const fullName = deriveInviteeName({ firstName: params.inviteeFirstName, lastName: params.inviteeLastName });
  const invitationUrl = `${resolveInvitationBaseUrl(params.req)}/invitations/${params.invitationToken}/accept`;

  return sendLane1TemplatedEmail({
    req: params.req,
    appId: params.appId,
    orgId: params.orgId,
    actorUserId: params.actorUserId,
    recipientEmail: params.inviteeEmail,
    recipientName: fullName,
    templateType: EMAIL_TEMPLATE_TYPES[0],
    templateContext: {
      app_name: app.name,
      full_name: fullName,
      invitee_email: params.inviteeEmail,
      invitee_name: fullName,
      inviter_name: inviter?.name ?? inviter?.email ?? "",
      organization_name: org.name,
      invitation_url: invitationUrl,
      expiration_datetime: params.invitationExpiresAt.toISOString(),
      expires_at: params.invitationExpiresAt.toISOString(),
    },
    requestedTemplateReference: "app.invitation",
    metadata: {
      invitation_id: params.invitationId,
      email_kind: "invitation",
    },
  });
}

export async function sendLane1AuthVerificationEmail(params: {
  req: Request;
  appId: string;
  appSlug: string;
  userId: string;
  userEmail: string;
  userFullName?: string | null;
  verificationToken: string;
  expirationDateTime: string;
}) {
  const app = await db.query.appsTable.findFirst({ where: and(eq(appsTable.id, params.appId), eq(appsTable.isActive, true)) });
  if (!app) throw new AuthVerificationEmailConfigError("App context for auth verification email was not found");
  const query = new URLSearchParams({ token: params.verificationToken, appSlug: params.appSlug });
  const verificationUrl = `${resolveInvitationBaseUrl(params.req)}/verify-email?${query.toString()}`;

  return sendLane1TemplatedEmail({
    req: params.req,
    appId: params.appId,
    orgId: null,
    actorUserId: params.userId,
    recipientEmail: params.userEmail,
    recipientName: params.userFullName ?? undefined,
    templateType: "email_verification",
    templateContext: {
      app_name: app.name,
      full_name: params.userFullName?.trim() || params.userEmail,
      organization_name: "",
      verification_url: verificationUrl,
      expiration_datetime: params.expirationDateTime,
    },
    requestedTemplateReference: "app.email_verification",
    metadata: {
      email_kind: "email_verification",
    },
  });
}

export async function sendLane1PasswordResetEmail(params: {
  req: Request;
  appId: string;
  appSlug: string;
  userId: string;
  userEmail: string;
  userFullName?: string | null;
  resetToken: string;
  expirationDateTime: string;
}) {
  const app = await db.query.appsTable.findFirst({ where: and(eq(appsTable.id, params.appId), eq(appsTable.isActive, true)) });
  if (!app) throw new PasswordResetEmailConfigError("App context for password reset email was not found");
  const query = new URLSearchParams({ token: params.resetToken, appSlug: params.appSlug });
  const passwordResetUrl = `${resolveInvitationBaseUrl(params.req)}/reset-password?${query.toString()}`;

  return sendLane1TemplatedEmail({
    req: params.req,
    appId: params.appId,
    orgId: null,
    actorUserId: params.userId,
    recipientEmail: params.userEmail,
    recipientName: params.userFullName ?? undefined,
    templateType: "password_reset",
    templateContext: {
      app_name: app.name,
      full_name: params.userFullName?.trim() || params.userEmail,
      organization_name: "",
      password_reset_url: passwordResetUrl,
      expiration_datetime: params.expirationDateTime,
    },
    requestedTemplateReference: "app.password_reset",
    metadata: {
      email_kind: "password_reset",
    },
  });
}
