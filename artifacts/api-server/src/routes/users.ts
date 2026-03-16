import { Router, type IRouter } from "express";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";

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
router.patch("/me", requireAuth, async (req, res) => {
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
router.post("/me/switch-org", requireAuth, async (req, res) => {
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
  req.session.activeOrgId = orgId;

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
