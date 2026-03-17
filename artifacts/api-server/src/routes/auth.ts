import { Router, type IRouter } from "express";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { writeAuditLog } from "../lib/audit.js";

const router: IRouter = Router();

//──────────────────────────────────────────────────────────────────────────────
//GET /auth/me
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

//──────────────────────────────────────────────────────────────────────────────
//GET /auth/google/url
//──────────────────────────────────────────────────────────────────────────────
router.get
(
  "/google/url",
  (req, res) =>
  {
    try
    {
      const state = randomUUID();

      req.session.oauthState = state;

      const url = buildGoogleAuthUrl(state);

      res.redirect(url);
    }
    catch
    {
      res.status(501).json
      ({
        error: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.",
      });
    }
  }
);

//──────────────────────────────────────────────────────────────────────────────
//GET /auth/google/callback
//──────────────────────────────────────────────────────────────────────────────
router.get
(
  "/google/callback",
  async (req, res) =>
  {
    const { code, state } = req.query as { code?: string; state?: string };

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

                user = updated;
              }
              else
              {
                //CREATE BRAND-NEW USER
                const [created] = await db
                  .insert(usersTable)
                  .values
                  ({
                    id: randomUUID(),
                    email: googleUser.email,
                    name: googleUser.name ?? null,
                    avatarUrl: googleUser.picture ?? null,
                    googleId: googleUser.sub,
                    isSuperAdmin: false,
                  })
                  .returning();

                user = created;

                writeAuditLog
                ({
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
              //UPDATE AVATAR/NAME FROM GOOGLE ON EACH LOGIN
              await db
                .update(usersTable)
                .set
                ({
                  avatarUrl: googleUser.picture ?? user.avatarUrl,
                  name: user.name ?? googleUser.name ?? null,
                })
                .where(eq(usersTable.id, user.id));
            }

            //UPDATE LAST LOGIN AT
            await db
              .update(usersTable)
              .set({ lastLoginAt: new Date() })
              .where(eq(usersTable.id, user.id));

            //SET SESSION
            req.session.userId = user.id;
            req.session.activeOrgId = user.activeOrgId ?? undefined;

            //CHECK IF USER HAS ANY ORGS
            const memberships = await db.query.orgMembershipsTable.findMany
            ({
              where: eq(orgMembershipsTable.userId, user.id),
            });

            writeAuditLog
            ({
              userId: user.id,
              userEmail: user.email,
              action: "user.login",
              resourceType: "user",
              resourceId: user.id,
              req,
            });

            //DETERMINE REDIRECT PATH
            const frontendBase = process.env["FRONTEND_URL"] || "";

            if (memberships.length === 0)
            {
              res.redirect(`${frontendBase}/onboarding`);
            }
            else
            {
              res.redirect(`${frontendBase}/dashboard`);
            }
          }
          catch (callbackError)
          {
            console.error("Google callback session handler error:", callbackError);
            res.status(500).json({ error: "Authentication failed" });
          }
        }
      );
    }
    catch (error)
    {
      console.error("Google OAuth callback error:", error);
      res.status(500).json({ error: "Authentication failed" });
    }
  }
);

export default router;