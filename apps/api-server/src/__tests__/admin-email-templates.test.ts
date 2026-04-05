import test from "node:test";
import assert from "node:assert/strict";
import { createSessionApp, ensureTestDatabaseEnv, patchProperty, performJsonRequest } from "./helpers.js";

ensureTestDatabaseEnv();

const { db } = await import("@workspace/db");
const { default: adminRouter } = await import("../routes/admin.js");

test("admin preview rejects unsupported template tokens", async () => {
  const restores = [
    patchProperty(db.query.emailTemplatesTable, "findFirst", async () => ({
      id: "tpl-default",
      appId: null,
      templateType: "password_reset",
      subjectTemplate: "Reset {{app_name}}",
      htmlTemplate: "<p>{{password_reset_url}}</p>",
      textTemplate: null,
      isActive: true,
    })),
  ];

  try {
    const app = createSessionApp(adminRouter, { userId: "super-1", isSuperAdmin: true });
    const response = await performJsonRequest(app, "POST", "/api/apps/app-1/email-templates/password_reset/preview", {
      subjectTemplate: "Reset {{app_name}}",
      htmlTemplate: "<p>{{unknown_token}}</p>",
    });

    assert.equal(response.status, 400);
    assert.deepEqual(response.body?.unsupportedTokens, ["unknown_token"]);
  } finally {
    restores.reverse().forEach((restore) => restore());
  }
});
