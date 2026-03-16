import { Router, type IRouter } from "express";
import { db, invitationsTable, orgMembershipsTable, organizationsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { randomUUID, randomBytes } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrgAccess, requireOrgAdmin } from "../middlewares/requireOrgAccess.js";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();

// ── GET /organizations/:orgId/invitations ─────────────────────────────────────
router.get("/organizations/:orgId/invitations", requireAuth, requireOrgAccess, async (req, res) => {
  const { orgId } = req.params;

  const org = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.id, orgId),
  });

  const invitations = await db.query.invitationsTable.findMany({
    where: and(eq(invitationsTable.orgId, orgId), eq(invitationsTable.status, "pending")),
  });

  res.json(
    invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      orgId: inv.orgId,
      orgName: org?.name ?? "",
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }))
  );
});

// ── POST /organizations/:orgId/invitations ─────────────────────────────────────
router.post("/organizations/:orgId/invitations", requireAuth, requireOrgAdmin, async (req, res) => {
  const { orgId } = req.params;
  const userId = req.session.userId!;
  const { email, role } = req.body as { email: string; role: string };

  if (!email || !role) {
    res.status(400).json({ error: "email and role are required" });
    return;
  }

  // Check if already a member
  const existingUser = await db.query.usersTable.findFirst({
    where: eq(usersTable.email, email),
  });
  if (existingUser) {
    const membership = await db.query.orgMembershipsTable.findFirst({
      where: and(eq(orgMembershipsTable.userId, existingUser.id), eq(orgMembershipsTable.orgId, orgId)),
    });
    if (membership) {
      res.status(409).json({ error: "User is already a member of this organization" });
      return;
    }
  }

  const org = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.id, orgId),
  });

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const [invitation] = await db
    .insert(invitationsTable)
    .values({
      id: randomUUID(),
      email,
      orgId,
      role,
      token,
      status: "pending",
      invitedByUserId: userId,
      expiresAt,
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
    orgName: org?.name ?? "",
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  });
});

// ── DELETE /organizations/:orgId/invitations/:invitationId ────────────────────
router.delete("/organizations/:orgId/invitations/:invitationId", requireAuth, requireOrgAdmin, async (req, res) => {
  const { invitationId } = req.params;

  await db
    .update(invitationsTable)
    .set({ status: "cancelled" })
    .where(eq(invitationsTable.id, invitationId));

  res.json({ success: true, message: "Invitation cancelled" });
});

// ── POST /invitations/:token/accept ───────────────────────────────────────────
router.post("/invitations/:token/accept", requireAuth, async (req, res) => {
  const { token } = req.params;
  const userId = req.session.userId!;

  const invitation = await db.query.invitationsTable.findFirst({
    where: and(eq(invitationsTable.token, token), eq(invitationsTable.status, "pending")),
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

  // Add user to org
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

  const org = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.id, invitation.orgId),
  });

  res.json(org);
});

export default router;
