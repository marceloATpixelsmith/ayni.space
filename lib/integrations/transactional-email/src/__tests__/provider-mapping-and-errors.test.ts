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

test("mapMailchimpPayload maps reply-to into headers", () => {
  const mapped = mapMailchimpPayload(
    { ...connection, provider: "mailchimp_transactional" as const },
    { ...request, replyTo: { email: "reply@example.com", name: "Support" } }
  );
  const message = mapped["message"] as Record<string, unknown>;
  const headers = message["headers"] as Record<string, unknown>;
  assert.equal(headers["Reply-To"], "Support <reply@example.com>");
});

test("brevo adapter normalizes error", async () => {
  const adapter = new BrevoEmailAdapter();
  const result = await adapter.send(connection, request, async () =>
    new Response(JSON.stringify({ message: "invalid" }), { status: 400 })
  );
  assert.equal(result.status, "failed");
  assert.equal(result.error?.code, "brevo_400");
  assert.equal(result.error?.provider, "brevo");
  assert.equal(result.error?.normalizedType, "provider");
});

test("brevo adapter send success maps accepted result", async () => {
  const adapter = new BrevoEmailAdapter();
  const result = await adapter.send(connection, request, async () =>
    new Response(JSON.stringify({ messageId: "brevo-123" }), { status: 201 })
  );
  assert.equal(result.status, "accepted");
  assert.equal(result.providerMessageId, "brevo-123");
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
  assert.equal(result.error?.provider, "mailchimp_transactional");
  assert.equal(result.error?.normalizedType, "provider");
});

test("mailchimp transactional adapter send success maps accepted result", async () => {
  const adapter = new MailchimpTransactionalEmailAdapter();
  const result = await adapter.send(
    { ...connection, provider: "mailchimp_transactional", credentials: { apiKey: "mc-key" } },
    request,
    async () => new Response(JSON.stringify([{ _id: "mc-1", status: "sent" }]), { status: 200 })
  );
  assert.equal(result.status, "accepted");
  assert.equal(result.providerMessageId, "mc-1");
});

test("mailchimp transactional adapter uses template endpoint when templateRef is provided", async () => {
  const adapter = new MailchimpTransactionalEmailAdapter();
  let calledUrl = "";
  await adapter.send(
    { ...connection, provider: "mailchimp_transactional", credentials: { apiKey: "mc-key" } },
    { ...request, templateRef: "welcome-template" },
    async (input) => {
      calledUrl = input;
      return new Response(JSON.stringify([{ _id: "mc-2", status: "sent" }]), { status: 200 });
    }
  );
  assert.equal(calledUrl, "https://mandrillapp.com/api/1.0/messages/send-template.json");
});

test("provider webhook normalization handles unknown types without crashing", () => {
  const brevo = new BrevoEmailAdapter();
  const mailchimp = new MailchimpTransactionalEmailAdapter();
  const brevoEvent = brevo.normalizeWebhook({ event: "mystery", "message-id": "a" });
  const mcEvent = mailchimp.normalizeWebhook({ event: "mystery", msg: { _id: "b" } });
  assert.equal(brevoEvent[0]?.normalizedEventType, "failed");
  assert.equal(mcEvent[0]?.normalizedEventType, "failed");
});
