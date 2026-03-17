import { Router, type IRouter } from "express";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();

// ── GET /auth/me ─────────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  const userId = req.session.userId!;

  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.id, userId),
  });

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  // Get all memberships with org names
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

  // Get active org if set
  let activeOrg = null;
  if (user.activeOrgId) {
    activeOrg = await db.query.organizationsTable.findFirst({
      where: eq(organizationsTable.id, user.activeOrgId),
    });
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuperAdmin: user.isSuperAdmin,
    activeOrgId: user.activeOrgId,
    activeOrg: activeOrg
      ? {
          id: activeOrg.id,
          name: activeOrg.name,
          slug: activeOrg.slug,
          logoUrl: activeOrg.logoUrl,
          website: activeOrg.website,
          createdAt: activeOrg.createdAt,
          stripeCustomerId: activeOrg.stripeCustomerId,
        }
      : null,
    memberships: memberships.map((m) => ({
      orgId: m.orgId,
      orgName: m.orgName,
      orgSlug: m.orgSlug,
      role: m.role,
    })),
  });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────
router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Session destroy error:", err);
    }
    res.clearCookie("saas.sid");
    res.json({ success: true, message: "Logged out successfully" });
  });
});

// ── GET /auth/google/url ──────────────────────────────────────────────────────
router.get("/google/url", (req, res) => {
  try {
    const state = randomUUID();
    req.session.oauthState = state;
    const url = buildGoogleAuthUrl(state);
    res.redirect(url);
  } catch {
    res.status(501).json({ error: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI." });
  }
});

// ── GET /auth/google/callback ─────────────────────────────────────────────────
router.get("/google/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code) {
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  // Validate state to prevent CSRF
  if (state && req.session.oauthState && state !== req.session.oauthState) {
    res.status(400).json({ error: "Invalid OAuth state. Please try signing in again." });
    return;
  }
  delete req.session.oauthState;

  try {
    const googleUser = await exchangeCodeForUser(code as string);

    // Find or create user
    let user = await db.query.usersTable.findFirst({
      where: eq(usersTable.googleId, googleUser.sub),
    });

    if (!user) {
      // Check if user exists by email (account linking)
      const existingByEmail = await db.query.usersTable.findFirst({
        where: eq(usersTable.email, googleUser.email),
      });

      if (existingByEmail) {
        // Link Google account to existing email account
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
      } else {
        // Create brand-new user
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
    } else {
      // Update avatar/name from Google on each login
      await db
        .update(usersTable)
        .set({
          avatarUrl: googleUser.picture ?? user.avatarUrl,
          name: user.name ?? googleUser.name ?? null,
        })
        .where(eq(usersTable.id, user.id));
    }

    // Set session
    req.session.userId = user.id;
    req.session.activeOrgId = user.activeOrgId ?? undefined;

    // Check if user has any orgs
    const memberships = await db.query.orgMembershipsTable.findMany({
      where: eq(orgMembershipsTable.userId, user.id),
    });

    writeAuditLog({
      userId: user.id,
      userEmail: user.email,
      action: "user.login",
      resourceType: "user",
      resourceId: user.id,
      req,
    });

    // Determine redirect path
    const frontendBase = process.env["FRONTEND_URL"] || "";
    if (memberships.length === 0) {
      res.redirect(`${frontendBase}/onboarding`);
    } else {
      res.redirect(`${frontendBase}/dashboard`);
    }
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    res.status(500).json({ error: "Authentication failed. Please try again." });
  }
});

export default router;
