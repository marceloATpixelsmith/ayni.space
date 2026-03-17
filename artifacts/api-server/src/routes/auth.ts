import { Router } from "express";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { writeAuditLog } from "../lib/audit.js";

const router = Router();

function firstQueryParam(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}


// ── GET /auth/me ─────────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  const userId = req.session.userId!;

    if (!user)
    {
      res.status(401).json({ error: "User not found" });
      return;
    }

    //GET ALL MEMBERSHIPS WITH ORG NAMES
    const memberships = await db
      .select
      ({
        orgId: orgMembershipsTable.orgId,
        orgName: organizationsTable.name,
        orgSlug: organizationsTable.slug,
        role: orgMembershipsTable.role,
      })
      .from(orgMembershipsTable)
      .innerJoin(organizationsTable, eq(orgMembershipsTable.orgId, organizationsTable.id))
      .where(eq(orgMembershipsTable.userId, userId));

    //GET ACTIVE ORG IF SET
    let activeOrg = null;

    if (user.activeOrgId)
    {
      activeOrg = await db.query.organizationsTable.findFirst
      ({
        where: eq(organizationsTable.id, user.activeOrgId),
      });
    }

    res.json
    ({
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
      memberships: memberships.map
      (
        (m) =>
        ({
          orgId: m.orgId,
          orgName: m.orgName,
          orgSlug: m.orgSlug,
          role: m.role,
        })
      ),
    });
  }
);

//──────────────────────────────────────────────────────────────────────────────
//POST /auth/logout
//──────────────────────────────────────────────────────────────────────────────
router.post
(
  "/logout",
  requireAuth,
  (req, res) =>
  {
    req.session.destroy
    (
      (err) =>
      {
        if (err)
        {
          console.error("Session destroy error:", err);
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
    // Regenerate session after logout for extra safety
    req.session = null;
    res.json({ success: true, message: "Logged out successfully" });
  });
});

// ── GET /auth/google/url ──────────────────────────────────────────────────────
router.get("/google/url", (req, res) => {
  try {
    const state = randomUUID();
    req.session.oauthState = state;
    const url = buildGoogleAuthUrl(state);
    req.session.save((err) => {
      if (err) {
        res.status(500).json({ error: "Failed to initialize OAuth session" });
        return;
      }
      res.redirect(url);
    });
  } catch {
    res.status(501).json({ error: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI." });
  }
);

// ── GET /auth/google/callback ─────────────────────────────────────────────────
router.get("/google/callback", async (req, res) => {
  const code = firstQueryParam(req.query.code);
  const state = firstQueryParam(req.query.state);

      req.session.oauthState = state;

      const url = buildGoogleAuthUrl(state);

  try {
    const googleUser = await exchangeCodeForUser(code);

    // Regenerate session on login for session fixation protection
    req.session.regenerate(async (err) => {
      if (err) {
        res.status(500).json({ error: "Session regeneration failed" });
        return;
      }

      // Find or create user
      let user = await db.query.usersTable.findFirst({
        where: eq(usersTable.googleId, googleUser.sub),
      });
    }
  }
);

  try {
    const googleUser = await exchangeCodeForUser(code);

    if (!code)
    {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }

    //STRICT STATE VALIDATION
    if (!state || !req.session.oauthState || state !== req.session.oauthState)
    {
      res.status(400).json({ error: "Invalid OAuth state. Please try signing in again." });
      return;
    }

    //CLEAR STATE AFTER USE
    delete req.session.oauthState;

    try
    {
      const googleUser = await exchangeCodeForUser(code);

      //REGENERATE SESSION ON LOGIN FOR SESSION FIXATION PROTECTION
      req.session.regenerate
      (
        async (err) =>
        {
          if (err)
          {
            res.status(500).json({ error: "Session regeneration failed" });
            return;
          }

          try
          {
            //FIND OR CREATE USER
            let user = await db.query.usersTable.findFirst
            ({
              where: eq(usersTable.googleId, googleUser.sub),
            });

            if (!user)
            {
              //EXPLICIT ACCOUNT-LINKING LOGIC PLACEHOLDER
              //TODO:ADD USER PROMPT/APPROVAL FOR LINKING ACCOUNTS IF NEEDED
              const existingByEmail = await db.query.usersTable.findFirst
              ({
                where: eq(usersTable.email, googleUser.email),
              });

              if (existingByEmail)
              {
                //LINK GOOGLE ACCOUNT TO EXISTING EMAIL ACCOUNT
                const [updated] = await db
                  .update(usersTable)
                  .set
                  ({
                    googleId: googleUser.sub,
                    avatarUrl: googleUser.picture ?? existingByEmail.avatarUrl,
                    name: existingByEmail.name ?? googleUser.name ?? null,
                  })
                  .where(eq(usersTable.id, existingByEmail.id))
                  .returning();

      // Determine redirect path
      const frontendBase = process.env["FRONTEND_URL"] || "";
      if (memberships.length === 0) {
        res.redirect(`${frontendBase}/onboarding`);
      } else {
        res.redirect(`${frontendBase}/dashboard`);
      }
    });
  } catch {
    res.status(500).json({ error: "Google authentication failed" });
  }
});

export default router;