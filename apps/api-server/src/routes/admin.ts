import { Router, type IRouter } from "express";
import {
  db,
  organizationsTable,
  usersTable,
  appsTable,
  auditLogsTable,
  featureFlagsTable,
  orgAppAccessTable,
} from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();

function asSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function parsePageNumber(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(asSingleString(value) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── GET /admin/stats ──────────────────────────────────────────────────────────
router.get("/stats", async (_req, res) => {
  const [[totalUsers], [totalOrgs], [totalApps]] = await Promise.all([
    db.select({ count: count() }).from(usersTable),
    db.select({ count: count() }).from(organizationsTable),
    db.select({ count: count() }).from(appsTable),
  ]);

  res.json({
    totalUsers: Number(totalUsers?.count ?? 0),
    totalOrgs: Number(totalOrgs?.count ?? 0),
    totalSubscriptions: 0,
    activeSubscriptions: 0,
    totalApps: Number(totalApps?.count ?? 0),
  });
});

// ── GET /admin/organizations ──────────────────────────────────────────────────
router.get("/organizations", async (req, res) => {
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);

  const [orgs, [totalRow]] = await Promise.all([
    db.query.organizationsTable.findMany({ orderBy: desc(organizationsTable.createdAt), limit, offset }),
    db.select({ count: count() }).from(organizationsTable),
  ]);

  res.json({
    organizations: orgs.map((o) => ({ ...o, memberCount: 0 })),
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  });
});

// ── GET /admin/users ──────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);

  const [users, [totalRow]] = await Promise.all([
    db.query.usersTable.findMany({ orderBy: desc(usersTable.createdAt), limit, offset }),
    db.select({ count: count() }).from(usersTable),
  ]);

  res.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      isSuperAdmin: u.isSuperAdmin,
      createdAt: u.createdAt,
    })),
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  });
});

// ── GET /admin/audit-logs ─────────────────────────────────────────────────────
router.get("/audit-logs", async (req, res) => {
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);

  const [logs, [totalRow]] = await Promise.all([
    db.query.auditLogsTable.findMany({ orderBy: desc(auditLogsTable.createdAt), limit, offset }),
    db.select({ count: count() }).from(auditLogsTable),
  ]);

  res.json({ logs, total: Number(totalRow?.count ?? 0), limit, offset });
});

// ── GET /admin/feature-flags ──────────────────────────────────────────────────
router.get("/feature-flags", async (_req, res) => {
  const flags = await db.query.featureFlagsTable.findMany();
  res.json(flags);
});

// ── POST /admin/feature-flags ─────────────────────────────────────────────────
router.post("/feature-flags", async (req, res) => {
  const { key, value, orgId, description } = req.body as {
    key: string;
    value: boolean;
    orgId?: string;
    description?: string;
  };

  if (!key || value === undefined) {
    res.status(400).json({ error: "key and value are required" });
    return;
  }

  const [flag] = await db
    .insert(featureFlagsTable)
    .values({
      id: randomUUID(),
      key,
      value,
      orgId: orgId ?? null,
      description: description ?? null,
    })
    .onConflictDoUpdate({
      target: [featureFlagsTable.key],
      set: { value, description: description ?? undefined },
    })
    .returning();

  writeAuditLog({
    userId: req.session.userId,
    action: "feature_flag.set",
    resourceType: "feature_flag",
    resourceId: flag.id,
    metadata: { key, value },
    req,
  });

  res.json(flag);
});

// ── PUT /admin/organizations/:orgId/apps/:appId ───────────────────────────────
router.put("/organizations/:orgId/apps/:appId", async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const appId = asSingleString(req.params["appId"]);
  const { enabled } = req.body as { enabled: boolean };

  if (!orgId || !appId) {
    res.status(400).json({ error: "orgId and appId route params are required" });
    return;
  }

  const existing = await db.query.orgAppAccessTable.findFirst({
    where: (t, { and, eq }) => and(eq(t.orgId, orgId), eq(t.appId, appId)),
  });

  if (existing) {
    await db
      .update(orgAppAccessTable)
      .set({ enabled })
      .where(eq(orgAppAccessTable.id, existing.id));
  } else {
    await db.insert(orgAppAccessTable).values({
      id: randomUUID(),
      orgId,
      appId,
      enabled,
    });
  }

  writeAuditLog({
    orgId,
    userId: req.session.userId,
    action: enabled ? "org.app.enabled" : "org.app.disabled",
    resourceType: "app_access",
    resourceId: appId,
    req,
  });

  res.json({ success: true, message: `App access ${enabled ? "enabled" : "disabled"}` });
});

export default router;
