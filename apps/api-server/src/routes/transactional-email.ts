import { Router } from "express";
import { requireAuth, requireSuperAdmin } from "../middlewares/requireAuth.js";
import { requireOrgAccess, requireOrgAdmin } from "../middlewares/requireOrgAccess.js";
import { TransactionalEmailRepository } from "@workspace/transactional-email";
import { Lane2TransactionalEmailRuntime } from "@workspace/transactional-email";
import { encryptJson, type EmailProvider, type NormalizedDeliveryState } from "@workspace/transactional-email";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";

const router = Router();
const repository = new TransactionalEmailRepository();
const runtime = new Lane2TransactionalEmailRuntime(repository);

function validateMailchimpSignature(body: unknown, signature: string | undefined) {
  const secret = process.env["MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY"];
  if (!secret) return true;
  if (!signature) return false;
  const digest = createHmac("sha1", secret).update(JSON.stringify(body)).digest("base64");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

function validateBrevoSignature(body: unknown, signature: string | undefined) {
  const secret = process.env["BREVO_WEBHOOK_SECRET"];
  if (!secret) return true;
  if (!signature) return false;
  const digest = createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex");
  return timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

function asSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function parsePageNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(asSingleString(value) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value: unknown): Date | undefined {
  const raw = asSingleString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeEmailProvider(value: unknown): EmailProvider | undefined {
  const provider = asSingleString(value);
  if (provider === "brevo" || provider === "mailchimp_transactional") return provider;
  return undefined;
}

function normalizeDeliveryState(value: unknown): NormalizedDeliveryState | undefined {
  const state = asSingleString(value);
  if (!state) return undefined;
  const allowed: NormalizedDeliveryState[] = [
    "pending", "accepted", "scheduled", "sent", "delivered", "opened", "clicked", "bounced_soft", "bounced_hard", "deferred", "complained",
    "unsubscribed", "blocked", "rejected", "failed", "cancelled",
  ];
  return allowed.includes(state as NormalizedDeliveryState) ? (state as NormalizedDeliveryState) : undefined;
}

function getEncryptionKey() {
  const key = process.env["EMAIL_CREDENTIALS_ENCRYPTION_KEY"];
  if (!key) throw new Error("EMAIL_CREDENTIALS_ENCRYPTION_KEY is required");
  return key;
}

function sanitizeValidationError(error?: string) {
  if (!error) return undefined;
  return error.replace(/[A-Za-z0-9_\-]{20,}/g, "***redacted***");
}

async function getOrgConnectionOr404(orgId: string, connectionId: string) {
  const connection = await repository.findConnectionById(connectionId);
  if (!connection || connection.orgId !== orgId) return null;
  return connection;
}

router.post("/organizations/:orgId/transactional-email/send", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  if (!orgId) {
    res.status(400).json({ error: "Organization ID is required" });
    return;
  }

  try {
    const result = await runtime.send({
      ...(req.body ?? {}),
      orgId,
      actorUserId: req.session?.userId,
      correlationId: String(req.body?.correlationId ?? req.get("x-correlation-id") ?? `email-${Date.now()}`),
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "lane2 send failed" });
  }
});

router.post("/organizations/:orgId/transactional-email/connections", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  if (!orgId) {
    res.status(400).json({ error: "Organization ID is required" });
    return;
  }
  const provider = normalizeEmailProvider(req.body?.provider);
  const appId = asSingleString(req.body?.appId);
  const displayLabel = asSingleString(req.body?.displayLabel);
  const apiKey = asSingleString(req.body?.apiKey);

  if (!provider || !appId || !displayLabel || !apiKey) {
    res.status(400).json({ error: "provider, appId, displayLabel, and apiKey are required" });
    return;
  }

  try {
    const encryptedCredentials = encryptJson({ apiKey }, getEncryptionKey());
    const created = await repository.createConnection({
      id: randomUUID(),
      orgId,
      appId,
      provider,
      displayLabel,
      encryptedCredentials,
      credentialKeyVersion: "v1",
      defaultSenderEmail: asSingleString(req.body?.defaultSenderEmail) ?? null,
      defaultSenderName: asSingleString(req.body?.defaultSenderName) ?? null,
      defaultReplyTo: asSingleString(req.body?.defaultReplyTo) ?? null,
      deactivateOtherConnectionsForOrgApp: true,
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: "Failed to create provider connection" });
  }
});

router.get("/organizations/:orgId/transactional-email/connections", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  if (!orgId) {
    res.status(400).json({ error: "Organization ID is required" });
    return;
  }
  const provider = normalizeEmailProvider(req.query["provider"]);
  const appId = asSingleString(req.query["appId"]);
  const includeInactive = asSingleString(req.query["includeInactive"]) === "true";
  const connections = await repository.listConnections({ orgId, appId, provider, includeInactive });
  res.status(200).json({ connections });
});

router.patch("/organizations/:orgId/transactional-email/connections/:connectionId", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const connectionId = asSingleString(req.params["connectionId"]);
  if (!orgId || !connectionId) {
    res.status(400).json({ error: "Organization ID and connection ID are required" });
    return;
  }

  const existing = await getOrgConnectionOr404(orgId, connectionId);
  if (!existing) {
    res.status(404).json({ error: "Provider connection not found" });
    return;
  }

  const updated = await repository.updateConnectionNonSecret(connectionId, {
    displayLabel: asSingleString(req.body?.displayLabel),
    defaultSenderEmail: asSingleString(req.body?.defaultSenderEmail) ?? undefined,
    defaultSenderName: asSingleString(req.body?.defaultSenderName) ?? undefined,
    defaultReplyTo: asSingleString(req.body?.defaultReplyTo) ?? undefined,
  });
  res.status(200).json(updated);
});

router.post("/organizations/:orgId/transactional-email/connections/:connectionId/rotate-credential", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const connectionId = asSingleString(req.params["connectionId"]);
  const apiKey = asSingleString(req.body?.apiKey);
  if (!orgId || !connectionId || !apiKey) {
    res.status(400).json({ error: "Organization ID, connection ID, and apiKey are required" });
    return;
  }
  const existing = await getOrgConnectionOr404(orgId, connectionId);
  if (!existing) {
    res.status(404).json({ error: "Provider connection not found" });
    return;
  }

  const rotated = await repository.rotateConnectionCredential(connectionId, encryptJson({ apiKey }, getEncryptionKey()), "v1");
  res.status(200).json(rotated);
});

router.post("/organizations/:orgId/transactional-email/connections/:connectionId/deactivate", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const connectionId = asSingleString(req.params["connectionId"]);
  if (!orgId || !connectionId) {
    res.status(400).json({ error: "Organization ID and connection ID are required" });
    return;
  }
  const existing = await getOrgConnectionOr404(orgId, connectionId);
  if (!existing) {
    res.status(404).json({ error: "Provider connection not found" });
    return;
  }

  const deactivated = await repository.setConnectionActiveState(connectionId, false);
  res.status(200).json(deactivated);
});

router.post("/organizations/:orgId/transactional-email/connections/:connectionId/reactivate", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const connectionId = asSingleString(req.params["connectionId"]);
  if (!orgId || !connectionId) {
    res.status(400).json({ error: "Organization ID and connection ID are required" });
    return;
  }
  const existing = await getOrgConnectionOr404(orgId, connectionId);
  if (!existing) {
    res.status(404).json({ error: "Provider connection not found" });
    return;
  }

  const reactivated = await repository.setConnectionActiveState(connectionId, true);
  res.status(200).json(reactivated);
});

router.post("/organizations/:orgId/transactional-email/connections/:connectionId/validate", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const connectionId = asSingleString(req.params["connectionId"]);
  if (!orgId || !connectionId) {
    res.status(400).json({ error: "Organization ID and connection ID are required" });
    return;
  }
  const existing = await getOrgConnectionOr404(orgId, connectionId);
  if (!existing) {
    res.status(404).json({ error: "Provider connection not found" });
    return;
  }

  try {
    const validation = await runtime.validateConnection(connectionId);
    res.status(200).json({ ...validation, error: sanitizeValidationError(validation.error) });
  } catch (error) {
    res.status(400).json({ error: "connection validation failed" });
  }
});

router.get("/organizations/:orgId/transactional-email/logs", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  if (!orgId) {
    res.status(400).json({ error: "Organization ID is required" });
    return;
  }
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);
  const recipientFilter = asSingleString(req.query["recipient"]);

  const logs = await repository.listOutboundLogs({
    orgId,
    appId: asSingleString(req.query["appId"]),
    lane: "lane2",
    provider: normalizeEmailProvider(req.query["provider"]),
    providerConnectionId: asSingleString(req.query["connectionId"]),
    attemptResult: asSingleString(req.query["status"]) as "accepted" | "queued" | "rejected" | "failed" | undefined,
    deliveryState: normalizeDeliveryState(req.query["deliveryState"]),
    recipient: undefined,
    subject: asSingleString(req.query["subject"]),
    providerMessageId: asSingleString(req.query["providerMessageId"]),
    correlationId: asSingleString(req.query["correlationId"]),
    dateFrom: parseDate(req.query["dateFrom"]),
    dateTo: parseDate(req.query["dateTo"]),
    limit,
    offset,
  });

  const filtered = recipientFilter
    ? logs.filter((log: { requestedTo: unknown }) =>
      Array.isArray(log.requestedTo) &&
      log.requestedTo.some((recipient: unknown) => String(recipient).toLowerCase().includes(recipientFilter.toLowerCase())))
    : logs;
  res.status(200).json({ logs: filtered, limit, offset });
});

router.get("/organizations/:orgId/transactional-email/logs/:logId", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = req.params["orgId"];
  const logId = asSingleString(req.params["logId"]);
  if (!orgId || !logId) {
    res.status(400).json({ error: "Organization ID and log ID are required" });
    return;
  }
  const log = await repository.findOutboundLogById(logId);
  if (!log || log.orgId !== orgId) {
    res.status(404).json({ error: "Outbound log not found" });
    return;
  }
  res.status(200).json(log);
});

router.get("/organizations/:orgId/transactional-email/events", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  if (!orgId) {
    res.status(400).json({ error: "Organization ID is required" });
    return;
  }
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);

  const events = await repository.listEvents({
    orgId,
    provider: normalizeEmailProvider(req.query["provider"]),
    normalizedEventType: normalizeDeliveryState(req.query["eventType"]),
    providerMessageId: asSingleString(req.query["providerMessageId"]),
    recipient: asSingleString(req.query["recipient"]),
    linkedOutboundEmailLogId: asSingleString(req.query["logId"]),
    dateFrom: parseDate(req.query["dateFrom"]),
    dateTo: parseDate(req.query["dateTo"]),
    limit,
    offset,
  });

  const scoped = [];
  for (const event of events) {
    if (!event.linkedOutboundEmailLogId) continue;
    const log = await repository.findOutboundLogById(event.linkedOutboundEmailLogId);
    if (log?.orgId === orgId) scoped.push(event);
  }
  res.status(200).json({ events: scoped, limit, offset });
});

router.get("/organizations/:orgId/transactional-email/logs/:logId/events", requireAuth, requireOrgAdmin, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const logId = asSingleString(req.params["logId"]);
  if (!orgId || !logId) {
    res.status(400).json({ error: "Organization ID and log ID are required" });
    return;
  }
  const log = await repository.findOutboundLogById(logId);
  if (!log || log.orgId !== orgId) {
    res.status(404).json({ error: "Outbound log not found" });
    return;
  }
  const events = await repository.listEvents({
    linkedOutboundEmailLogId: logId,
    limit: Math.min(parsePageNumber(req.query["limit"], 50), 200),
    offset: parsePageNumber(req.query["offset"], 0),
  });
  res.status(200).json({ events });
});

router.get("/admin/transactional-email/logs", requireSuperAdmin, async (req, res) => {
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);
  const logs = await repository.listOutboundLogs({
    orgId: asSingleString(req.query["orgId"]),
    appId: asSingleString(req.query["appId"]),
    lane: "lane2",
    provider: normalizeEmailProvider(req.query["provider"]),
    providerConnectionId: asSingleString(req.query["connectionId"]),
    attemptResult: asSingleString(req.query["status"]) as "accepted" | "queued" | "rejected" | "failed" | undefined,
    deliveryState: normalizeDeliveryState(req.query["deliveryState"]),
    recipient: undefined,
    subject: asSingleString(req.query["subject"]),
    providerMessageId: asSingleString(req.query["providerMessageId"]),
    correlationId: asSingleString(req.query["correlationId"]),
    dateFrom: parseDate(req.query["dateFrom"]),
    dateTo: parseDate(req.query["dateTo"]),
    limit,
    offset,
  });
  res.status(200).json({ logs, limit, offset });
});

router.get("/admin/transactional-email/logs/:logId", requireSuperAdmin, async (req, res) => {
  const logId = asSingleString(req.params["logId"]);
  if (!logId) {
    res.status(400).json({ error: "Log ID is required" });
    return;
  }
  const log = await repository.findOutboundLogById(logId);
  if (!log) {
    res.status(404).json({ error: "Outbound log not found" });
    return;
  }
  res.status(200).json(log);
});

router.get("/admin/transactional-email/events", requireSuperAdmin, async (req, res) => {
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);
  const events = await repository.listEvents({
    provider: normalizeEmailProvider(req.query["provider"]),
    normalizedEventType: normalizeDeliveryState(req.query["eventType"]),
    providerMessageId: asSingleString(req.query["providerMessageId"]),
    recipient: asSingleString(req.query["recipient"]),
    linkedOutboundEmailLogId: asSingleString(req.query["logId"]),
    dateFrom: parseDate(req.query["dateFrom"]),
    dateTo: parseDate(req.query["dateTo"]),
    limit,
    offset,
  });
  res.status(200).json({ events, limit, offset });
});

router.get("/admin/transactional-email/connections", requireSuperAdmin, async (req, res) => {
  const orgId = asSingleString(req.query["orgId"]);
  if (!orgId) {
    res.status(400).json({ error: "orgId query parameter is required" });
    return;
  }
  const connections = await repository.listConnections({
    orgId,
    appId: asSingleString(req.query["appId"]),
    provider: normalizeEmailProvider(req.query["provider"]),
    includeInactive: asSingleString(req.query["includeInactive"]) === "true",
  });
  res.status(200).json({ connections });
});

router.post("/transactional-email/webhooks/brevo", async (req, res) => {
  const signature = req.get("x-brevo-signature");
  if (!validateBrevoSignature(req.body, signature ?? undefined)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }
  await runtime.ingestWebhook("brevo", req.body);
  res.status(202).json({ accepted: true });
});

router.post("/transactional-email/webhooks/mailchimp-transactional", async (req, res) => {
  const signature = req.get("x-mandrill-signature");
  if (!validateMailchimpSignature(req.body, signature ?? undefined)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }
  await runtime.ingestWebhook("mailchimp_transactional", req.body);
  res.status(202).json({ accepted: true });
});

export default router;
