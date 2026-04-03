import test from "node:test";
import assert from "node:assert/strict";
import { Lane2TransactionalEmailService } from "../service";

process.env["DATABASE_URL"] ??= "postgres://postgres:postgres@localhost:5432/ayni_test";
const { InMemoryTransactionalEmailRepository } = await import("../repository");

const connection = {
  id: "conn_1",
  orgId: "org_1",
  appId: "ayni",
  provider: "brevo" as const,
  credentials: { apiKey: "key" },
};

const request = {
  orgId: "org_1",
  appId: "ayni",
  correlationId: "corr_123",
  fromEmail: "noreply@example.com",
  to: [{ email: "to@example.com" }],
  subject: "hello",
  textBody: "welcome",
};

test("service logs success path", async () => {
  const repo = new InMemoryTransactionalEmailRepository();
  const service = new Lane2TransactionalEmailService(repo, {
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
      validateConnection: async () => ({ state: "valid" as const }),
      normalizeWebhook: () => [],
    },
  });

  const output = await service.send(request, connection);
  assert.equal(output.result.status, "accepted");
  assert.equal(repo.outboundLogs.length, 1);
  assert.equal(repo.outboundLogs[0]?.["status"], "accepted");
});

test("service logs failure path", async () => {
  const repo = new InMemoryTransactionalEmailRepository();
  const service = new Lane2TransactionalEmailService(repo, {
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
      send: async () => ({
        provider: "brevo",
        status: "failed",
        deliveryState: "failed",
        error: { code: "brevo_400", message: "invalid", retryable: false },
      }),
      validateConnection: async () => ({ state: "valid" as const }),
      normalizeWebhook: () => [],
    },
  });

  const output = await service.send(request, connection);
  assert.equal(output.result.status, "failed");
  assert.equal(repo.outboundLogs.length, 1);
  assert.equal(repo.outboundLogs[0]?.["status"], "failed");
});
