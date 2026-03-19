import { Router, type IRouter } from "express";
import {
  db,
  ayniCeremoniesTable,
  ayniParticipantsTable,
  ayniStaffTable,
} from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireAppAccess } from "../middlewares/requireAppAccess.js";

const router: IRouter = Router();

// ── GET /ayni/ceremonies ──────────────────────────────────────────────────────
router.get("/ceremonies", requireAuth, requireAppAccess("ayni"), async (req, res) => {
  const { orgId, limit: limitStr, offset: offsetStr } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitStr) || 50, 200);
  const offset = parseInt(offsetStr) || 0;

  if (!orgId) {
    res.status(400).json({ error: "orgId query param required" });
    return;
  }

  const ceremonies = await db.query.ayniCeremoniesTable.findMany({
    where: eq(ayniCeremoniesTable.orgId, orgId),
    orderBy: desc(ayniCeremoniesTable.createdAt),
    limit,
    offset,
  });

  const [totalRow] = await db
    .select({ count: count() })
    .from(ayniCeremoniesTable)
    .where(eq(ayniCeremoniesTable.orgId, orgId));

  // Enrich with participant counts
  const enriched = await Promise.all(
    ceremonies.map(async (c) => {
      const [pCount] = await db
        .select({ count: count() })
        .from(ayniParticipantsTable)
        .where(eq(ayniParticipantsTable.ceremonyId, c.id));
      return { ...c, participantCount: Number(pCount?.count ?? 0) };
    })
  );

  res.json({ ceremonies: enriched, total: Number(totalRow?.count ?? 0), limit, offset });
});

// ── GET /ayni/ceremonies/:ceremonyId ─────────────────────────────────────────
router.get("/ceremonies/:ceremonyId", requireAuth, requireAppAccess("ayni"), async (req, res) => {
  const ceremony = await db.query.ayniCeremoniesTable.findFirst({
    where: eq(ayniCeremoniesTable.id, req.params["ceremonyId"]),
  });

  if (!ceremony) {
    res.status(404).json({ error: "Ceremony not found" });
    return;
  }

  const [pCount] = await db
    .select({ count: count() })
    .from(ayniParticipantsTable)
    .where(eq(ayniParticipantsTable.ceremonyId, ceremony.id));

  res.json({ ...ceremony, participantCount: Number(pCount?.count ?? 0) });
});

// ── POST /ayni/ceremonies ─────────────────────────────────────────────────────
router.post("/ceremonies", requireAuth, requireAppAccess("ayni"), async (req, res) => {
  const { orgId, name, description, scheduledAt, location, capacity } = req.body as {
    orgId: string;
    name: string;
    description?: string;
    scheduledAt?: string;
    location?: string;
    capacity?: number;
  };

  if (!orgId || !name) {
    res.status(400).json({ error: "orgId and name are required" });
    return;
  }

  const [ceremony] = await db
    .insert(ayniCeremoniesTable)
    .values({
      id: randomUUID(),
      orgId,
      name,
      description: description ?? null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      location: location ?? null,
      capacity: capacity ?? null,
      status: "draft",
      createdByUserId: req.session.userId ?? null,
    })
    .returning();

  res.status(201).json({ ...ceremony, participantCount: 0 });
});

// ── GET /ayni/participants ────────────────────────────────────────────────────
router.get("/participants", requireAuth, requireAppAccess("ayni"), async (req, res) => {
  const { ceremonyId } = req.query as { ceremonyId: string };

  if (!ceremonyId) {
    res.status(400).json({ error: "ceremonyId query param required" });
    return;
  }

  const participants = await db.query.ayniParticipantsTable.findMany({
    where: eq(ayniParticipantsTable.ceremonyId, ceremonyId),
  });

  res.json(participants);
});

// ── GET /ayni/staff ───────────────────────────────────────────────────────────
router.get("/staff", requireAuth, requireAppAccess("ayni"), async (req, res) => {
  const { orgId } = req.query as { orgId: string };

  if (!orgId) {
    res.status(400).json({ error: "orgId query param required" });
    return;
  }

  const staff = await db.query.ayniStaffTable.findMany({
    where: eq(ayniStaffTable.orgId, orgId),
  });

  res.json(staff);
});

export default router;
