import test from "node:test";
import assert from "node:assert/strict";
import { Lane2TransactionalEmailRuntime } from "../runtime";
import { encryptJson } from "../crypto";

const ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env["EMAIL_CREDENTIALS_ENCRYPTION_KEY"] = ENCRYPTION_KEY;
process.env["DATABASE_URL"] ??= "postgres://postgres:postgres@localhost:5432/ayni_test";
const { InMemoryTransactionalEmailRepository } = await import("../repository");

test("runtime validates connection and persists invalid credential state", async () => {
  const repo = new InMemoryTransactionalEmailRepository();
  const encrypted = encryptJson({ apiKey: "bad-key" }, ENCRYPTION_KEY);
  repo.connections.push({
    id: "conn_brevo",
    orgId: "org_1",
    appId: "app_1",
    provider: "brevo",
    encryptedCredentials: encrypted,
  });

  const runtime = new Lane2TransactionalEmailRuntime(repo as never, {
    brevo: {
      provider: "brevo",
      capabilities: {
        supportsTemplates: true,
        supportsScheduling: true,
        supportsMetadata: true,
        supportsTags: true,
        supportsInlineAttachments: true,
        supportsBatchSend: true,
        supportsWebhooks: true,
        supportsReplyTo: true,
        supportsCcBcc: true,
        supportsCustomHeaders: true,
      },
      send: async () => ({ provider: "brevo", status: "accepted", deliveryState: "accepted" }),
      validateConnection: async () => ({ state: "invalid", error: "bad key" }),
      normalizeWebhook: () => [],
    },
    mailchimp_transactional: {
      provider: "mailchimp_transactional",
      capabilities: {
        supportsTemplates: true,
        supportsScheduling: true,
        supportsMetadata: true,
        supportsTags: true,
        supportsInlineAttachments: true,
        supportsBatchSend: true,
        supportsWebhooks: true,
        supportsReplyTo: true,
        supportsCcBcc: true,
        supportsCustomHeaders: true,
      },
      send: async () => ({ provider: "mailchimp_transactional", status: "accepted", deliveryState: "accepted" }),
      validateConnection: async () => ({ state: "valid" }),
      normalizeWebhook: () => [],
    },
  });

  const result = await runtime.validateConnection("conn_brevo");
  assert.equal(result.state, "invalid");
  assert.equal((repo.connections[0] as Record<string, unknown>)["lastValidationStatus"], "invalid");
});

test("runtime correlates webhook events and updates delivery state", async () => {
  const repo = new InMemoryTransactionalEmailRepository();
  repo.outboundLogs.push({
    id: "log_1",
    provider: "brevo",
    providerMessageId: "brevo-msg-1",
    deliveryState: "accepted",
  });

  const runtime = new Lane2TransactionalEmailRuntime(repo as never, {
    brevo: {
      provider: "brevo",
      capabilities: {
        supportsTemplates: true,
        supportsScheduling: true,
        supportsMetadata: true,
        supportsTags: true,
        supportsInlineAttachments: true,
        supportsBatchSend: true,
        supportsWebhooks: true,
        supportsReplyTo: true,
        supportsCcBcc: true,
        supportsCustomHeaders: true,
      },
      send: async () => ({ provider: "brevo", status: "accepted", deliveryState: "accepted" }),
      validateConnection: async () => ({ state: "valid" }),
      normalizeWebhook: () => [
        {
          provider: "brevo",
          rawProviderEventType: "delivered",
          normalizedEventType: "delivered",
          providerMessageId: "brevo-msg-1",
          rawPayload: { event: "delivered" },
        },
      ],
    },
    mailchimp_transactional: {
      provider: "mailchimp_transactional",
      capabilities: {
        supportsTemplates: true,
        supportsScheduling: true,
        supportsMetadata: true,
        supportsTags: true,
        supportsInlineAttachments: true,
        supportsBatchSend: true,
        supportsWebhooks: true,
        supportsReplyTo: true,
        supportsCcBcc: true,
        supportsCustomHeaders: true,
      },
      send: async () => ({ provider: "mailchimp_transactional", status: "accepted", deliveryState: "accepted" }),
      validateConnection: async () => ({ state: "valid" }),
      normalizeWebhook: () => [],
    },
  });

  const count = await runtime.ingestWebhook("brevo", { event: "delivered" });
  assert.equal(count, 1);
  assert.equal(repo.webhookEvents.length, 1);
  assert.equal(repo.webhookEvents[0]?.["linkedOutboundEmailLogId"], "log_1");
  assert.equal(repo.outboundLogs[0]?.["deliveryState"], "delivered");
});
