import { Router } from "express";
import { randomUUID, randomBytes, createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, invitationsTable, orgMembershipsTable, organizationsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { turnstileVerifyMiddleware } from "../middlewares/turnstile.js";
import { validateBody, inviteSchema } from "../middlewares/validation.js";
import { requireOrgAccess, requireOrgAdmin } from "../middlewares/requireOrgAccess.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

async function listInvitations(req, res) {
  const { orgId } = req.params;

  const org = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, orgId) });
  const invitations = await db.query.invitationsTable.findMany({
    where: and(eq(invitationsTable.orgId, orgId), eq(invitationsTable.status, "pending")),
  });

  const orgName = org && org.name ? org.name : "";
  const payload = [];
  for (const inv of invitations) {
    payload.push({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      orgId: inv.orgId,
      orgName,
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    });
  }

  res.json(payload);
}

async function createInvitation(req, res) {
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
  const hashedInvitationToken = createHash("sha256").update(rawInvitationToken).digest("hex");
  const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [invitation] = await db
    .insert(invitationsTable)
    .values({
      id: randomUUID(),
      email,
      orgId,
      role,
      token: hashedInvitationToken,
      status: "pending",
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
    role: invitation.role,
    orgId: invitation.orgId,
    orgName: org && org.name ? org.name : "",
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
    invitationToken: rawInvitationToken,
  });
}

async function cancelInvitation(req, res) {
  const { invitationId } = req.params;
  await db.update(invitationsTable).set({ status: "cancelled" }).where(eq(invitationsTable.id, invitationId));
  res.json({ success: true, message: "Invitation cancelled" });
}

async function resendInvitation(req, res) {
  const { orgId, invitationId } = req.params;
  const invitation = await db.query.invitationsTable.findFirst({ where: eq(invitationsTable.id, invitationId) });
  if (!invitation || invitation.orgId !== orgId || invitation.status !== "pending") {
    res.status(404).json({ error: "Invitation not found or not pending" });
    return;
  }

  const rawInvitationToken = randomBytes(32).toString("hex");
  const hashedInvitationToken = createHash("sha256").update(rawInvitationToken).digest("hex");
  const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db
    .update(invitationsTable)
    .set({ token: hashedInvitationToken, expiresAt: invitationExpiresAt, status: "pending" })
    .where(eq(invitationsTable.id, invitationId))
    .returning();

  res.json({ success: true, invitationId, invitationToken: rawInvitationToken });
}

async function acceptInvitation(req, res) {
  const invitationToken = req.params.token;
  const userId = req.session.userId;
  if (!invitationToken || !userId) {
    res.status(400).json({ error: "Invalid invitation request" });
    return;
  }

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const hashedInvitationToken = createHash("sha256").update(invitationToken).digest("hex");
  const invitation = await db.query.invitationsTable.findFirst({
    where: and(eq(invitationsTable.token, hashedInvitationToken), eq(invitationsTable.status, "pending")),
  });

  if (!invitation) {
    res.status(404).json({ error: "Invitation not found or already used" });
    return;
  }

  if (new Date() > invitation.expiresAt) {
    await db.update(invitationsTable).set({ status: "expired" }).where(eq(invitationsTable.id, invitation.id));
    res.status(410).json({ error: "Invitation has expired" });
    return;
  }

  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    res.status(403).json({ error: "Invitation email does not match your account." });
    return;
  }

  const existing = await db.query.orgMembershipsTable.findFirst({
    where: and(eq(orgMembershipsTable.userId, userId), eq(orgMembershipsTable.orgId, invitation.orgId)),
  });

  if (!existing) {
    await db.insert(orgMembershipsTable).values({
      userId,
      orgId: invitation.orgId,
      role: invitation.role,
    });
  }

  await db.update(invitationsTable).set({ status: "accepted" }).where(eq(invitationsTable.id, invitation.id));

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
  turnstileVerifyMiddleware,
  requireAuth,
  requireOrgAdmin,
  validateBody(inviteSchema),
  createInvitation
);
router.delete("/organizations/:orgId/invitations/:invitationId", requireAuth, requireOrgAdmin, cancelInvitation);
router.post("/organizations/:orgId/invitations/:invitationId/resend", requireAuth, requireOrgAdmin, resendInvitation);
router.post("/invitations/:token/accept", requireAuth, acceptInvitation);

export default router;
