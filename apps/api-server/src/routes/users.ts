// ── PATCH /users/:id/suspend ────────────────────────────────────────────────
import { requireSuperAdmin } from "../middlewares/requireAuth.js";
router.patch("/:id/suspend", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const [user] = await db.update(usersTable).set({ suspended: true }).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ success: true, user });
});

// ── PATCH /users/:id/unsuspend ──────────────────────────────────────────────
router.patch("/:id/unsuspend", requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const [user] = await db.update(usersTable).set({ suspended: false }).where(eq(usersTable.id, id)).returning();
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ success: true, user });
});

// ── DELETE /users/me (self-service deletion) ────────────────────────────────
router.delete("/me", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  const [user] = await db.update(usersTable).set({ deletedAt: new Date(), active: false }).where(eq(usersTable.id, userId)).returning();
  req.session.destroy(() => {});
  res.json({ success: true, message: "Account deleted", user });
});
// ── POST /users/logout-others ───────────────────────────────────────────────
import { pool } from "@workspace/db";
router.post("/logout-others", requireAuth, async (req, res) => {
  const userId = req.session.userId!;
  // Remove all sessions for this user except current session
  const sid = req.session.id;
  await pool.query(
    `DELETE FROM sessions WHERE sess::jsonb->>'userId' = $1 AND sid != $2`,
    [userId, sid]
  );
  res.json({ success: true, message: "Other sessions logged out" });
});
import { Router, type IRouter } from "express";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { validateBody, updateUserSchema, switchOrgSchema } from "../middlewares/validation.js";

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

  // Verify user belongs to this org
  const membership = await db.query.orgMembershipsTable.findFirst({
    where: (t, { and, eq }) => and(eq(t.userId, userId), eq(t.orgId, orgId)),
  });

  if (!membership) {
    res.status(403).json({ error: "You are not a member of that organization" });
    return;
  }

  // Update user's active org
  await db.update(usersTable).set({ activeOrgId: orgId }).where(eq(usersTable.id, userId));
  // Rotate session for privilege/org change
  const { rotateSession } = await import("../lib/session.js");
  rotateSession(req, () => {
    req.session.activeOrgId = orgId;
    res.json({ success: true, activeOrgId: orgId });
  });
  return;

  // Return updated auth user
  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  const memberships = await db
    .select({
      orgId: orgMembershipsTable.orgId,
      orgName: organizationsTable.name,
      orgSlug: organizationsTable.slug,
      role: orgMembershipsTable.role,
    })
    .from(orgMembershipsTable)
    .innerJoin(organizationsTable, eq(orgMembershipsTable.orgId, organizationsTable.id))
    .where(eq(orgMembershipsTable.userId, userId));

  const activeOrg = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.id, orgId),
  });

  res.json({
    id: user!.id,
    email: user!.email,
    name: user!.name,
    avatarUrl: user!.avatarUrl,
    isSuperAdmin: user!.isSuperAdmin,
    activeOrgId: orgId,
    activeOrg: activeOrg,
    memberships,
  });
});

export default router;
