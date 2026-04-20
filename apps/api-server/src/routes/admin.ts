import { Router, type IRouter } from "express";
import {
  db,
  organizationsTable,
  usersTable,
  appsTable,
  auditLogsTable,
  featureFlagsTable,
  orgAppAccessTable,
} from "@workspace/db";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { writeAuditLog } from "../lib/audit.js";
import { EMAIL_TEMPLATE_TYPES, resolveEmailTemplate, TEMPLATE_SAMPLE_CONTEXT, TEMPLATE_TOKEN_ALLOWLIST, validateTemplateTokens, renderTemplatedString, type EmailTemplateType } from "../lib/emailTemplates.js";
import { emailTemplatesTable } from "@workspace/db/schema";
import { requireSuperAdmin } from "../middlewares/requireAuth.js";
import { getAllSettings, updateAppSetting, updateSetting } from "../lib/settings.js";

const router: IRouter = Router();

router.use(requireSuperAdmin);

function asSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function parsePageNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(asSingleString(value) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}


// ── GET /admin/settings ──────────────────────────────────────────────────────
router.get("/settings", async (_req, res) => {
  const { globalSettings, appSettings } = await getAllSettings();
  res.json({ globalSettings, appSettings });
});

router.put("/settings/global/:key", async (req, res) => {
  const key = asSingleString(req.params["key"]);
  const valueType = asSingleString(req.body?.valueType) as "string" | "number" | "boolean" | "json" | undefined;
  const value = req.body?.value;
  const description = typeof req.body?.description === "string" ? req.body.description : null;
  if (!key || !valueType) {
    res.status(400).json({ error: "key and valueType are required" });
    return;
  }
  const saved = await updateSetting({
    key,
    value,
    valueType,
    description,
    updatedBy: req.session.userId ?? null,
  });
  await writeAuditLog({ req, userId: req.session.userId, action: "admin.setting.global.upsert", resourceType: "setting", resourceId: saved?.id, metadata: { key, valueType } });
  res.json({ setting: saved });
});

router.put("/settings/apps/:appId/:key", async (req, res) => {
  const appId = asSingleString(req.params["appId"]);
  const key = asSingleString(req.params["key"]);
  const valueType = asSingleString(req.body?.valueType) as "string" | "number" | "boolean" | "json" | undefined;
  const value = req.body?.value;
  const description = typeof req.body?.description === "string" ? req.body.description : null;
  if (!appId || !key || !valueType) {
    res.status(400).json({ error: "appId, key and valueType are required" });
    return;
  }
  const saved = await updateAppSetting({
    appId,
    key,
    value,
    valueType,
    description,
    updatedBy: req.session.userId ?? null,
  });
  await writeAuditLog({ req, userId: req.session.userId, action: "admin.setting.app.upsert", resourceType: "app_setting", resourceId: saved?.id, metadata: { appId, key, valueType } });
  res.json({ setting: saved });
});

// ── GET /admin/stats ──────────────────────────────────────────────────────────
router.get("/stats", async (_req, res) => {
  const [[totalUsers], [totalOrgs], [totalApps]] = await Promise.all([
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(organizationsTable),
    db.select({ count: count() }).from(appsTable),
  ]);

  res.json({
    totalUsers: Number(totalUsers?.count ?? 0),
    totalOrgs: Number(totalOrgs?.count ?? 0),
    totalSubscriptions: 0,
    activeSubscriptions: 0,
    totalApps: Number(totalApps?.count ?? 0),
  });
});

// ── GET /admin/organizations ──────────────────────────────────────────────────
router.get("/organizations", async (req, res) => {
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);

  const [orgs, [totalRow]] = await Promise.all([
    db.query.organizationsTable.findMany({ orderBy: desc(organizationsTable.createdAt), limit, offset }),
    db.select({ count: count() }).from(organizationsTable),
  ]);

  res.json({
    organizations: orgs.map((o: any) => ({ ...o, memberCount: 0 })),
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  });
});

// ── GET /admin/users ──────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);

  const [users, [totalRow]] = await Promise.all([
    db.query.usersTable.findMany({ orderBy: desc(usersTable.createdAt), limit, offset }),
    db.select({ count: count() }).from(usersTable),
  ]);

  res.json({
    users: users.map((u: any) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      isSuperAdmin: u.isSuperAdmin,
      createdAt: u.createdAt,
    })),
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  });
});

// ── GET /admin/audit-logs ─────────────────────────────────────────────────────
router.get("/audit-logs", async (req, res) => {
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);

  const [logs, [totalRow]] = await Promise.all([
    db.query.auditLogsTable.findMany({ orderBy: desc(auditLogsTable.createdAt), limit, offset }),
    db.select({ count: count() }).from(auditLogsTable),
  ]);

  res.json({ logs, total: Number(totalRow?.count ?? 0), limit, offset });
});

// ── GET /admin/feature-flags ──────────────────────────────────────────────────
router.get("/feature-flags", async (_req, res) => {
  const flags = await db.query.featureFlagsTable.findMany();
  res.json(flags);
});

// ── POST /admin/feature-flags ─────────────────────────────────────────────────
router.post("/feature-flags", async (req, res) => {
  const { key, value, orgId, description } = req.body as {
    key: string;
    value: boolean;
    orgId?: string;
    description?: string;
  };

  if (!key || value === undefined) {
    res.status(400).json({ error: "key and value are required" });
    return;
  }

  const [flag] = await db
    .insert(featureFlagsTable)
    .values({
      id: randomUUID(),
      key,
      value,
      orgId: orgId ?? null,
      description: description ?? null,
    })
    .onConflictDoUpdate({
      target: [featureFlagsTable.key],
      set: { value, description: description ?? undefined },
    })
    .returning();

  writeAuditLog({
    userId: req.session.userId,
    action: "feature_flag.set",
    resourceType: "feature_flag",
    resourceId: flag.id,
    metadata: { key, value },
    req,
  });

  res.json(flag);
});

// ── PUT /admin/organizations/:orgId/apps/:appId ───────────────────────────────
router.put("/organizations/:orgId/apps/:appId", async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const appId = asSingleString(req.params["appId"]);
  const { enabled } = req.body as { enabled: boolean };

  if (!orgId || !appId) {
    res.status(400).json({ error: "orgId and appId route params are required" });
    return;
  }

  const existing = await db.query.orgAppAccessTable.findFirst({
    where: (t: any, { and, eq }: any) => and(eq(t.orgId, orgId), eq(t.appId, appId)),
  });

  if (existing) {
    await db
      .update(orgAppAccessTable)
      .set({ enabled })
      .where(eq(orgAppAccessTable.id, existing.id));
  } else {
    await db.insert(orgAppAccessTable).values({
      id: randomUUID(),
      orgId,
      appId,
      enabled,
    });
  }

  writeAuditLog({
    orgId,
    userId: req.session.userId,
    action: enabled ? "org.app.enabled" : "org.app.disabled",
    resourceType: "app_access",
    resourceId: appId,
    req,
  });

  res.json({ success: true, message: `App access ${enabled ? "enabled" : "disabled"}` });
});


router.get("/email-template-types", (_req, res) => {
  res.json(EMAIL_TEMPLATE_TYPES.map((templateType) => ({
    templateType,
    tokens: TEMPLATE_TOKEN_ALLOWLIST[templateType],
    sampleData: TEMPLATE_SAMPLE_CONTEXT[templateType],
  })));
});

router.get("/apps/:appId/email-templates", async (req, res) => {
  const appId = asSingleString(req.params["appId"]);
  if (!appId) {
    res.status(400).json({ error: "appId is required" });
    return;
  }

  const app = await db.query.appsTable.findFirst({ where: eq(appsTable.id, appId) });
  if (!app) {
    res.status(404).json({ error: "App not found" });
    return;
  }

  const templates = await Promise.all(EMAIL_TEMPLATE_TYPES.map(async (templateType) => {
    const resolved = await resolveEmailTemplate(appId, templateType);
    const appOverride = await db.query.emailTemplatesTable.findFirst({
      where: and(eq(emailTemplatesTable.appId, appId), eq(emailTemplatesTable.templateType, templateType)),
    });

    return {
      templateType,
      source: resolved.source,
      appOverrideActive: appOverride?.isActive ?? false,
      template: resolved.template,
      appOverride,
      tokens: TEMPLATE_TOKEN_ALLOWLIST[templateType],
      sampleData: TEMPLATE_SAMPLE_CONTEXT[templateType],
    };
  }));

  res.json({ app: { id: app.id, name: app.name, slug: app.slug }, templates });
});

router.put("/apps/:appId/email-templates/:templateType", async (req, res) => {
  const appId = asSingleString(req.params["appId"]);
  const templateTypeRaw = asSingleString(req.params["templateType"]);
  if (!appId || !templateTypeRaw) {
    res.status(400).json({ error: "appId and templateType are required" });
    return;
  }
  if (!EMAIL_TEMPLATE_TYPES.includes(templateTypeRaw as EmailTemplateType)) {
    res.status(400).json({ error: "Unsupported template type" });
    return;
  }
  const templateType = templateTypeRaw as EmailTemplateType;
  const subjectTemplate = String(req.body?.subjectTemplate ?? "").trim();
  const htmlTemplate = String(req.body?.htmlTemplate ?? "").trim();
  const textTemplate = typeof req.body?.textTemplate === "string" ? req.body.textTemplate : null;

  if (!subjectTemplate || !htmlTemplate) {
    res.status(400).json({ error: "subjectTemplate and htmlTemplate are required" });
    return;
  }

  const unsupportedTokens = validateTemplateTokens(templateType, { subjectTemplate, htmlTemplate, textTemplate });
  if (unsupportedTokens.length) {
    res.status(400).json({ error: "Unsupported template tokens", unsupportedTokens });
    return;
  }

  const existing = await db.query.emailTemplatesTable.findFirst({
    where: and(eq(emailTemplatesTable.appId, appId), eq(emailTemplatesTable.templateType, templateType)),
  });

  let saved;
  if (existing) {
    const rows = await db.update(emailTemplatesTable)
      .set({ subjectTemplate, htmlTemplate, textTemplate, isActive: true, updatedAt: new Date() })
      .where(eq(emailTemplatesTable.id, existing.id))
      .returning();
    saved = rows[0] ?? null;
  } else {
    const rows = await db.insert(emailTemplatesTable)
      .values({ id: randomUUID(), appId, templateType, subjectTemplate, htmlTemplate, textTemplate, isActive: true })
      .returning();
    saved = rows[0] ?? null;
  }

  await writeAuditLog({
    req,
    userId: req.session.userId,
    action: "admin.email_template.upsert",
    resourceType: "email_template",
    resourceId: saved?.id,
    metadata: { appId, templateType },
  });

  res.json({ template: saved });
});

router.post("/apps/:appId/email-templates/:templateType/preview", async (req, res) => {
  const appId = asSingleString(req.params["appId"]);
  const templateTypeRaw = asSingleString(req.params["templateType"]);
  if (!appId || !templateTypeRaw || !EMAIL_TEMPLATE_TYPES.includes(templateTypeRaw as EmailTemplateType)) {
    res.status(400).json({ error: "Invalid appId/templateType" });
    return;
  }
  const templateType = templateTypeRaw as EmailTemplateType;
  const resolved = await resolveEmailTemplate(appId, templateType);
  const subjectTemplate = String(req.body?.subjectTemplate ?? resolved.template?.subjectTemplate ?? "");
  const htmlTemplate = String(req.body?.htmlTemplate ?? resolved.template?.htmlTemplate ?? "");
  const textTemplate = typeof req.body?.textTemplate === "string" ? req.body.textTemplate : (resolved.template?.textTemplate ?? "");
  const context = {
    ...TEMPLATE_SAMPLE_CONTEXT[templateType],
    ...(req.body?.sampleData && typeof req.body.sampleData === "object" ? req.body.sampleData : {}),
  } as Record<string, string>;
  const unsupportedTokens = validateTemplateTokens(templateType, { subjectTemplate, htmlTemplate, textTemplate });
  if (unsupportedTokens.length) {
    res.status(400).json({ error: "Unsupported template tokens", unsupportedTokens });
    return;
  }
  res.json({
    subject: renderTemplatedString(subjectTemplate, context, { escapeValues: false, allowlist: TEMPLATE_TOKEN_ALLOWLIST[templateType] }),
    html: renderTemplatedString(htmlTemplate, context, { escapeValues: true, allowlist: TEMPLATE_TOKEN_ALLOWLIST[templateType] }),
    text: renderTemplatedString(textTemplate, context, { escapeValues: false, allowlist: TEMPLATE_TOKEN_ALLOWLIST[templateType] }),
    sampleData: context,
  });
});

router.delete("/apps/:appId/email-templates/:templateType", async (req, res) => {
  const appId = asSingleString(req.params["appId"]);
  const templateTypeRaw = asSingleString(req.params["templateType"]);
  if (!appId || !templateTypeRaw || !EMAIL_TEMPLATE_TYPES.includes(templateTypeRaw as EmailTemplateType)) {
    res.status(400).json({ error: "Invalid appId/templateType" });
    return;
  }

  const templateType = templateTypeRaw as EmailTemplateType;
  const existing = await db.query.emailTemplatesTable.findFirst({
    where: and(eq(emailTemplatesTable.appId, appId), eq(emailTemplatesTable.templateType, templateType)),
  });
  if (!existing) {
    res.status(404).json({ error: "App override template not found" });
    return;
  }

  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, existing.id));
  await writeAuditLog({
    req,
    userId: req.session.userId,
    action: "admin.email_template.delete",
    resourceType: "email_template",
    resourceId: existing.id,
    metadata: { appId, templateType },
  });

  const fallback = await db.query.emailTemplatesTable.findFirst({
    where: and(isNull(emailTemplatesTable.appId), eq(emailTemplatesTable.templateType, templateType), eq(emailTemplatesTable.isActive, true)),
  });
  res.json({ success: true, fallbackTemplate: fallback });
});

export default router;
