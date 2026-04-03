import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { appsTable, db, invitationsTable, orgAppAccessTable, orgMembershipsTable, organizationsTable, usersTable } from "@workspace/db";
import { writeAuditLog } from "../lib/audit.js";
import { getAbuseClientKey, recordAbuseSignal } from "../lib/authAbuse.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrganizationAppSession } from "../middlewares/requireOrganizationAppSession.js";
import { requireOrgAccess, requireOrgAdmin } from "../middlewares/requireOrgAccess.js";
import { inviteSchema, validateBody } from "../middlewares/validation.js";
import { assertRequestSessionGroupCompatibleWithOrg } from "../lib/sessionGroupCompatibility.js";
import { InvitationEmailConfigError, sendLane1InvitationEmail } from "../lib/invitationEmail.js";

const router = Router();
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function getOrganizationAppContextForSession(orgId: string, sessionAppSlug: string | undefined) {
  if (!sessionAppSlug) return null;

  const org = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, orgId) });
  if (!org) return null;

  const app = await db.query.appsTable.findFirst({ where: and(eq(appsTable.slug, sessionAppSlug), eq(appsTable.isActive, true)) });
  if (!app || app.accessMode !== "organization") return null;

  let orgAppAccess = null;
  try {
    orgAppAccess = await db.query.orgAppAccessTable.findFirst({
      where: and(eq(orgAppAccessTable.orgId, orgId), eq(orgAppAccessTable.appId, app.id), eq(orgAppAccessTable.enabled, true)),
    });
  } catch {
    orgAppAccess = null;
  }
  if (!orgAppAccess && org.appId !== app.id) return null;

  return { app };
}

async function isStaffInvitesEnabledForOrg(orgId: string, sessionAppSlug: string | undefined): Promise<boolean> {
  const context = await getOrganizationAppContextForSession(orgId, sessionAppSlug);
  return Boolean(context?.app.staffInvitesEnabled);
}

async function isStaffInvitesEnabledForInvitation(
  invitation: { orgId: string | null; appId: string },
): Promise<boolean> {
  if (!invitation.orgId) return false;
  let resolvedAppId = invitation.appId;
  if (!resolvedAppId) {
    const org = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, invitation.orgId) });
    resolvedAppId = org?.appId ?? "";
  }
  if (!resolvedAppId) return false;

  const app = await db.query.appsTable.findFirst({ where: and(eq(appsTable.id, resolvedAppId), eq(appsTable.isActive, true)) });
  if (!app || app.accessMode !== "organization" || !app.staffInvitesEnabled) return false;

  let orgAppAccess = null;
  try {
    orgAppAccess = await db.query.orgAppAccessTable.findFirst({
      where: and(eq(orgAppAccessTable.orgId, invitation.orgId), eq(orgAppAccessTable.appId, resolvedAppId), eq(orgAppAccessTable.enabled, true)),
    });
  } catch {
    orgAppAccess = null;
  }
  if (orgAppAccess) return true;

  const org = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, invitation.orgId) });
  return org?.appId === resolvedAppId;
}

async function listInvitations(req: Request<{ orgId: string }>, res: Response) {
  const { orgId } = req.params;

  if (!(await isStaffInvitesEnabledForOrg(orgId, req.session.appSlug))) {
    res.status(403).json({ error: "Staff invitation flow is disabled for this app" });
    return;
  }

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

  if (!(await isStaffInvitesEnabledForOrg(orgId, req.session.appSlug))) {
    res.status(403).json({ error: "Staff invitation flow is disabled for this app" });
    return;
  }

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
  const organizationAppContext = await getOrganizationAppContextForSession(orgId, req.session.appSlug);
  if (!organizationAppContext) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

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
      appId: organizationAppContext.app.id,
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

  try {
    await sendLane1InvitationEmail({
      req,
      appId: organizationAppContext.app.id,
      orgId,
      invitationId: invitation.id,
      invitationToken: rawInvitationToken,
      invitationExpiresAt: invitation.expiresAt,
      inviteeEmail: invitation.email,
      invitedByUserId: userId,
      actorUserId: userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invitation email delivery failed";
    console.error("[invitations] lane1 invitation email send failed", {
      invitationId: invitation.id,
      orgId,
      appId: organizationAppContext.app.id,
      error: message,
    });
    writeAuditLog({
      orgId,
      userId,
      action: "org.member.invited.email.failed",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: {
        error: message,
        failureKind: error instanceof InvitationEmailConfigError ? "config" : "provider",
      },
      req,
    });
    res.status(500).json({ error: message });
    return;
  }

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

  if (!(await isStaffInvitesEnabledForOrg(orgId, req.session.appSlug))) {
    res.status(403).json({ error: "Staff invitation flow is disabled for this app" });
    return;
  }

  const revokedInvitations = await db
    .update(invitationsTable)
    .set({ invitationStatus: "revoked" })
    .where(and(eq(invitationsTable.id, invitationId), eq(invitationsTable.orgId, orgId)))
    .returning({ id: invitationsTable.id });

  if (revokedInvitations.length === 0) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }

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

  if (!(await isStaffInvitesEnabledForOrg(orgId, req.session.appSlug))) {
    res.status(403).json({ error: "Staff invitation flow is disabled for this app" });
    return;
  }

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

  try {
    await sendLane1InvitationEmail({
      req,
      appId: invitation.appId,
      orgId,
      invitationId,
      invitationToken: rawInvitationToken,
      invitationExpiresAt,
      inviteeEmail: invitation.email,
      invitedByUserId: invitation.invitedByUserId ?? req.session.userId ?? "",
      actorUserId: req.session.userId ?? "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invitation email delivery failed";
    console.error("[invitations] lane1 invitation resend failed", {
      invitationId,
      orgId,
      appId: invitation.appId,
      error: message,
    });
    writeAuditLog({
      orgId,
      userId: req.session.userId,
      action: "org.invitation.resent.email.failed",
      resourceType: "invitation",
      resourceId: invitationId,
      metadata: {
        error: message,
        failureKind: error instanceof InvitationEmailConfigError ? "config" : "provider",
      },
      req,
    });
    res.status(500).json({ error: message });
    return;
  }

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

  if (!(await isStaffInvitesEnabledForInvitation(invitation))) {
    writeAuditLog({
      orgId: invitation.orgId ?? undefined,
      userId,
      action: "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { reason: "staff-invites-disabled" },
      req,
    });
    res.status(403).json({ error: "Staff invitation flow is disabled for this app" });
    return;
  }

  if (invitation.invitationStatus !== "pending") {
    const signal = recordAbuseSignal(`invitation:accept:status:${getAbuseClientKey(req)}`);
    writeAuditLog({
      orgId: invitation.orgId ?? undefined,
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
      orgId: invitation.orgId ?? undefined,
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
      orgId: invitation.orgId ?? undefined,
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

  if (!invitation.orgId) {
    writeAuditLog({
      userId,
      action: "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { reason: "missing-org-id" },
      req,
    });
    res.status(500).json({ error: "Invitation is invalid" });
    return;
  }

  const orgSessionGroupCheck = await assertRequestSessionGroupCompatibleWithOrg(req, invitation.orgId);
  if (!orgSessionGroupCheck.ok) {
    writeAuditLog({
      orgId: invitation.orgId,
      userId,
      action: "invitation.accept.failed",
      resourceType: "invitation",
      resourceId: invitation.id,
      metadata: { reason: orgSessionGroupCheck.reason },
      req,
    });
    res.status(orgSessionGroupCheck.reason === "invalid-org" ? 404 : 403).json({
      error: orgSessionGroupCheck.reason === "invalid-org"
        ? "Organization not found"
        : "Organization is not accessible from this session context.",
    });
    return;
  }

  const existingMembership = await db.query.orgMembershipsTable.findFirst({
    where: and(eq(orgMembershipsTable.userId, userId), eq(orgMembershipsTable.orgId, invitation.orgId)),
  });

  if (!existingMembership) {
    await db.insert(orgMembershipsTable).values({
      id: randomUUID(),
      userId,
      orgId: invitation.orgId,
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

router.get("/organizations/:orgId/invitations", requireAuth, requireOrganizationAppSession, requireOrgAccess, listInvitations);
router.post(
  "/organizations/:orgId/invitations",
  requireAuth,
  requireOrganizationAppSession,
  requireOrgAdmin,
  validateBody(inviteSchema),
  createInvitation
);
router.delete(
  "/organizations/:orgId/invitations/:invitationId",
  requireAuth,
  requireOrganizationAppSession,
  requireOrgAdmin,
  cancelInvitation
);
router.post(
  "/organizations/:orgId/invitations/:invitationId/resend",
  requireAuth,
  requireOrganizationAppSession,
  requireOrgAdmin,
  resendInvitation
);
router.post("/invitations/:token/accept", requireAuth, requireOrganizationAppSession, acceptInvitation);

export default router;
