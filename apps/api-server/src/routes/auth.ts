import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, usersTable, orgMembershipsTable, organizationsTable } from "@workspace/db";
import { buildGoogleAuthUrl, exchangeCodeForUser } from "../lib/auth.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { writeAuditLog } from "../lib/audit.js";
import { getAbuseClientKey, recordAbuseSignal } from "../lib/authAbuse.js";

const router = Router();

function getAllowedOrigins() {
  return (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getRequestFrontendOrigin(req: Request): string | null {
  const originHeader = req.headers["origin"];
  const origin = typeof originHeader === "string" ? originHeader.trim() : "";
  if (!origin) return null;

  return getAllowedOrigins().includes(origin) ? origin : null;
}

function firstQueryParam(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}


function logAuthFailure(req: Request, reason: string, metadata: Record<string, unknown> = {}) {
  const signal = recordAbuseSignal(`auth:${reason}:${getAbuseClientKey(req)}`);
  writeAuditLog({
    userId: req.session?.userId,
    action: signal.repeated ? "auth.failure.repeated" : "auth.failure",
    resourceType: "auth",
    resourceId: reason,
    metadata: {
      reason,
      count: signal.count,
      threshold: signal.threshold,
      ...metadata,
    },
    req,
  });
}

async function handleMe(req: Request, res: Response) {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, userId) });
  if (!user) {
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
  if (user.activeOrgId) {
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

function handleLogout(req: Request, res: Response) {
  req.session.destroy((err: unknown) => {
    if (err) {
      console.error("Session destroy error:", err);
      res.status(500).json({ error: "Failed to destroy session" });
      return;
    }

    res.clearCookie("saas.sid", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
    });
    (req as { session: unknown }).session = null;
    res.json({ success: true, message: "Logged out successfully" });
  });
}

function handleGoogleUrl(req: Request, res: Response) {
  try {
    const state = randomUUID();
    const returnTo = getRequestFrontendOrigin(req);
    if (!returnTo) {
      logAuthFailure(req, "google-url-origin-invalid");
      res.status(400).json({ error: "Request origin is missing or not allowed" });
      return;
    }
    req.session.oauthState = state;
    req.session.oauthReturnTo = returnTo;
    const url = buildGoogleAuthUrl(state);
    req.session.save((err: unknown) => {
      if (err) {
        logAuthFailure(req, "google-url-session-init-failed");
        res.status(500).json({ error: "Failed to initialize OAuth session" });
        return;
      }
      res.json({ url });
    });
  } catch {
    res.status(501).json({ error: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI." });
  }
}

async function handleGoogleCallback(req: Request, res: Response) {
  const code = firstQueryParam(req.query.code);
  const state = firstQueryParam(req.query.state);

  if (!code) {
    logAuthFailure(req, "google-callback-missing-code");
    res.status(400).json({ error: "Missing authorization code" });
    return;
  }

  if (!state || !req.session.oauthState || state !== req.session.oauthState) {
    logAuthFailure(req, "google-callback-invalid-state");
    res.status(400).json({ error: "Invalid OAuth state. Please try signing in again." });
    return;
  }

  delete req.session.oauthState;
  const oauthReturnTo = req.session.oauthReturnTo;
  delete req.session.oauthReturnTo;

  try {
    const googleUser = await exchangeCodeForUser(code);

    await new Promise((resolve, reject) => {
      req.session.regenerate((err: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(undefined);
      });
    });

    let user = await db.query.usersTable.findFirst({ where: eq(usersTable.googleSubject, googleUser.sub) });

    if (!user) {
      const existingByEmail = await db.query.usersTable.findFirst({ where: eq(usersTable.email, googleUser.email) });

      if (existingByEmail) {
        const [updated] = await db
          .update(usersTable)
          .set({
            googleSubject: googleUser.sub,
            avatarUrl: googleUser.picture ?? existingByEmail.avatarUrl,
            name: existingByEmail.name ?? googleUser.name ?? null,
          })
          .where(eq(usersTable.id, existingByEmail.id))
          .returning();
        user = updated;
      } else {
        const [created] = await db
          .insert(usersTable)
          .values({
            id: randomUUID(),
            email: googleUser.email,
            name: googleUser.name ?? null,
            avatarUrl: googleUser.picture ?? null,
            googleSubject: googleUser.sub,
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
      await db
        .update(usersTable)
        .set({
          avatarUrl: googleUser.picture ?? user.avatarUrl,
          name: user.name ?? googleUser.name ?? null,
        })
        .where(eq(usersTable.id, user.id));
    }

    if (!user) {
      res.status(500).json({ error: "Failed to resolve authenticated user" });
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    req.session.userId = user.id;
    req.session.activeOrgId = user.activeOrgId ?? undefined;
    req.session.sessionAuthenticatedAt = Date.now();


    writeAuditLog({
      userId: user.id,
      userEmail: user.email,
      action: "user.login",
      resourceType: "user",
      resourceId: user.id,
      req,
    });

    if (!oauthReturnTo) {
      logAuthFailure(req, "google-callback-missing-return-origin");
      res.status(400).json({ error: "Unable to determine return app for OAuth callback" });
      return;
    }

    const frontendBase = oauthReturnTo;
    const destination = user.isSuperAdmin ? "/dashboard" : "/unauthorized";
    res.redirect(`${frontendBase}${destination}`);
  } catch (error) {
    console.error("Google callback failed:", error);
    logAuthFailure(req, "google-callback-exception");
    res.status(500).json({ error: "Google authentication failed" });
  }
}

router.get("/me", requireAuth, handleMe);
router.post("/logout", requireAuth, handleLogout);
router.get("/google/url", handleGoogleUrl);
router.get("/google/callback", handleGoogleCallback);

export default router;
