import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { deriveInviteeName, renderInvitationTemplate, sendLane1InvitationEmail, sendLane1PasswordResetEmail } = await import("../lib/invitationEmail.js");
const { validateTemplateTokens } = await import("../lib/emailTemplates.js");
const { default: invitationsRouter } = await import("../routes/invitations.js");

test("invitation token renderer replaces allowlisted tokens and preserves unknown tokens", () => {
  const rendered = renderInvitationTemplate(
    "Hi {{ invitee_email }} from {{app_name}} {{unknown_token}}",
    {
      invitee_email: "invitee@example.com",
      invitee_name: "",
      inviter_name: "Owner",
      app_name: "Ayni",
      organization_name: "Org One",
      invitation_url: "https://app.example/invitations/tok/accept",
      expires_at: "2030-04-10T00:00:00.000Z",
    },
    { escapeValues: false },
  );

  assert.equal(rendered, "Hi invitee@example.com from Ayni {{unknown_token}}");
});

test("invitation token renderer deterministically escapes html values and empty missing values", () => {
  const rendered = renderInvitationTemplate(
    "<a href='{{invitation_url}}'>{{invitee_name}}</a>",
    {
      invitee_email: "invitee@example.com",
      invitee_name: "",
      inviter_name: "Owner",
      app_name: "Ayni",
      organization_name: "Org One",
      invitation_url: "https://app.example/?q=<script>",
      expires_at: "2030-04-10T00:00:00.000Z",
    },
    { escapeValues: true },
  );

  assert.equal(rendered, "<a href='https://app.example/?q=&lt;script&gt;'></a>");
});

test("invitee_name derivation is deterministic for full and partial names", () => {
  assert.equal(deriveInviteeName({ firstName: " Ada ", lastName: " Lovelace " }), "Ada Lovelace");
  assert.equal(deriveInviteeName({ firstName: " Ada ", lastName: "" }), "Ada");
  assert.equal(deriveInviteeName({ firstName: "", lastName: " Lovelace " }), "Lovelace");
  assert.equal(deriveInviteeName({ firstName: " ", lastName: " " }), "");
});

test("lane1 invitation sender uses app sender/template config and logs lane1 outcome", async () => {
  process.env["PLATFORM_BREVO_API_KEY"] = "test-key";
  process.env["ALLOWED_ORIGINS"] = "https://app.example";

  let outboundLogLane: string | null = null;
  let outboundRequestedFrom: string | null = null;
  let outboundRequestedSubject: string | null = null;
  let brevoBody: Record<string, unknown> | null = null;
  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => {
      return { id: "user-1", email: "owner@example.com", name: "Owner Name", active: true, suspended: false, deletedAt: null };
    }),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-1", name: "Org One", appId: "app-1" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-1",
      slug: "ayni",
      name: "Ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      transactionalFromEmail: "invites@ayni.space",
      transactionalFromName: "Ayni Team",
      transactionalReplyToEmail: "support@ayni.space",
      invitationEmailSubject: "Join {{invitee_name}} at {{organization_name}} on {{app_name}}",
      invitationEmailHtml: "<p>Hello {{invitee_name}}</p><a href='{{invitation_url}}'>Accept</a>",
      metadata: {},
    })),
    patchProperty(db.query.emailTemplatesTable, "findFirst", async () => ({
      id: "tpl-inv-1",
      appId: "app-1",
      templateType: "invitation",
      subjectTemplate: "Join {{invitee_name}} at {{organization_name}} on {{app_name}}",
      htmlTemplate: "<p>Hello {{invitee_name}}</p><a href='{{invitation_url}}'>Accept</a>",
      textTemplate: null,
      isActive: true,
    })),
    patchProperty(db, "insert", ((_: unknown) => ({
      values: (payload: Record<string, unknown>) => {
        if ("action" in payload) return Promise.resolve([]);
        if ("token" in payload) {
          return {
            returning: async () => [{
              id: "inv-1",
              email: payload["email"],
              invitedRole: payload["invitedRole"],
              orgId: payload["orgId"],
              invitationStatus: "pending",
              expiresAt: new Date(Date.now() + 3600_000),
              createdAt: new Date(),
            }],
          };
        }
        if ("lane" in payload) {
          outboundLogLane = String(payload["lane"]);
          outboundRequestedFrom = String(payload["requestedFrom"]);
          outboundRequestedSubject = String(payload["requestedSubject"]);
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    })) as never),
    patchProperty(db, "update", (() => ({
      set: () => ({ where: async () => undefined }),
    })) as never),
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    brevoBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ messageId: "brevo-msg-1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await sendLane1InvitationEmail({
      req: { headers: { origin: "https://app.example" } } as any,
      appId: "app-1",
      orgId: "org-1",
      invitationId: "inv-1",
      invitationToken: "token-123",
      invitationExpiresAt: new Date("2030-04-10T00:00:00.000Z"),
      inviteeEmail: "invitee@example.com",
      inviteeFirstName: "Casey",
      inviteeLastName: "Johnson",
      invitedByUserId: "user-1",
      actorUserId: "user-1",
    });
    assert.equal(outboundLogLane, "lane1");
    assert.equal(outboundRequestedFrom, "invites@ayni.space");
    assert.equal(outboundRequestedSubject, "Join Casey Johnson at Org One on Ayni");
    assert.equal(((brevoBody as any)?.["sender"] as any)?.email, "invites@ayni.space");
    assert.equal(((brevoBody as any)?.["to"] as any)?.[0]?.email, "invitee@example.com");
    assert.equal(((brevoBody as any)?.["to"] as any)?.[0]?.name, "Casey Johnson");
    assert.match(
      String((brevoBody as any)?.["htmlContent"] ?? ""),
      /https:\/\/app\.example\/invitations\/token-123\/accept/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    delete process.env["PLATFORM_BREVO_API_KEY"];
  }
});

test("invitation creation fails clearly when sender/template config is missing", async () => {
  process.env["PLATFORM_BREVO_API_KEY"] = "test-key";
  process.env["ALLOWED_ORIGINS"] = "https://app.example";
  let userLookupCount = 0;

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => {
      userLookupCount += 1;
      if (userLookupCount === 2) return null;
      return { id: "user-1", email: "owner@example.com", name: "Owner Name", active: true, suspended: false, deletedAt: null };
    }),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "m-1",
      userId: "user-1",
      orgId: "org-1",
      membershipStatus: "active",
      role: "org_admin",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-1", name: "Org One", appId: "app-1" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-1",
      slug: "ayni",
      name: "Ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      transactionalFromEmail: null,
      invitationEmailSubject: null,
      invitationEmailHtml: null,
      metadata: {},
    })),
    patchProperty(db, "insert", (() => ({
      values: (payload: Record<string, unknown>) => {
        if ("action" in payload) return Promise.resolve([]);
        if ("token" in payload) {
          return {
            returning: async () => [{
              id: "inv-1",
              email: payload["email"],
              invitedRole: payload["invitedRole"],
              orgId: payload["orgId"],
              invitationStatus: "pending",
              expiresAt: new Date(Date.now() + 3600_000),
              createdAt: new Date(),
            }],
          };
        }
        return Promise.resolve([]);
      },
    })) as never),
    patchProperty(db, "update", (() => ({
      set: () => ({ where: async () => undefined }),
    })) as never),
  ];

  try {
    const app = createSessionApp(invitationsRouter, { userId: "user-1", sessionGroup: "default", appSlug: "ayni" });
    const response = await performJsonRequest(app, "POST", "/api/organizations/org-1/invitations", {
      email: "invitee@example.com",
      role: "staff",
    });

    assert.equal(response.status, 500);
  } finally {
    restores.reverse().forEach((restore) => restore());
    delete process.env["PLATFORM_BREVO_API_KEY"];
  }
});

test("invitation create persists invitee first and last name", async () => {
  process.env["PLATFORM_BREVO_API_KEY"] = "test-key";
  process.env["ALLOWED_ORIGINS"] = "https://app.example";
  let insertedInvitation: Record<string, unknown> | null = null;
  let userLookupCount = 0;

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => {
      userLookupCount += 1;
      if (userLookupCount === 2) return null;
      return { id: "user-1", email: "owner@example.com", name: "Owner Name", active: true, suspended: false, deletedAt: null };
    }),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "m-1",
      userId: "user-1",
      orgId: "org-1",
      membershipStatus: "active",
      role: "org_admin",
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-1", name: "Org One", appId: "app-1" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-1",
      slug: "ayni",
      name: "Ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      transactionalFromEmail: "invites@ayni.space",
      invitationEmailSubject: "Join {{invitee_name}}",
      invitationEmailHtml: "<p>Hello {{invitee_name}}</p>",
      metadata: {},
    })),
    patchProperty(db.query.emailTemplatesTable, "findFirst", async () => ({
      id: "tpl-inv-2",
      appId: "app-1",
      templateType: "invitation",
      subjectTemplate: "Join {{invitee_name}}",
      htmlTemplate: "<p>Hello {{invitee_name}}</p>",
      textTemplate: null,
      isActive: true,
    })),
    patchProperty(db, "insert", ((_: unknown) => ({
      values: (payload: Record<string, unknown>) => {
        if ("action" in payload || "lane" in payload) return Promise.resolve([]);
        if ("token" in payload) {
          insertedInvitation = payload;
          return {
            returning: async () => [{
              id: "inv-1",
              email: payload["email"],
              firstName: payload["firstName"],
              lastName: payload["lastName"],
              invitedRole: payload["invitedRole"],
              orgId: payload["orgId"],
              invitationStatus: "pending",
              expiresAt: new Date(Date.now() + 3600_000),
              createdAt: new Date(),
            }],
          };
        }
        return Promise.resolve([]);
      },
    })) as never),
    patchProperty(db, "update", (() => ({
      set: () => ({ where: async () => undefined }),
    })) as never),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (target.includes("api.brevo.com")) {
      return new Response(JSON.stringify({ messageId: "brevo-msg-create-name" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(url as any, init);
  }) as typeof fetch;

  try {
    const app = createSessionApp(invitationsRouter, { userId: "user-1", sessionGroup: "default", appSlug: "ayni" });
    const response = await performJsonRequest(app, "POST", "/api/organizations/org-1/invitations", {
      email: "invitee@example.com",
      firstName: "Jordan",
      lastName: "Miles",
      role: "member",
    });
    assert.equal(response.status, 201);
    assert.equal("invitationToken" in (response.body ?? {}), false);
    assert.equal(insertedInvitation?.["firstName"], "Jordan");
    assert.equal(insertedInvitation?.["lastName"], "Miles");
  } finally {
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    delete process.env["PLATFORM_BREVO_API_KEY"];
  }
});


test("invitation resend omits plaintext token in API response while email link still contains token", async () => {
  process.env["PLATFORM_BREVO_API_KEY"] = "test-key";
  process.env["ALLOWED_ORIGINS"] = "https://app.example";

  const restores = [
    patchProperty(db.query.usersTable, "findFirst", async () => ({
      id: "user-1",
      email: "owner@example.com",
      name: "Owner Name",
      active: true,
      suspended: false,
      deletedAt: null,
    })),
    patchProperty(db.query.organizationsTable, "findFirst", async () => ({ id: "org-1", name: "Org One", appId: "app-1" })),
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-1",
      slug: "ayni",
      name: "Ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      transactionalFromEmail: "invites@ayni.space",
      transactionalFromName: "Ayni Team",
      transactionalReplyToEmail: "support@ayni.space",
      invitationEmailSubject: "Join {{invitee_name}}",
      invitationEmailHtml: "<a href='{{invitation_url}}'>Accept</a>",
      metadata: {},
    })),
    patchProperty(db.query.invitationsTable, "findFirst", async () => ({
      id: "inv-1",
      orgId: "org-1",
      appId: "app-1",
      email: "invitee@example.com",
      firstName: "Casey",
      lastName: "Johnson",
      invitedRole: "member",
      invitationStatus: "pending",
      invitedByUserId: "user-1",
      expiresAt: new Date(Date.now() + 3600_000),
    })),
    patchProperty(db.query.orgMembershipsTable, "findFirst", async () => ({
      id: "m-1",
      userId: "user-1",
      orgId: "org-1",
      membershipStatus: "active",
      role: "org_admin",
    })),
    patchProperty(db.query.emailTemplatesTable, "findFirst", async () => ({
      id: "tpl-inv-resend",
      appId: "app-1",
      templateType: "invitation",
      subjectTemplate: "Join {{invitee_name}}",
      htmlTemplate: "<a href='{{invitation_url}}'>Accept</a>",
      textTemplate: null,
      isActive: true,
    })),
    patchProperty(db, "insert", ((_: unknown) => ({
      values: async () => undefined,
    })) as never),
    patchProperty(db, "update", (() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })) as never),
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
    return new Response(JSON.stringify({ messageId: "brevo-msg-resend" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const app = createSessionApp(invitationsRouter, { userId: "user-1", sessionGroup: "default", appSlug: "ayni" });
    const response = await performJsonRequest(app, "POST", "/api/organizations/org-1/invitations/inv-1/resend", {});

    assert.equal(response.status, 200);
    assert.equal("invitationToken" in (response.body ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    delete process.env["PLATFORM_BREVO_API_KEY"];
    delete process.env["ALLOWED_ORIGINS"];
  }
});

test("template validation rejects unsupported tokens for template type", () => {
  const unsupported = validateTemplateTokens("password_reset", {
    subjectTemplate: "Reset {{password_reset_url}}",
    htmlTemplate: "<p>{{unknown_token}}</p>",
    textTemplate: null,
  });
  assert.deepEqual(unsupported, ["unknown_token"]);
});

test("password reset sender resolves lane1 template and logs lane1 outcome", async () => {
  process.env["PLATFORM_BREVO_API_KEY"] = "test-key";
  process.env["ALLOWED_ORIGINS"] = "https://app.example";
  let outboundRequestedSubject: string | null = null;
  let brevoBody: Record<string, unknown> | null = null;
  const restores = [
    patchProperty(db.query.appsTable, "findFirst", async () => ({
      id: "app-1",
      slug: "ayni",
      name: "Ayni",
      isActive: true,
      accessMode: "organization",
      staffInvitesEnabled: true,
      transactionalFromEmail: "invites@ayni.space",
      transactionalFromName: "Ayni Team",
      transactionalReplyToEmail: "support@ayni.space",
      invitationEmailSubject: "Join {{invitee_name}} at {{organization_name}} on {{app_name}}",
      invitationEmailHtml: "<p>Hello {{invitee_name}}</p>",
      metadata: {},
    })),
    patchProperty(db.query.emailTemplatesTable, "findFirst", async () => ({
      id: "tpl-app-1",
      appId: "app-1",
      templateType: "password_reset",
      subjectTemplate: "Reset your password for {{app_name}}",
      htmlTemplate: "<p>Hello {{full_name}}</p><a href='{{password_reset_url}}'>Reset</a>",
      textTemplate: "Reset link: {{password_reset_url}}",
      isActive: true,
    })),
    patchProperty(db, "insert", ((_: unknown) => ({
      values: (payload: Record<string, unknown>) => {
        if ("lane" in payload) {
          outboundRequestedSubject = String(payload["requestedSubject"]);
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    })) as never),
    patchProperty(db, "update", (() => ({
      set: () => ({ where: async () => undefined }),
    })) as never),
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    brevoBody = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ messageId: "brevo-msg-reset" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await sendLane1PasswordResetEmail({
      req: { headers: { origin: "https://app.example" } } as any,
      appId: "app-1",
      appSlug: "ayni",
      userId: "user-1",
      userEmail: "user@example.com",
      userFullName: "Reset User",
      resetToken: "reset-token-123",
      expirationDateTime: "2030-04-10T00:00:00.000Z",
    });

    assert.equal(outboundRequestedSubject, "Reset your password for Ayni");
    assert.match(String((brevoBody as any)?.["htmlContent"] ?? ""), /reset-password\?token=reset-token-123/);
  } finally {
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    delete process.env["PLATFORM_BREVO_API_KEY"];
  }
});
