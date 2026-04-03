import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrgAccess } from "../middlewares/requireOrgAccess.js";
import { TransactionalEmailRepository } from "@workspace/transactional-email";
import { Lane2TransactionalEmailRuntime } from "@workspace/transactional-email";
import { createHmac, timingSafeEqual } from "node:crypto";

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

router.post("/organizations/:orgId/transactional-email/send", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = req.params["orgId"];
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

router.post("/organizations/:orgId/transactional-email/connections/:connectionId/validate", requireAuth, requireOrgAccess, async (req, res) => {
  const connectionIdRaw = req.params["connectionId"];
  const connectionId = typeof connectionIdRaw === "string" ? connectionIdRaw : undefined;
  if (!connectionId) {
    res.status(400).json({ error: "Connection ID is required" });
    return;
  }

  try {
    const validation = await runtime.validateConnection(connectionId);
    res.status(200).json(validation);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "connection validation failed" });
  }
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
