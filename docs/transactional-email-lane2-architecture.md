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
- No webhook ingestion routes yet (schema + repository hooks are in place).
- No provider credential verification endpoint/job yet (fields exist to support it).
