import { Router } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

function firstQueryParam(value)
{
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

async function handleMe(req, res)
{
  const userId = req.session.userId;

  if (!userId)
  {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });

  if (!user)
  {
    res.status(401).json({ error: "User not found" });
    return;
  }

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

  let activeOrg = null;

  if (user.activeOrgId)
  {
    activeOrg = await db.query.organizationsTable.findFirst({ where: eq(organizationsTable.id, user.activeOrgId) });
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    activeOrgId: user.activeOrgId,
    activeOrg: activeOrg,
    memberships,
  });
}

function handleLogout(req, res)
{
  req.session.destroy((err) =>
  {
    if (err) console.error("Session destroy error:", err);
    res.clearCookie("saas.sid");
    req.session = null;
    res.json({ success: true, message: "Logged out successfully" });
  });
}

function handleGoogleUrl(req, res)
{
  try
  {
    const state = randomUUID();
    req.session.oauthState = state;
    const url = buildGoogleAuthUrl(state);

    req.session.save((err) =>
    {
      if (err)
      {
        res.status(500).json({ error: "Failed to initialize OAuth session" });
        return;
      }

      res.redirect(url);
    });
  }
  catch
  {
    res.status(501).json({
      error:
        "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
    });
  }
}

async function handleGoogleCallback(req, res)
{
  const code = firstQueryParam(req.query.code);
  const state = firstQueryParam(req.query.state);

  if (!state || !req.session.oauthState || state !== req.session.oauthState)
  {
    res.status(400).json({ error: "Invalid OAuth state. Please try signing in again." });
    return;
  }

  delete req.session.oauthState;

  try
  {
    const googleUser = await exchangeCodeForUser(code);

    await new Promise((resolve, reject) =>
    {
      req.session.regenerate((err) =>
      {
        if (err)
        {
          reject(err);
          return;
        }

        resolve(undefined);
      });
    });

    let user = await db.query.usersTable.findFirst({ where: eq(usersTable.googleId, googleUser.sub) });

    if (!user)
    {
      const existingByEmail = await db.query.usersTable.findFirst({ where: eq(usersTable.email, googleUser.email) });

      if (existingByEmail)
      {
        const [updated] = await db
          .update(usersTable)
          .set({
            googleId: googleUser.sub,
            avatarUrl: googleUser.picture ?? existingByEmail.avatarUrl,
            name: existingByEmail.name ?? googleUser.name ?? null,
          })
          .where(eq(usersTable.id, existingByEmail.id))
          .returning();

        user = updated;
      }
      else
      {
        const [created] = await db
          .insert(usersTable)
          .values({
            id: randomUUID(),
            email: googleUser.email,
            name: googleUser.name ?? null,
            avatarUrl: googleUser.picture ?? null,
            googleId: googleUser.sub,
            isSuperAdmin: false,
          })
          .returning();

        user = created;

        writeAuditLog({
          userId: user.id,
          userEmail: user.email,
          action: "user.created",
          resourceType: "user",
          resourceId: user.id,
          req,
        });
      }
    }
    else
    {
      await db
        .update(usersTable)
        .set({
          avatarUrl: googleUser.picture ?? user.avatarUrl,
          name: user.name ?? googleUser.name ?? null,
        })
        .where(eq(usersTable.id, user.id));
    }

    if (!user)
    {
      res.status(500).json({ error: "Failed to resolve authenticated user" });
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    req.session.userId = user.id;
    req.session.activeOrgId = user.activeOrgId ?? undefined;

    const memberships = await db.query.orgMembershipsTable.findMany({ where: eq(orgMembershipsTable.userId, user.id) });

    writeAuditLog({
      userId: user.id,
      userEmail: user.email,
      action: "user.login",
      resourceType: "user",
      resourceId: user.id,
      req,
    });

    if (!process.env["FRONTEND_URL"])
    {
      res.status(500).json({ error: "FRONTEND_URL is not configured" });
      return;
    }

    const frontendBase = process.env["FRONTEND_URL"];

    if (memberships.length === 0)
    {
      res.redirect(`${frontendBase}/onboarding`);
    }
    else
    {
      res.redirect(`${frontendBase}/dashboard`);
    }
  }
  catch (error)
  {
    console.error("Google callback failed:", error);
    res.status(500).json({ error: "Google authentication failed" });
  }
}

router.get("/me", requireAuth, handleMe);
router.post("/logout", requireAuth, handleLogout);
router.get("/google/url", handleGoogleUrl);
router.get("/google/callback", handleGoogleCallback);

export default router;