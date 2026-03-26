import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, invitationsTable, orgMembershipsTable, organizationsTable, usersTable } from "@workspace/db";
import { writeAuditLog } from "../lib/audit.js";
import { getAbuseClientKey, recordAbuseSignal } from "../lib/authAbuse.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrgAccess, requireOrgAdmin } from "../middlewares/requireOrgAccess.js";
import { turnstileVerifyMiddleware } from "../middlewares/turnstile.js";
import { inviteSchema, validateBody } from "../middlewares/validation.js";

const router = Router();
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function listInvitations(req: Request<{ orgId: string }>, res: Response) {
  const { orgId } = req.params;

  const org = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.id, orgId),
  });

  const invitations = await db.query.invitationsTable.findMany({
    where: and(eq(invitationsTable.orgId, orgId), eq(invitationsTable.invitationStatus, "pending")),
  });

  res.json(
    invitations.map((invitation: (typeof invitations)[number]) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.invitedRole,
      orgId: invitation.orgId,
      orgName: org?.name ?? "",
      status: invitation.invitationStatus,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    }))
  );
}

async function createInvitation(req: Request<{ orgId: string }>, res: Response) {
  const { orgId } = req.params;
  const userId = req.session.userId;
  const { email, role } = req.body;

  if (!userId || !email || !role) {
    res.status(400).json({ error: "email and role are required" });
    return;
  }

  const existingUser = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });

  if (existingUser) {
    const membership = await db.query.orgMembershipsTable.findFirst({
      where: and(eq(orgMembershipsTable.userId, existingUser.id), eq(orgMembershipsTable.orgId, orgId)),
    });

    if (membership) {
      res.status(409).json({ error: "User is already a member of this organization" });
      return;
    }
  }

  const org = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, orgId) });

  const rawInvitationToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawInvitationToken).digest("hex");
  const invitationExpiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const [invitation] = await db
    .insert(invitationsTable)
    .values({
      id: randomUUID(),
      email,
      orgId,
      invitedRole: role,
      token: tokenHash,
      invitationStatus: "pending",
      appId: "ayni",
      invitedByUserId: userId,
      expiresAt: invitationExpiresAt,
    })
    .returning();

  writeAuditLog({
    orgId,
    userId,
    action: "org.member.invited",
    resourceType: "invitation",
    resourceId: invitation.id,
    metadata: { email, role },
    req,
  });

  res.status(201).json({
    id: invitation.id,
    email: invitation.email,
    role: invitation.invitedRole,
    orgId: invitation.orgId,
    orgName: org?.name ?? "",
    status: invitation.invitationStatus,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    invitationToken: rawInvitationToken,
  });
}

async function cancelInvitation(req: Request<{ orgId: string; invitationId: string }>, res: Response) {
  const { orgId, invitationId } = req.params;

  await db
    .update(invitationsTable)
    .set({ invitationStatus: "revoked" })
    .where(eq(invitationsTable.id, invitationId));

  writeAuditLog({
    orgId,
    userId: req.session.userId,
    action: "org.invitation.revoked",
    resourceType: "invitation",
    resourceId: invitationId,
    req,
  });

  res.json({ success: true, message: "Invitation cancelled" });
}

async function resendInvitation(req: Request<{ orgId: string; invitationId: string }>, res: Response) {
  const { orgId, invitationId } = req.params;

  const invitation = await db.query.invitationsTable.findFirst({ where: eq(invitationsTable.id, invitationId) });

  if (!invitation || invitation.orgId !== orgId || invitation.invitationStatus !== "pending") {
    res.status(404).json({ error: "Invitation not found or not pending" });
    return;
  }

  const rawInvitationToken = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawInvitationToken).digest("hex");
  const invitationExpiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  await db
    .update(invitationsTable)
    .set({ token: tokenHash, expiresAt: invitationExpiresAt, invitationStatus: "pending" })
    .where(eq(invitationsTable.id, invitationId));

  writeAuditLog({
    orgId,
    userId: req.session.userId,
    action: "org.invitation.resent",
    resourceType: "invitation",
    resourceId: invitationId,
    req,
  });

  res.json({ success: true, invitationId, invitationToken: rawInvitationToken });
}

async function acceptInvitation(req: Request<{ token: string }>, res: Response) {
  const invitationToken = req.params.token;
  const userId = req.session.userId;

  if (!invitationToken || !userId) {
    writeAuditLog({
      userId,
      action: "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitationToken ?? null,
      metadata: { reason: "invalid-request" },
      req,
    });
    res.status(400).json({ error: "Invalid invitation request" });
    return;
  }

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });

  if (!user) {
    writeAuditLog({
      userId,
      action: "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitationToken,
      metadata: { reason: "user-not-found" },
      req,
    });
    res.status(401).json({ error: "User not found" });
    return;
  }

  const hashedInvitationToken = createHash("sha256").update(invitationToken).digest("hex");

  const invitation = await db.query.invitationsTable.findFirst({
    where: eq(invitationsTable.token, hashedInvitationToken),
  });

  if (!invitation) {
    const signal = recordAbuseSignal(`invitation:accept:not-found:${getAbuseClientKey(req)}`);
    writeAuditLog({
      userId,
      action: signal.repeated ? "invitation.accept.failed.repeated" : "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitationToken,
      metadata: { reason: "not-found", count: signal.count, threshold: signal.threshold },
      req,
    });
    res.status(404).json({ error: "Invitation not found" });
    return;
  }

  if (invitation.invitationStatus !== "pending") {
    const signal = recordAbuseSignal(`invitation:accept:status:${getAbuseClientKey(req)}`);
    writeAuditLog({
      orgId: invitation.orgId,
      userId,
      action: signal.repeated ? "invitation.accept.failed.repeated" : "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: {
        reason: "already-processed",
        invitationStatus: invitation.invitationStatus,
        count: signal.count,
        threshold: signal.threshold,
      },
      req,
    });
    res.status(409).json({ error: "Invitation is no longer pending" });
    return;
  }

  if (new Date() > invitation.expiresAt) {
    await db.update(invitationsTable).set({ invitationStatus: "expired" }).where(eq(invitationsTable.id, invitation.id));
    const signal = recordAbuseSignal(`invitation:accept:expired:${getAbuseClientKey(req)}`);
    writeAuditLog({
      orgId: invitation.orgId,
      userId,
      action: signal.repeated ? "invitation.accept.failed.repeated" : "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { reason: "expired", count: signal.count, threshold: signal.threshold },
      req,
    });
    res.status(410).json({ error: "Invitation has expired" });
    return;
  }

  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    const signal = recordAbuseSignal(`invitation:accept:email-mismatch:${getAbuseClientKey(req)}`);
    writeAuditLog({
      orgId: invitation.orgId,
      userId,
      action: signal.repeated ? "invitation.accept.failed.repeated" : "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: {
        reason: "email-mismatch",
        invitedEmail: invitation.email,
        actorEmail: user.email,
        count: signal.count,
        threshold: signal.threshold,
      },
      req,
    });
    res.status(403).json({ error: "Invitation email does not match your account." });
    return;
  }

  const existingMembership = await db.query.orgMembershipsTable.findFirst({
    where: and(eq(orgMembershipsTable.userId, userId), eq(orgMembershipsTable.orgId, invitation.orgId)),
  });

  if (!existingMembership) {
    await db.insert(orgMembershipsTable).values({
      id: randomUUID(),
      userId,
      orgId: invitation.orgId!,
      role: invitation.invitedRole,
      membershipStatus: "active",
      joinedAt: new Date(),
    });
  }

  await db
    .update(invitationsTable)
    .set({ invitationStatus: "accepted", acceptedAt: new Date(), acceptedUserId: userId })
    .where(eq(invitationsTable.id, invitation.id));

  writeAuditLog({
    orgId: invitation.orgId,
    userId,
    action: "org.invitation.accepted",
    resourceType: "invitation",
    resourceId: invitation.id,
    req,
  });

  const org = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, invitation.orgId) });
  res.json(org);
}

router.get("/organizations/:orgId/invitations", requireAuth, requireOrgAccess, listInvitations);
router.post(
  "/organizations/:orgId/invitations",
  turnstileVerifyMiddleware(),
  requireAuth,
  requireOrgAdmin,
  validateBody(inviteSchema),
  createInvitation
);
router.delete("/organizations/:orgId/invitations/:invitationId", requireAuth, requireOrgAdmin, cancelInvitation);
router.post(
  "/organizations/:orgId/invitations/:invitationId/resend",
  requireAuth,
  requireOrgAdmin,
  resendInvitation
);
router.post("/invitations/:token/accept", turnstileVerifyMiddleware(), requireAuth, acceptInvitation);

export default router;
