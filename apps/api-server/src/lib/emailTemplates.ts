import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { emailTemplatesTable } from "@workspace/db/schema";

export const EMAIL_TEMPLATE_TYPES = ["invitation", "email_verification", "password_reset"] as const;
export type EmailTemplateType = (typeof EMAIL_TEMPLATE_TYPES)[number];

const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g;

export const TEMPLATE_TOKEN_ALLOWLIST: Record<EmailTemplateType, readonly string[]> = {
  invitation: [
    "app_name",
    "full_name",
    "invitee_email",
    "invitee_name",
    "inviter_name",
    "organization_name",
    "invitation_url",
    "expiration_datetime",
    "expires_at",
  ],
  email_verification: ["app_name", "full_name", "organization_name", "verification_url", "expiration_datetime"],
  password_reset: ["app_name", "full_name", "organization_name", "password_reset_url", "expiration_datetime"],
};

export const TEMPLATE_SAMPLE_CONTEXT: Record<EmailTemplateType, Record<string, string>> = {
  invitation: {
    app_name: "Ayni",
    full_name: "Taylor Rivera",
    invitee_email: "taylor@example.com",
    invitee_name: "Taylor Rivera",
    inviter_name: "Morgan Admin",
    organization_name: "Acme Org",
    invitation_url: "https://admin.example.com/invitations/sample-token/accept",
    expiration_datetime: "2030-04-10T00:00:00.000Z",
    expires_at: "2030-04-10T00:00:00.000Z",
  },
  email_verification: {
    app_name: "Ayni",
    full_name: "Taylor Rivera",
    organization_name: "Acme Org",
    verification_url: "https://admin.example.com/verify-email?token=sample",
    expiration_datetime: "2030-04-10T00:00:00.000Z",
  },
  password_reset: {
    app_name: "Ayni",
    full_name: "Taylor Rivera",
    organization_name: "Acme Org",
    password_reset_url: "https://admin.example.com/reset-password?token=sample",
    expiration_datetime: "2030-04-10T00:00:00.000Z",
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function extractTemplateTokens(input: string): string[] {
  return [...input.matchAll(TOKEN_PATTERN)].map((match) => match[1] ?? "").filter(Boolean);
}

export function validateTemplateTokens(type: EmailTemplateType, templates: { subjectTemplate: string; htmlTemplate: string; textTemplate?: string | null }) {
  const allowed = new Set(TEMPLATE_TOKEN_ALLOWLIST[type]);
  const unsupported = new Set<string>();
  for (const value of [templates.subjectTemplate, templates.htmlTemplate, templates.textTemplate ?? ""]) {
    for (const token of extractTemplateTokens(value)) {
      if (!allowed.has(token)) unsupported.add(token);
    }
  }
  return Array.from(unsupported).sort();
}

export function renderTemplatedString(template: string, context: Record<string, string>, opts: { escapeValues: boolean; allowlist: readonly string[] }) {
  const allowed = new Set(opts.allowlist);
  return template.replace(TOKEN_PATTERN, (match, tokenName: string) => {
    if (!allowed.has(tokenName)) return match;
    const value = context[tokenName] ?? "";
    return opts.escapeValues ? escapeHtml(value) : value;
  });
}

export async function resolveEmailTemplate(appId: string, templateType: EmailTemplateType) {
  const appTemplate = await db.query.emailTemplatesTable.findFirst({
    where: and(
      eq(emailTemplatesTable.appId, appId),
      eq(emailTemplatesTable.templateType, templateType),
      eq(emailTemplatesTable.isActive, true),
    ),
  });
  if (appTemplate) {
    return { template: appTemplate, source: "app" as const };
  }

  const platformDefault = await db.query.emailTemplatesTable.findFirst({
    where: and(
      isNull(emailTemplatesTable.appId),
      eq(emailTemplatesTable.templateType, templateType),
      eq(emailTemplatesTable.isActive, true),
    ),
  });

  return { template: platformDefault ?? null, source: "platform" as const };
}
