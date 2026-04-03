# Transactional Email Lane 2 Foundation

## Scope
- Defines the provider-agnostic transactional email foundation for **Lane 2 only** (tenant/org-owned customer transactional email).
- Lane 1 (platform-owned credentials) is intentionally out of scope for this PR.

## Lane model
- **Lane 1**: app/platform-owned credentials for platform notifications (not implemented here).
- **Lane 2**: org-owned credentials used to send org/customer transactional email through tenant-configured providers.

## Confirmed implementation
- New shared backend package: `lib/integrations/transactional-email`.
- Supported providers in this foundation:
  - `brevo`
  - `mailchimp_transactional`
- API-based adapters only (no SMTP transport in this phase).

## Normalized send contract
Defined in `lib/integrations/transactional-email/src/types.ts` as `Lane2TransactionalEmailRequest` and includes:
- sender fields (`fromEmail`, `fromName`, `replyTo`)
- recipients (`to`, `cc`, `bcc`)
- content (`subject`, `textBody`, `htmlBody`)
- template support (`templateRef`, `templateParams`)
- attachments (regular and inline)
- tags and metadata
- custom headers
- scheduling (`scheduledAt`)
- tracking options
- idempotency/correlation identifiers
- tenant/app/actor context
- provider-specific extension bag (`providerOptions`)

## Capability model
Defined in `lib/integrations/transactional-email/src/capabilities.ts` and enforced by `validateLane2Request`:
- supportsTemplates
- supportsScheduling
- supportsMetadata
- supportsTags
- supportsInlineAttachments
- supportsBatchSend
- supportsWebhooks
- supportsReplyTo
- supportsCcBcc
- supportsCustomHeaders

Unsupported requested features fail closed with explicit validation errors; functionality is not silently dropped.

Current provider-specific capability notes:
- Brevo: metadata is currently **not** exposed as a normalized provider capability (`supportsMetadata=false`) because the adapter does not map normalized metadata to a first-class Brevo metadata field.
- Mailchimp Transactional: metadata is supported through the Mandrill `message.metadata` field.

## Normalized send result
Defined as `Lane2SendResult` with:
- status (`accepted`, `queued`, `rejected`, `failed`)
- normalized delivery state
- provider identity
- provider message/request ids when available
- normalized error object
- sanitized provider response snapshot

## Platform schema additions
Added in migration `lib/db/migrations/20260403_lane2_transactional_email_foundation.sql`:
- `platform.tenant_email_provider_connections`
- `platform.outbound_email_logs`
- `platform.email_webhook_events`
- enums:
  - `email_provider`
  - `email_connection_status`
  - `email_lane`
  - `email_attempt_result`
  - `email_delivery_state`
  - `email_normalized_event_type`

## Secret handling
- Provider credentials are stored encrypted at rest in `tenant_email_provider_connections.encrypted_credentials`.
- Encryption helper (`encryptJson`/`decryptJson`) uses AES-256-GCM and requires a 64-hex-byte key (environment-supplied by caller).
- Secrets are never persisted in plaintext snapshots.

## Logging model
- Every send attempt creates a record in `platform.outbound_email_logs`.
- Immediate send outcome updates the same log with status, delivery state, normalized error, and provider ids.
- Future webhook/activity events are normalized into `platform.email_webhook_events` and can be linked back to outbound logs.
- Request/response snapshots are sanitized to redact secret-bearing keys and attachment base64 blobs.

## Future superadmin visibility support
The persistence model is intentionally queryable for future superadmin tooling:
- what was requested
- whether provider accepted/rejected immediately
- normalized error details
- provider identifiers for reconciliation
- later event stream/state transitions via webhook logs

## Known intentional gaps (next PR)
- No Lane 1 runtime integration yet.
- No org-facing UI/superadmin UI yet.

## Live send execution pipeline (implemented)
- Internal send entrypoint: `POST /api/organizations/:orgId/transactional-email/send`.
- Runtime flow (`lib/integrations/transactional-email/src/runtime.ts` + `service.ts`):
  1. Resolve org/app active provider connection from `platform.tenant_email_provider_connections`.
  2. Decrypt credentials from `encrypted_credentials` using `EMAIL_CREDENTIALS_ENCRYPTION_KEY`.
  3. Validate request with provider capability model (`validateLane2Request`).
  4. Persist pre-send `platform.outbound_email_logs` row.
  5. Execute provider API call via adapter.
  6. Persist normalized send result + provider IDs/error snapshot.
  7. Return normalized lane2 result to caller.
- All provider call exceptions are normalized and persisted as failed attempts (no silent drop).

## Provider integrations (implemented)
- Brevo adapter (`adapters/brevo.ts`):
  - Sends via `POST https://api.brevo.com/v3/smtp/email`.
  - Connection validation via `GET https://api.brevo.com/v3/account`.
  - Webhook normalization map includes: sent, delivered, open, click, hard/soft bounce, blocked, spam, deferred, unsubscribed, invalid.
- Mailchimp Transactional adapter (`adapters/mailchimp-transactional.ts`):
  - Sends via:
    - `POST https://mandrillapp.com/api/1.0/messages/send.json` (non-template sends)
    - `POST https://mandrillapp.com/api/1.0/messages/send-template.json` (template sends)
  - Connection validation via `POST https://mandrillapp.com/api/1.0/users/ping2.json`.
  - Webhook normalization map includes: send, deferral, hard/soft bounce, open, click, spam, unsub, reject.

## Webhook ingestion flow (implemented)
- Endpoints:
  - `POST /api/transactional-email/webhooks/brevo`
  - `POST /api/transactional-email/webhooks/mailchimp-transactional`
- Flow:
  1. Accept provider payload.
  2. Optional signature check when env secret configured (`BREVO_WEBHOOK_SECRET`, `MAILCHIMP_TRANSACTIONAL_WEBHOOK_KEY`).
  3. Preserve full raw payload in `platform.email_webhook_events.raw_payload`.
  4. Normalize provider event type to unified delivery state.
  5. Correlate by provider message id to `platform.outbound_email_logs`.
  6. Update outbound log delivery state while preserving event history.
- Unknown/unmapped provider event types do not crash processing; they normalize to `failed` and are still stored.

## Delivery event/state model
- Supported normalized states in lane2 runtime:
  - `accepted`, `sent`, `delivered`, `opened`, `clicked`, `bounced_soft`, `bounced_hard`, `deferred`, `complained`, `unsubscribed`, `blocked`, `rejected`, `failed`
- Multiple events per provider message are stored in `platform.email_webhook_events`.
- Delivery state in `platform.outbound_email_logs` is updated over time by newest ingested event.

## Correlation strategy (implemented)
- Send-time correlation fields:
  - `correlationId` from request into `platform.outbound_email_logs.correlation_id`.
  - Generated outbound `logId` persisted as `platform.outbound_email_logs.id`.
  - Adapter payload enrichment with:
    - metadata `ayni_correlation_id`
    - metadata `ayni_outbound_log_id`
    - headers `x-ayni-correlation-id`
    - headers `x-ayni-outbound-log-id`
- Webhook-time correlation:
  - Primary key: `(provider, provider_message_id)` lookup into outbound logs.
  - Linked event row stores `linked_outbound_email_log_id`.

## Connection validation behavior (implemented)
- Internal validation entrypoint: `POST /api/organizations/:orgId/transactional-email/connections/:connectionId/validate`.
- Validation writes:
  - `last_validated_at`
  - `last_validation_status` (`valid` | `invalid` | `degraded`)
  - `last_validation_error` (sanitized, non-secret)
- Connection `status` is updated to:
  - `validated` when state is `valid`
  - `invalid` when state is `invalid` or `degraded`

## Org-admin and superadmin management/query APIs (implemented)
- Org-admin (org scoped; requires org-admin membership in the target org):
  - `POST /api/organizations/:orgId/transactional-email/connections`
  - `GET /api/organizations/:orgId/transactional-email/connections`
  - `PATCH /api/organizations/:orgId/transactional-email/connections/:connectionId`
  - `POST /api/organizations/:orgId/transactional-email/connections/:connectionId/rotate-credential`
  - `POST /api/organizations/:orgId/transactional-email/connections/:connectionId/deactivate`
  - `POST /api/organizations/:orgId/transactional-email/connections/:connectionId/reactivate`
  - `POST /api/organizations/:orgId/transactional-email/connections/:connectionId/validate`
  - `GET /api/organizations/:orgId/transactional-email/logs`
  - `GET /api/organizations/:orgId/transactional-email/logs/:logId`
  - `GET /api/organizations/:orgId/transactional-email/logs/:logId/events`
  - `GET /api/organizations/:orgId/transactional-email/events`
- Superadmin (platform scope; requires superadmin session):
  - `GET /api/admin/transactional-email/logs`
  - `GET /api/admin/transactional-email/logs/:logId`
  - `GET /api/admin/transactional-email/events`
  - `GET /api/admin/transactional-email/connections`

## Connection model decision (implemented)
- Active-send resolution remains one active connection per `(org_id, app_id)` at runtime.
- When creating a new active connection for an org+app or reactivating an existing connection, other active connections for that same org+app are deactivated (`is_active=false`, `status=disabled`).
- Historical/inactive records remain queryable for audit/history (when `includeInactive=true`).

## Redaction and secret hygiene (implemented)
- Secrets are accepted only on create/rotate endpoints and encrypted at rest (`encrypted_credentials`).
- Secrets are never returned by management/query APIs.
- Connection responses return:
  - metadata (`provider`, `status`, sender defaults, validation timestamps/results)
  - redacted credential summary only (`redactedCredential`)
  - key version metadata (`credentialKeyVersion`)
- Validation responses are sanitized to redact token-like strings from diagnostics.
- Log/event query responses never return decrypted credential material.

## Query/filter capabilities (implemented)
- Outbound log list supports filters:
  - `orgId` (org endpoints fixed by path; admin optional query)
  - `appId`
  - `provider`
  - `connectionId`
  - `status` (attempt result)
  - `deliveryState`
  - `dateFrom`, `dateTo`
  - `recipient` (org endpoint post-filter)
  - `subject`
  - `providerMessageId`
  - `correlationId`
  - `lane` fixed to `lane2`
  - pagination: `limit`, `offset`
- Delivery event list supports filters:
  - `provider`
  - `eventType` (normalized delivery event state)
  - `providerMessageId`
  - `recipient`
  - `logId` (linked outbound log)
  - `dateFrom`, `dateTo`
  - pagination: `limit`, `offset`

## Intended future UI integration path
- These APIs are backend-only and intentionally UI-ready through:
  - stable org-admin scoped management endpoints
  - superadmin platform query endpoints
  - redacted response shapes for safe rendering in admin surfaces
- UI implementation is explicitly deferred to a future PR.

## Provider differences handled
- Brevo template id is numeric (`templateId`), Mailchimp Transactional supports message template merge vars differently.
- Mailchimp Transactional returns per-recipient array statuses; lane2 runtime uses first response object as immediate attempt result.
- Signature validation semantics differ and are optional unless the relevant env secret is configured.
