import { Router, type IRouter } from "express";
import { db, usersTable, orgMembershipsTable, organizationsTable, pool } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/requireAuth.js";
import { validateBody, updateUserSchema, switchOrgSchema } from "../middlewares/validation.js";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();

// ── GET /users/me ─────────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    createdAt: user.createdAt,
  });
});

// ── PATCH /users/me ───────────────────────────────────────────────────────────
router.patch("/me", requireAuth, validateBody(updateUserSchema), async (req, res) => {
  const userId = req.session.userId!;
  const { name } = req.body as { name?: string };

  const [updated] = await db
    .update(usersTable)
    .set({ name: name ?? undefined })
    .where(eq(usersTable.id, userId))
    .returning();

  res.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    avatarUrl: updated.avatarUrl,
    isSuperAdmin: updated.isSuperAdmin,
    createdAt: updated.createdAt,
  });
});

// ── POST /users/me/switch-org ─────────────────────────────────────────────────
router.post("/me/switch-org", requireAuth, validateBody(switchOrgSchema), async (req, res) => {
  const userId = req.session.userId!;
  const { orgId } = req.body as { orgId: string };

  if (!orgId) {
    res.status(400).json({ error: "orgId is required" });
    return;
  }

  const membership = await db.query.orgMembershipsTable.findFirst({
    where: and(
      eq(orgMembershipsTable.userId, userId),
      eq(orgMembershipsTable.orgId, orgId),
      eq(orgMembershipsTable.membershipStatus, "active")
    ),
  });

  if (!membership) {
    res.status(403).json({ error: "You are not a member of that organization" });
    return;
  }

  await db.update(usersTable).set({ activeOrgId: orgId }).where(eq(usersTable.id, userId));
  writeAuditLog({
    orgId,
    userId,
    action: "user.active_org.switched",
    resourceType: "user",
    resourceId: userId,
    metadata: { activeOrgId: orgId },
    req,
  });

  const { rotateSession } = await import("../lib/session.js");
  const originalSessionCreatedAt = req.session.sessionCreatedAt;
  const originalSessionAuthenticatedAt = req.session.sessionAuthenticatedAt;

  rotateSession(req, (err: unknown) => {
    if (err) {
      res.status(500).json({ error: "Failed to rotate session" });
      return;
    }

    req.session.userId = userId;
    req.session.activeOrgId = orgId;
    req.session.sessionCreatedAt = originalSessionCreatedAt ?? Date.now();
    req.session.sessionAuthenticatedAt = originalSessionAuthenticatedAt ?? Date.now();
    req.session.save((saveErr: unknown) => {
      if (saveErr) {
        res.status(500).json({ error: "Failed to persist switched organization" });
        return;
      }

      res.json({ success: true, activeOrgId: orgId });
    });
  });
});

// ── PATCH /users/:id/suspend ────────────────────────────────────────────────
router.patch("/:id/suspend", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const [user] = await db.update(usersTable).set({ suspended: true }).where(eq(usersTable.id, id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  writeAuditLog({
    userId: req.session.userId,
    action: "user.suspended",
    resourceType: "user",
    resourceId: id,
    req,
  });
  res.json({ success: true, user });
});

// ── PATCH /users/:id/unsuspend ──────────────────────────────────────────────
router.patch("/:id/unsuspend", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const [user] = await db.update(usersTable).set({ suspended: false }).where(eq(usersTable.id, id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  writeAuditLog({
    userId: req.session.userId,
    action: "user.unsuspended",
    resourceType: "user",
    resourceId: id,
    req,
  });
  res.json({ success: true, user });
});

// ── DELETE /users/me (self-service deletion) ────────────────────────────────
router.delete("/me", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const [user] = await db
    .update(usersTable)
    .set({ deletedAt: new Date(), active: false })
    .where(eq(usersTable.id, userId))
    .returning();
  writeAuditLog({
    userId,
    action: "user.deleted.self",
    resourceType: "user",
    resourceId: userId,
    req,
  });

  req.session.destroy(() => {});
  res.json({ success: true, message: "Account deleted", user });
});

// ── POST /users/logout-others ───────────────────────────────────────────────
router.post("/logout-others", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const sid = req.session.id;

  await pool.query(
    `DELETE FROM sessions WHERE sess::jsonb->>'userId' = $1 AND sid != $2`,
    [userId, sid],
  );
  writeAuditLog({
    userId,
    action: "user.sessions.revoked_others",
    resourceType: "session",
    resourceId: sid,
    req,
  });

  res.json({ success: true, message: "Other sessions logged out" });
});

export default router;
