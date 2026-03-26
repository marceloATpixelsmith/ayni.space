import { Router, type IRouter } from "express";
import { db, auditLogsTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireOrgAccess } from "../middlewares/requireOrgAccess.js";

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

// ── GET /organizations/:orgId/audit-logs ──────────────────────────────────────
router.get("/organizations/:orgId/audit-logs", requireAuth, requireOrgAccess, async (req, res) => {
  const orgId = asSingleString(req.params["orgId"]);
  const limit = Math.min(parsePageNumber(req.query["limit"], 50), 200);
  const offset = parsePageNumber(req.query["offset"], 0);

  if (!orgId) {
    res.status(400).json({ error: "orgId route param required" });
    return;
  }

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
