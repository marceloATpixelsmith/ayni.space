import { Router, type IRouter } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrgAccess } from "../middlewares/requireOrgAccess.js";

const router: IRouter = Router();

// ── GET /organizations/:orgId/audit-logs ──────────────────────────────────────
router.get("/organizations/:orgId/audit-logs", requireAuth, requireOrgAccess, async (req, res) => {
  const { orgId } = req.params;
  const limit = Math.min(parseInt(req.query["limit"] as string) || 50, 200);
  const offset = parseInt(req.query["offset"] as string) || 0;

  const [logs, [totalRow]] = await Promise.all([
    db.query.auditLogsTable.findMany({
      where: eq(auditLogsTable.orgId, orgId),
      orderBy: desc(auditLogsTable.createdAt),
      limit,
      offset,
    }),
    db.select({ count: count() }).from(auditLogsTable).where(eq(auditLogsTable.orgId, orgId)),
  ]);

  res.json({
    logs,
    total: Number(totalRow?.count ?? 0),
    limit,
    offset,
  });
});

export default router;
