import test from "node:test";
import assert from "node:assert/strict";
import { BrevoEmailAdapter, mapBrevoPayload } from "../adapters/brevo";
import { MailchimpTransactionalEmailAdapter, mapMailchimpPayload } from "../adapters/mailchimp-transactional";

const connection = {
  id: "conn_1",
  orgId: "org_1",
  appId: "ayni",
  provider: "brevo" as const,
  credentials: { apiKey: "secret" },
};

const request = {
  orgId: "org_1",
  appId: "ayni",
  correlationId: "corr_1",
  fromEmail: "noreply@example.com",
  to: [{ email: "to@example.com" }],
  subject: "subject",
  textBody: "text",
  htmlBody: "<b>text</b>",
  tags: ["welcome"],
  metadata: { campaign: "onboarding" },
};

test("mapBrevoPayload maps normalized payload", () => {
  const mapped = mapBrevoPayload(request);
  assert.equal(mapped["subject"], "subject");
  assert.deepEqual(mapped["to"], [{ email: "to@example.com" }]);
});

test("mapMailchimpPayload maps normalized payload", () => {
  const mapped = mapMailchimpPayload({ ...connection, provider: "mailchimp_transactional" as const }, request);
  const message = mapped["message"] as Record<string, unknown>;
  assert.equal(message["subject"], "subject");
});

test("brevo adapter normalizes error", async () => {
  const adapter = new BrevoEmailAdapter();
  const result = await adapter.send(connection, request, async () =>
    new Response(JSON.stringify({ message: "invalid" }), { status: 400 })
  );
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "brevo_400");
});

test("mailchimp adapter normalizes rejection", async () => {
  const adapter = new MailchimpTransactionalEmailAdapter();
  const result = await adapter.send(
    { ...connection, provider: "mailchimp_transactional", credentials: { apiKey: "mc-key" } },
    request,
    async () =>
      new Response(
        JSON.stringify([{ _id: "abc", status: "rejected", reject_reason: "hard-bounce" }]),
        { status: 200 }
      )
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.deliveryState, "rejected");
});
