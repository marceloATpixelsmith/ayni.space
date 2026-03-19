import { Router, type IRouter } from "express";
import {
  db,
  organizationsTable,
  orgMembershipsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";
import { validateBody } from "../middlewares/validation.js";
import { createOrgSchema } from "../middlewares/validation.js";
import { turnstileVerifyMiddleware } from "../middlewares/turnstile.js";
import { requireOrgAccess, requireOrgAdmin } from "../middlewares/requireOrgAccess.js";
import { writeAuditLog } from "../lib/audit.js";
import { getOrgAppsHandler } from "./apps.js";

const router: IRouter = Router();

// ── GET /organizations ────────────────────────────────────────────────────────
router.get("/", requireAuth, async (req, res) => {
  const userId = req.session.userId!;

  const result = await db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      slug: organizationsTable.slug,
      logoUrl: organizationsTable.logoUrl,
      website: organizationsTable.website,
      stripeCustomerId: organizationsTable.stripeCustomerId,
      createdAt: organizationsTable.createdAt,
    })
    .from(orgMembershipsTable)
    .innerJoin(organizationsTable, eq(orgMembershipsTable.orgId, organizationsTable.id))
    .where(and(eq(orgMembershipsTable.userId, userId), eq(orgMembershipsTable.membershipStatus, "active")));

  res.json(result.map((o) => ({ ...o, memberCount: 0 })));
});

// ── POST /organizations ────────────────────────────────────────────────────────
router.post("/", turnstileVerifyMiddleware, requireAuth, validateBody(createOrgSchema), async (req, res) => {
  const userId = req.session.userId!;
  const { name, slug, website } = req.body as { name: string; slug: string; website?: string };

  if (!name || !slug) {
    res.status(400).json({ error: "name and slug are required" });
    return;
  }

  // Check slug uniqueness
  const existing = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.slug, slug),
  });
  if (existing) {
    res.status(409).json({ error: "An organization with that slug already exists" });
    return;
  }

  const orgId = randomUUID();
  const [org] = await db
    .insert(organizationsTable)
    .values({ id: orgId, name, slug, website: website ?? null, appId: "ayni", ownerUserId: userId })
    .returning();

  // Add creator as owner
  await db.insert(orgMembershipsTable).values({
    userId,
    orgId: org.id,
    id: randomUUID(),
    role: "org_owner",
    membershipStatus: "active",
    joinedAt: new Date(),
  });

  // Set as active org for user
  await db.update(usersTable).set({ activeOrgId: org.id }).where(eq(usersTable.id, userId));
  req.session.activeOrgId = org.id;

  writeAuditLog({
    orgId: org.id,
    userId,
    action: "org.created",
    resourceType: "organization",
    resourceId: org.id,
    req,
  });

  res.status(201).json({ ...org, memberCount: 1 });
});

// ── GET /organizations/:orgId ─────────────────────────────────────────────────
router.get("/:orgId", requireAuth, requireOrgAccess, async (req, res) => {
  const { orgId } = req.params;

  const org = await db.query.organizationsTable.findFirst({
    where: eq(organizationsTable.id, orgId),
  });

  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return;
  }

  const [memberCount] = await db
    .select({ count: count() })
    .from(orgMembershipsTable)
    .where(eq(orgMembershipsTable.orgId, orgId));

  res.json({ ...org, memberCount: Number(memberCount?.count ?? 0) });
});

// ── PATCH /organizations/:orgId ───────────────────────────────────────────────
router.patch("/:orgId", requireAuth, requireOrgAdmin, async (req, res) => {
  const { orgId } = req.params;
  const { name, website, logoUrl } = req.body as {
    name?: string;
    website?: string;
    logoUrl?: string;
  };

  const [updated] = await db
    .update(organizationsTable)
    .set({
      name: name ?? undefined,
      website: website ?? undefined,
      logoUrl: logoUrl ?? undefined,
    })
    .where(eq(organizationsTable.id, orgId))
    .returning();

  writeAuditLog({
    orgId,
    userId: req.session.userId,
    action: "org.updated",
    resourceType: "organization",
    resourceId: orgId,
    req,
  });

  res.json({ ...updated, memberCount: 0 });
});

// ── GET /organizations/:orgId/members ─────────────────────────────────────────
router.get("/:orgId/members", requireAuth, requireOrgAccess, async (req, res) => {
  const { orgId } = req.params;

  const members = await db
    .select({
      userId: orgMembershipsTable.userId,
      orgId: orgMembershipsTable.orgId,
      role: orgMembershipsTable.role,
      email: usersTable.email,
      name: usersTable.name,
      avatarUrl: usersTable.avatarUrl,
      joinedAt: orgMembershipsTable.createdAt,
    })
    .from(orgMembershipsTable)
    .innerJoin(usersTable, eq(orgMembershipsTable.userId, usersTable.id))
    .where(eq(orgMembershipsTable.orgId, orgId));

  res.json(members);
});

// ── PATCH /organizations/:orgId/members/:userId ───────────────────────────────
router.patch("/:orgId/members/:userId", requireAuth, requireOrgAdmin, async (req, res) => {
  const { orgId, userId } = req.params;
  const { role } = req.body as { role: string };

  const validRoles = ["org_owner", "org_admin", "staff"];
  if (!validRoles.includes(role)) {
    res.status(400).json({ error: "Invalid role" });
    return;
  }

  const [updated] = await db
    .update(orgMembershipsTable)
    .set({ role })
    .where(and(eq(orgMembershipsTable.userId, userId), eq(orgMembershipsTable.orgId, orgId)))
    .returning();

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });

  res.json({
    userId: updated.userId,
    orgId: updated.orgId,
    role: updated.role,
    email: user?.email ?? "",
    name: user?.name ?? null,
    avatarUrl: user?.avatarUrl ?? null,
    joinedAt: updated.createdAt,
  });
});

// ── DELETE /organizations/:orgId/members/:userId ──────────────────────────────
router.delete("/:orgId/members/:userId", requireAuth, requireOrgAdmin, async (req, res) => {
  const { orgId, userId } = req.params;
  const requesterId = req.session.userId!;

  // Cannot remove yourself
  if (userId === requesterId) {
    res.status(400).json({ error: "You cannot remove yourself from the organization" });
    return;
  }

  await db
    .delete(orgMembershipsTable)
    .where(and(eq(orgMembershipsTable.userId, userId), eq(orgMembershipsTable.orgId, orgId)));

  writeAuditLog({
    orgId,
    userId: requesterId,
    action: "org.member.removed",
    resourceType: "membership",
    resourceId: userId,
    req,
  });

  res.json({ success: true, message: "Member removed" });
});

// ── GET /organizations/:orgId/apps ────────────────────────────────────────────
router.get("/:orgId/apps", requireAuth, requireOrgAccess, getOrgAppsHandler);

export default router;
