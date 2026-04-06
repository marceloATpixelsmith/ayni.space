import test from "node:test";
import assert from "node:assert/strict";

import { ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: invitationsRouter } = await import("../routes/invitations.js");

test("invitation password acceptance returns MFA enrollment step when user is not enrolled", async () => {
  const persistedSession: Record<string, unknown> = {
    sessionGroup: "default",
    appSlug: "admin",
    activeOrgId: "org-1",
  };
  const restores = [
    patchProperty(db.query.invitationsTable, "findFirst", async () => ({
      id: "inv-1",
      token: "hashed-token",
      orgId: "org-1",
      appId: "app-1",
      email: "invitee@example.com",
      invitedRole: "staff",
      invitationStatus: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
    })),
    patchProperty(db.query.appsTable, "findFirst", async (query: unknown) => {
      const where = String((query as { where?: unknown })?.where ?? "");
      if (where.includes("slug")) {
        return {
          id: "app-1",
          slug: "admin",
          isActive: true,
          accessMode: "organization",
          staffInvitesEnabled: true,
          customerRegistrationEnabled: false,
        };
      }
      return {
        id: "app-1",
        slug: "admin",
        isActive: true,
        accessMode: "organization",
        staffInvitesEnabled: true,
        customerRegistrationEnabled: false,
      };
    }),
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "invitee@example.com",
      active: true,
      suspended: false,
      deletedAt: null,
      isSuperAdmin: false,
      activeOrgId: null,
    })),
    patchProperty(db.query.userCredentialsTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => null),
    patchProperty(db.query.orgMembershipsTable, "findMany", async () => []),
    patchProperty(db.query.orgAppAccessTable, "findFirst", async () => ({ orgId: "org-1", appId: "app-1", enabled: true })),
    patchProperty(db.query.userAuthSecurityTable, "findFirst", async () => ({ mfaRequired: true, forceMfaEnrollment: true, firstAuthAfterResetPending: false, highRiskUntilMfaAt: null })),
    patchProperty(db.query.mfaFactorsTable, "findFirst", async () => null),
    patchProperty(db.query.trustedDevicesTable, "findFirst", async () => null),
    patchProperty(db, "insert", () => ({
      values: async () => ([]),
    } as never)),
    patchProperty(db, "update", () => ({
      set: () => ({
        where: async () => ([]),
      }),
    } as never)),
  ];

  try {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { session: Record<string, unknown> }).session = {
        id: "test-session-id",
        destroy: (cb?: (err?: unknown) => void) => cb?.(),
        save(this: Record<string, unknown>, cb?: (err?: unknown) => void) {
          Object.assign(persistedSession, this);
          cb?.();
        },
        regenerate(this: Record<string, unknown>, cb?: (err?: unknown) => void) {
          for (const key of Object.keys(this)) {
            delete this[key];
          }
          this.id = "regenerated-session-id";
          this.destroy = (done?: (err?: unknown) => void) => done?.();
          this.save = (done?: (err?: unknown) => void) => {
            Object.assign(persistedSession, this);
            done?.();
          };
          this.regenerate = (done?: (err?: unknown) => void) => done?.();
          cb?.();
        },
        ...persistedSession,
      };
      next();
    });
    app.use("/api", invitationsRouter);

    const response = await performJsonRequest(app, "POST", "/api/invitations/token-1/accept-email", {
      password: "Password1!",
    });

    assert.equal(response.status, 202);
    assert.equal(response.body?.mfaRequired, true);
    assert.equal(response.body?.nextStep, "mfa_enroll");
    assert.equal(response.body?.nextPath, "/mfa/enroll");
    assert.equal(
      (persistedSession.pendingPostAuthContinuation as { returnPath?: string } | undefined)
        ?.returnPath,
      "/invitations/token-1/accept",
    );
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
