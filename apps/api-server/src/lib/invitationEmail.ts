import { randomUUID } from "node:crypto";
import { type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { appsTable, outboundEmailLogsTable, organizationsTable, usersTable } from "@workspace/db/schema";

export const INVITATION_TEMPLATE_TOKENS = [
  "invitee_email",
  "invitee_name",
  "inviter_name",
  "app_name",
  "organization_name",
  "invitation_url",
  "expires_at",
] as const;

type InvitationTokenKey = (typeof INVITATION_TEMPLATE_TOKENS)[number];

type InvitationTemplateContext = Record<InvitationTokenKey, string>;

const INVITATION_TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function deriveInviteeName(input: { firstName?: string | null; lastName?: string | null }): string {
  const first = input.firstName?.trim() ?? "";
  const last = input.lastName?.trim() ?? "";
  return [first, last].filter(Boolean).join(" ").trim();
}

export function renderInvitationTemplate(template: string, context: InvitationTemplateContext, options: { escapeValues: boolean }) {
  return template.replace(INVITATION_TOKEN_PATTERN, (match, tokenName: string) => {
    if (!INVITATION_TEMPLATE_TOKENS.includes(tokenName as InvitationTokenKey)) {
      return match;
    }
    const value = context[tokenName as InvitationTokenKey] ?? "";
    return options.escapeValues ? escapeHtml(value) : value;
  });
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

function resolveLane1BaseUrl(req: Request): string {
  return resolveInvitationBaseUrl(req);
}

function resolveLane1Provider(): "brevo" {
  const configured = process.env["PLATFORM_TRANSACTIONAL_EMAIL_PROVIDER"] ?? "brevo";
  if (configured !== "brevo") {
    throw new Error(`Unsupported PLATFORM_TRANSACTIONAL_EMAIL_PROVIDER: ${configured}`);
  }
  return "brevo";
}

function resolveLane1ProviderApiKey(provider: "brevo"): string {
  if (provider === "brevo") {
    const value = process.env["PLATFORM_BREVO_API_KEY"];
    if (!value && process.env["NODE_ENV"] !== "production") {
      return "test-platform-brevo-key";
    }
    if (!value) {
      throw new Error("PLATFORM_BREVO_API_KEY is required for lane1 invitation email sending");
    }
    return value;
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

export class InvitationEmailConfigError extends Error {}

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

  if (!app.transactionalFromEmail) {
    throw new InvitationEmailConfigError("Missing app transactional_from_email configuration");
  }
  if (!app.invitationEmailSubject) {
    throw new InvitationEmailConfigError("Missing app invitation_email_subject configuration");
  }
  if (!app.invitationEmailHtml) {
    throw new InvitationEmailConfigError("Missing app invitation_email_html configuration");
  }

  const invitationUrl = `${resolveInvitationBaseUrl(params.req)}/invitations/${params.invitationToken}/accept`;

  const tokenContext: InvitationTemplateContext = {
    invitee_email: params.inviteeEmail,
    invitee_name: deriveInviteeName({ firstName: params.inviteeFirstName, lastName: params.inviteeLastName }),
    inviter_name: inviter?.name ?? inviter?.email ?? "",
    app_name: app.name,
    organization_name: org.name,
    invitation_url: invitationUrl,
    expires_at: params.invitationExpiresAt.toISOString(),
  };

  const renderedSubject = renderInvitationTemplate(app.invitationEmailSubject, tokenContext, { escapeValues: false });
  const renderedHtml = renderInvitationTemplate(app.invitationEmailHtml, tokenContext, { escapeValues: true });

  const provider = resolveLane1Provider();
  const correlationId = randomUUID();
  const logId = randomUUID();

  const request: Lane1SendRequest = {
    orgId: params.orgId,
    appId: params.appId,
    actorUserId: params.actorUserId,
    correlationId,
    fromEmail: app.transactionalFromEmail,
    fromName: app.transactionalFromName ?? undefined,
    replyTo: app.transactionalReplyToEmail ? { email: app.transactionalReplyToEmail } : undefined,
    to: [{
      email: params.inviteeEmail,
      name: deriveInviteeName({ firstName: params.inviteeFirstName, lastName: params.inviteeLastName }) || undefined,
    }],
    subject: renderedSubject,
    htmlBody: renderedHtml,
    metadata: {
      invitation_id: params.invitationId,
      email_kind: "invitation",
      lane: "lane1",
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
    requestedSubject: renderedSubject,
    requestedFrom: app.transactionalFromEmail,
    requestedTo: [params.inviteeEmail],
    requestedTemplateReference: "app.invitation_email_html",
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

  try {
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
  } catch (error) {
    console.error("[lane1-auth-verification-email] failed to update outbound log", { logId, error: error instanceof Error ? error.message : String(error) });
  }

  if (result.status === "failed" || result.status === "rejected") {
    throw new Error(result.error?.message ?? "Invitation email send failed");
  }

  return { logId, correlationId, provider, result };
}

export class AuthVerificationEmailConfigError extends Error {}

export async function sendLane1AuthVerificationEmail(params: {
  req: Request;
  appId: string;
  appSlug: string;
  userId: string;
  userEmail: string;
  verificationToken: string;
}) {
  const app = await db.query.appsTable.findFirst({ where: and(eq(appsTable.id, params.appId), eq(appsTable.isActive, true)) });
  if (!app) {
    throw new AuthVerificationEmailConfigError("App context for auth verification email was not found");
  }
  if (!app.transactionalFromEmail) {
    throw new AuthVerificationEmailConfigError("Missing app transactional_from_email configuration");
  }

  const provider = resolveLane1Provider();
  const correlationId = randomUUID();
  const logId = randomUUID();
  const query = new URLSearchParams({
    token: params.verificationToken,
    appSlug: params.appSlug,
  });
  const verificationUrl = `${resolveLane1BaseUrl(params.req)}/verify-email?${query.toString()}`;
  const subject = `Verify your email for ${app.name}`;
  const htmlBody = `<p>Please verify your email to continue.</p><p><a href="${escapeHtml(verificationUrl)}">Verify email</a></p>`;
  const request: Lane1SendRequest = {
    orgId: "platform",
    appId: params.appId,
    actorUserId: params.userId,
    correlationId,
    fromEmail: app.transactionalFromEmail,
    fromName: app.transactionalFromName ?? undefined,
    replyTo: app.transactionalReplyToEmail ? { email: app.transactionalReplyToEmail } : undefined,
    to: [{ email: params.userEmail }],
    subject,
    htmlBody,
    metadata: {
      email_kind: "email_verification",
      lane: "lane1",
    },
  };

  await db.insert(outboundEmailLogsTable).values({
    id: logId,
    lane: "lane1",
    orgId: null,
    appId: params.appId,
    provider,
    providerConnectionId: null,
    correlationId,
    actorUserId: params.userId,
    requestedPayloadSnapshot: sanitizeSnapshot(request),
    requestedSubject: subject,
    requestedFrom: app.transactionalFromEmail,
    requestedTo: [params.userEmail],
    requestedTemplateReference: "system.email_verification_default",
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

  try {
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
  } catch (error) {
    console.error("[lane1-auth-verification-email] failed to update outbound log", { logId, error: error instanceof Error ? error.message : String(error) });
  }

  if (result.status === "failed" || result.status === "rejected") {
    throw new Error(result.error?.message ?? "Verification email send failed");
  }

  return { logId, correlationId, provider, result };
}
