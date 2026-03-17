import { Router, type IRouter } from "express";
import { db, pool, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middlewares/requireAuth.js";
import { validateBody, updateUserSchema, switchOrgSchema } from "../middlewares/validation.js";
import { rotateSession } from "../lib/session.js";

const router: IRouter = Router();

//──────────────────────────────────────────────────────────────────────────────
//GET /users/me
//──────────────────────────────────────────────────────────────────────────────
router.get
(
  "/me",
  requireAuth,
  async (req, res) =>
  {
    const userId = req.session.userId!;

    const user = await db.query.usersTable.findFirst
    ({
      where: eq(usersTable.id, userId),
    });

    if (!user)
    {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json
    ({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      isSuperAdmin: user.isSuperAdmin,
      createdAt: user.createdAt,
    });
  }
);

//──────────────────────────────────────────────────────────────────────────────
//PATCH /users/me
//──────────────────────────────────────────────────────────────────────────────
router.patch
(
  "/me",
  requireAuth,
  validateBody(updateUserSchema),
  async (req, res) =>
  {
    const userId = req.session.userId!;
    const { name } = req.body as { name?: string };

    const [updated] = await db
      .update(usersTable)
      .set({ name: name ?? undefined })
      .where(eq(usersTable.id, userId))
      .returning();

    res.json
    ({
      id: updated.id,
      email: updated.email,
      name: updated.name,
      avatarUrl: updated.avatarUrl,
      isSuperAdmin: updated.isSuperAdmin,
      createdAt: updated.createdAt,
    });
  }
);

//──────────────────────────────────────────────────────────────────────────────
//POST /users/me/switch-org
//──────────────────────────────────────────────────────────────────────────────
router.post
(
  "/me/switch-org",
  requireAuth,
  validateBody(switchOrgSchema),
  async (req, res) =>
  {
    const userId = req.session.userId!;
    const { orgId } = req.body as { orgId: string };

    if (!orgId)
    {
      res.status(400).json({ error: "orgId is required" });
      return;
    }

    //VERIFY USER BELONGS TO THIS ORG
    const membership = await db.query.orgMembershipsTable.findFirst
    ({
      where: (t, { and, eq }) => and(eq(t.userId, userId), eq(t.orgId, orgId)),
    });

    if (!membership)
    {
      res.status(403).json({ error: "You are not a member of that organization" });
      return;
    }

    //UPDATE USER'S ACTIVE ORG
    await db
      .update(usersTable)
      .set({ activeOrgId: orgId })
      .where(eq(usersTable.id, userId));

    //ROTATE SESSION FOR PRIVILEGE/ORG CHANGE
    rotateSession
    (
      req,
      () =>
      {
        req.session.activeOrgId = orgId;
        res.json({ success: true, activeOrgId: orgId });
      }
    );
  }
);

//──────────────────────────────────────────────────────────────────────────────
//PATCH /users/:id/suspend
//──────────────────────────────────────────────────────────────────────────────
router.patch
(
  "/:id/suspend",
  requireSuperAdmin,
  async (req, res) =>
  {
    const { id } = req.params;

    const [user] = await db
      .update(usersTable)
      .set({ suspended: true })
      .where(eq(usersTable.id, id))
      .returning();

    if (!user)
    {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ success: true, user });
  }
);

//──────────────────────────────────────────────────────────────────────────────
//PATCH /users/:id/unsuspend
//──────────────────────────────────────────────────────────────────────────────
router.patch
(
  "/:id/unsuspend",
  requireSuperAdmin,
  async (req, res) =>
  {
    const { id } = req.params;

    const [user] = await db
      .update(usersTable)
      .set({ suspended: false })
      .where(eq(usersTable.id, id))
      .returning();

    if (!user)
    {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ success: true, user });
  }
);

//──────────────────────────────────────────────────────────────────────────────
//DELETE /users/me
//──────────────────────────────────────────────────────────────────────────────
router.delete
(
  "/me",
  requireAuth,
  async (req, res) =>
  {
    const userId = req.session.userId!;

    const [user] = await db
      .update(usersTable)
      .set
      ({
        deletedAt: new Date(),
        active: false,
      })
      .where(eq(usersTable.id, userId))
      .returning();

    req.session.destroy(() => {});

    res.json
    ({
      success: true,
      message: "Account deleted",
      user,
    });
  }
);

//──────────────────────────────────────────────────────────────────────────────
//POST /users/logout-others
//──────────────────────────────────────────────────────────────────────────────
router.post
(
  "/logout-others",
  requireAuth,
  async (req, res) =>
  {
    const userId = req.session.userId!;
    const sid = req.session.id;

    //REMOVE ALL SESSIONS FOR THIS USER EXCEPT CURRENT SESSION
    await pool.query
    (
      `DELETE FROM sessions WHERE sess::jsonb->>'userId' = $1 AND sid != $2`,
      [userId, sid]
    );

    res.json
    ({
      success: true,
      message: "Other sessions logged out",
    });
  }
);

export default router;