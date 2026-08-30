# hqbase shared inbox — customization requirements

> Issue: FOU-39 (`[FOU-X4] customization requirements intake`)
> Epic: FOU-35 (`hqbase shared inbox`)
> Role: Integration Planner
> Audience: FOU-40..43 (Stage 2 implementers) and the Epic owner

This document turns the spoken customization wishlist into user stories that
Stage 2 implementers can act on without renegotiating scope. Each story has a
priority, an acceptance check, and a list of the modules (API / app / worker /
migrations) that own it. The second half pins the Stage 2 module boundary so
FOU-40..43 cannot drift into each other.

## How to read this document

- **Priority** uses MoSCoW: **Must** (Stage 2 blocks on this), **Should**
  (Stage 2 lands this if time allows), **Could** (Stage 3+ candidate).
- **Module** lists the directories in `Nibilu/hqbase` whose owners must touch
  the story. Use it to triage incoming work: a story whose modules all sit in
  one Stage 2 ticket is owned by that ticket; a story that crosses boundaries
  is split at the lines in "Stage 2 input contract".
- **Acceptance** is the smallest set of checks that proves the story is
  shippable. Tests, lint, typecheck, and the deployment dry-run must stay
  green; any custom-code gate is additive.

## Existing extension points the stories sit on top of

The stories below are not greenfield. They land on top of these upstream
artifacts. Stage 2 implementers must read these before adding new code so the
change matches the shape the codebase already has.

- **Identity boundary** — `principals` table (`migrations/0017_agent_principals.sql`)
  plus `mailbox_grants.principal_id` replace legacy `user_id` columns. Both
  user and agent identities live on the same row type.
- **Mailbox access control** — `mailbox_grants (mailbox_id, principal_id, access_level)`
  with levels `read`, `agent`, `manager`. Enforced in
  `worker/auth/mailbox-access.ts` and `worker/auth/permissions.ts`.
- **Audit log** — `audit_events` (`worker/db/schema-core.ts`, written by
  `worker/features/audit/service.ts`, exposed by `worker/features/audit/routes.ts`).
  `recordAudit` rejects a fixed set of sensitive metadata keys.
- **Email signatures** — `email_signatures` scoped to user / mailbox / mail
  domain (`worker/features/signatures/`, `migrations/0021_email_signatures.sql`).
- **Rate limit** — `rate_limits` table with sliding-window enforcement in
  `worker/security/rate-limit.ts` (`enforceRateLimit`).
- **Webhooks** — `worker/features/notifications/` is the durable-object-driven
  delivery path; outbound URLs are not yet customer-configurable.
- **Frontend theming** — `app/styles.css`, `tailwind.config.ts`, `components.json`,
  `biome.json`. No runtime theme API yet; assets are bundled.

## Candidate requirements

Each story carries: an ID for tracking, a user story, a priority, an
acceptance list, and module ownership.

### R-01 — Multi-tenant isolation (organization boundary)

**User story.** As a managed-service operator I want each customer deployment
to own its data, configuration, and rate-limit budget inside a single HQBase
fork instance, so I can run one Cloudflare account with many customers
without cross-tenant data leaks.

**Priority.** Must (Foundational).

**Scope detail.**
- A new top-level `organizations` table keyed by `organization_id` (UUID),
  with `slug`, `display_name`, `created_at`, `status` (`active` / `disabled`).
- Every existing row that already represents a tenant boundary
  (`mailboxes`, `mail_domains`, `email_signatures`, `audit_events`,
  `rate_limits`, `installation_identity`) gains a nullable
  `organization_id` column; the migration backfills a single sentinel
  organization for existing rows so the migration is non-breaking.
- All existing queries in `worker/auth/`, `worker/features/`, and the
  audit logger gain a `WHERE organization_id = :oid` predicate; the value
  comes from a `request.organizationId` resolver that reads either the
  authenticated principal's home organization or an explicit header on
  operator endpoints.
- Per-organization rate-limit budgets live alongside the existing global
  `rate_limits` rows: a `scope` value of `org:<oid>:<operation>` is allowed.

**Acceptance.**
- New install path creates one default organization during setup.
- Existing install path upgrades cleanly: `pnpm db:migrate:local` and
  `wrangler d1 migrations apply` both succeed; no row is lost.
- `pnpm test` passes; new integration tests assert cross-tenant reads are
  rejected with `403 TENANT_MISMATCH`.
- Audit query for a user in tenant A never returns rows owned by tenant B,
  even when the query is crafted by a manager.

**Modules.** API (`api/`), worker (`worker/`), migrations
(`migrations-after-deploy/`), tests (`test/`).

---

### R-02 — Branding and theme per organization

**User story.** As an organization owner I want to upload a logo, pick a
color palette, and override product copy for my tenant, so my shared inbox
looks like our product rather than HQBase.

**Priority.** Must.

**Scope detail.**
- New `organization_branding` table: `organization_id` (PK, FK to R-01),
  `logo_r2_key`, `palette_json` (CSS variable map), `copy_overrides_json`
  (i18n key -> string), `email_signature_html_snapshot`, `updated_by_principal_id`,
  `updated_at`. Stored JSON only; no free-form HTML uploads outside the
  signature slot.
- API surface: `GET/PUT /api/organizations/:oid/branding` (manager only).
  Upload uses a presigned R2 URL (`POST /api/organizations/:oid/branding/logo-upload`)
  returning an `uploadUrl` and the eventual `r2_key`.
- Worker applies branding by serving `app/styles.css` with a server-injected
  `:root { ... }` block and serving the logo through a Worker route
  `/api/organizations/:oid/branding/logo` that streams from R2.
- Frontend reads branding on app boot via a single TanStack Query and writes
  CSS variables on `document.documentElement`. No `biome.json` exceptions;
  components stay in `components.json`.
- Two preset palettes ship in code as fall-back when no branding row exists.

**Acceptance.**
- Switching palettes in dev is visible after a single page reload.
- Removing the branding row falls back to the default palette without a
  broken UI.
- Logo upload accepts PNG and SVG only, rejects other MIME types with
  `415`.
- `pnpm lint` and `pnpm test` stay green; new unit tests cover the CSS
  variable injection and the upload route.

**Modules.** API (`api/`), app (`app/`), worker (`worker/`),
migrations (`migrations-after-deploy/`), tests (`test/`).

---

### R-03 — Configurable outbound email signature (per organization)

**User story.** As an organization owner I want to set a default email
signature that every outbound message from my tenant carries, so my team
sends consistent mail without editing each draft.

**Priority.** Should.

**Scope detail.**
- Extend `email_signatures` with a fourth scope key `organization_id` that
  points at the R-01 organization. The existing `CHECK` constraint
  `(user_id IS NOT NULL) + (mailbox_id IS NOT NULL) + (mail_domain_id IS NOT NULL) = 1`
  becomes `= 1` over four scopes.
- The signature resolution order in
  `worker/features/signatures/service.ts` becomes:
  `user > mailbox > organization > mail_domain`. The new layer sits between
  mailbox and mail domain.
- Frontend signature picker in the draft composer shows four buckets.

**Acceptance.**
- Existing signatures keep working; legacy scopes keep their unique indexes.
- New organization-scoped signature beats mail-domain default in tests.
- `pnpm test` and a fresh-install migration test stay green.

**Modules.** Worker (`worker/`), migrations (`migrations-after-deploy/`),
tests (`test/`).

---

### R-04 — Custom email parsing rules (header and attachment)

**User story.** As an organization owner I want to declare custom parsing
rules — drop a header, tag a message, or trigger a worker action on an
attachment MIME type — so inbound mail lands in the right bucket before a
human sees it.

**Priority.** Should.

**Scope detail.**
- New `parsing_rules` table: `id`, `organization_id`, `match_kind`
  (`header`, `attachment_mime`, `subject_regex`), `match_spec_json`,
  `action_kind` (`tag`, `assign`, `reject`, `webhook`), `action_spec_json`,
  `priority INTEGER`, `enabled INTEGER`, `created_by_principal_id`,
  `updated_at`. Index on `(organization_id, enabled, priority DESC)`.
- Worker applies rules during `handleInboundEmail` in `worker/email/inbound.ts`,
  after MIME parsing and before audit persistence. Rule order is stable
  within a priority band; lower `priority` runs first.
- API surface: `GET/POST/PUT/DELETE /api/organizations/:oid/parsing-rules`
  (manager only). Each rule exposes a dry-run endpoint
  `POST /api/organizations/:oid/parsing-rules/:id/dry-run` that takes a
  synthetic message blob and returns the projected actions without writing.

**Acceptance.**
- Rules with `enabled = 0` are never invoked, verified by a unit test.
- A header-drop rule on `X-Internal-Score` removes that header before
  persistence; the original header is recorded in the audit event metadata
  (sanitized) for traceability.
- An attachment MIME rule that triggers a webhook fires the webhook
  delivery path in `worker/features/notifications/` with an idempotency key.
- Dry-run does not write and does not enqueue outbound side effects.

**Modules.** Worker (`worker/`), API (`api/`), migrations
(`migrations-after-deploy/`), tests (`test/`).

---

### R-05 — Attachment OCR

**User story.** As an organization owner I want attachments (PDF and image)
to be OCR'd so the search index includes the body of scans and signed PDFs,
so my team can find mail by content.

**Priority.** Could (deferred unless the customer commits to Cloudflare
Workers AI).

**Scope detail.**
- A new durable object `AttachmentOcrJob` enqueues an OCR task after a
  successful `worker/email/inbound.ts` parse; the worker calls Cloudflare
  Workers AI (`@cf/openai/whisper` for audio, `@cf/microsoft/resnet-50`
  is **not** the right model — this should use the document understanding
  model) and writes the result to `attachment_text` (new column on
  `attachments`).
- The new column is indexed for FTS via SQLite FTS5; the search feature
  queries both subject/body and `attachment_text`.
- A per-organization toggle `ocr_enabled` on `organizations` controls
  whether OCR runs; orgs with it off skip the queue entirely.

**Acceptance.**
- Search results for a query that only matches OCR'd text include the
  source message.
- OCR failure does not block message persistence: a failed job logs an
  audit event with `outcome = failure` and the original message stays
  searchable by header.

**Modules.** Worker (`worker/`), migrations (`migrations-after-deploy/`),
tests (`test/`).

---

### R-06 — Audit log: retention, export, and notification

**User story.** As an organization owner I want to (a) export the audit log
in NDJSON, (b) push a copy of each event to a customer-owned endpoint, and
(c) keep audit rows for the retention period I choose, so I can satisfy
compliance reviews without losing visibility into recent activity.

**Priority.** Must.

**Scope detail.**
- New `audit_export_jobs` table tracks an export request from
  `POST /api/organizations/:oid/audit/exports` until completion; the worker
  streams rows to R2 as NDJSON (`audit-exports/<oid>/<job>.ndjson`) and
  writes a manifest with row count and SHA-256.
- New `audit_subscriptions` table: `organization_id`, `endpoint_url`,
  `signing_secret_kid`, `event_filter_json`, `enabled`. Worker delivers
  signed POSTs through the existing notifications durable object.
- `retention_policies` already exists at the mailbox level; add an
  organization-level `audit_retention_days` column with a daily cron
  (`worker/jobs/`) that purges rows older than the configured window.
- The sensitive-metadata blocklist in
  `worker/features/audit/service.ts` is extended by tenant config: an
  organization may add additional keys to `forbiddenMetadata`.

**Acceptance.**
- Export endpoint returns `202` with a job id; the job completes within the
  declared timeout (synthetic test: 1000 rows export in under 10 seconds).
- Subscription deliveries include an `X-HQBase-Signature` header computed
  with the per-organization signing secret and a delivery id in the body.
- Retention cron is disabled by default; enabling it requires a manager
  role and writes an audit event of its own.

**Modules.** Worker (`worker/`), API (`api/`), migrations
(`migrations-after-deploy/`), tests (`test/`).

---

### R-07 — Login audit (session lifecycle)

**User story.** As an organization owner I want every login, logout, and
session refresh recorded in the audit log, so I can review who accessed the
tenant and when.

**Priority.** Must.

**Scope detail.**
- Extend `worker/features/audit/service.ts` callers in
  `worker/auth/session.ts`, `worker/auth/oauth-token.ts`, and
  `worker/auth/oauth-principal.ts` to call `recordAudit` with
  `action` values `session.create`, `session.refresh`, `session.revoke`,
  `session.denied`.
- The audit row carries `actor_type = user`, `actor_id = principal_id`,
  `resource_type = session`, `resource_id = session.id`, and metadata
  limited to non-sensitive fields (`client_ip_hash`, `user_agent_class`).
- Login from a new device triggers `outcome = success` but with
  `metadata.first_seen_device = true`, computed by hashing
  `(user_agent_class, ip_class, principal_id)`.

**Acceptance.**
- A successful login, a failed login (wrong password), and a forced
  logout all appear in the audit query within one second.
- `forbiddenMetadata` still rejects `address`, `body`, `password`,
  `token`, etc.; a regression test confirms those keys are filtered.

**Modules.** Worker (`worker/`), tests (`test/`).

---

### R-08 — SSO / OIDC integration

**User story.** As an organization owner I want to federate login to my
identity provider (Google Workspace, Microsoft Entra, 飞书, generic OIDC)
so my team signs in with their work account and I can revoke access from
one place.

**Priority.** Should.

**Scope detail.**
- New `organization_sso` table: `organization_id` (PK), `provider`
  (`google`, `microsoft`, `feishu`, `oidc`), `client_id`,
  `client_secret_kid` (refs `secrets`), `discovery_url`,
  `scopes_csv`, `default_role` (`member` / `admin`), `enabled`.
- Worker `auth/oauth-principal.ts` adds a per-organization discovery flow:
  on first login from a new organization, the worker fetches and caches the
  discovery document with a 24-hour TTL keyed by `discovery_url`.
- API surface: `GET/PUT /api/organizations/:oid/sso` (manager only) and
  `GET /api/auth/sso/:orgSlug/start` (unauthenticated, redirects to IdP).
- Just-in-time provisioning: on a successful callback, the worker creates
  a `principals` row of type `user` for unknown emails that match the
  organization allow-list (`organization_sso_allowed_domains` table).

**Acceptance.**
- Login with the configured Google Workspace succeeds; revoking the app
  in Google admin blocks the next login attempt.
- A second organization cannot trigger SSO login against another
  organization's `client_id`.
- `client_secret` is never logged, never returned by any GET endpoint,
  and is fetched by kid from `secrets`.

**Modules.** Worker (`worker/`), API (`api/`), migrations
(`migrations-after-deploy/`), tests (`test/`).

---

### R-09 — Per-organization API rate limit and quota

**User story.** As a managed-service operator I want each organization to
have its own rate limit and quota so a noisy tenant cannot starve the
others sharing the Worker instance.

**Priority.** Must.

**Scope detail.**
- Reuse the existing `rate_limits` table; add a new scope convention
  `org:<oid>:<operation>` plus a `org_quota` table that records monthly
  send / receive / API-call counts and the configured ceiling.
- `worker/security/rate-limit.ts` gains a second function
  `enforceOrgRateLimit` that reads the org-scoped row.
- `worker/features/notifications/delivery.ts` enforces a per-org send
  quota: outbound mail above the ceiling is queued and processed when the
  monthly window rolls over, with an audit event for every rejection.
- API surface: `GET /api/organizations/:oid/quotas` (manager only) and
  `PUT /api/organizations/:oid/quotas` (manager only, with explicit
  confirmation header).

**Acceptance.**
- A flood of requests from one organization returns `429 ORG_RATE_LIMITED`
  while requests from another organization continue to succeed.
- Quota enforcement is testable with a deterministic clock; integration
  tests cover the boundary case where the window rolls over mid-test.
- A rejection is recorded in `audit_events` with `outcome = denied` and
  `action = org.quota.exceeded`.

**Modules.** Worker (`worker/`), API (`api/`), migrations
(`migrations-after-deploy/`), tests (`test/`).

---

### R-10 — Notification channel fan-out

**User story.** As an organization owner I want outbound notifications
(email, webhook, push) to be configurable per event class, so my team gets
the alerts that matter without drowning in noise.

**Priority.** Should.

**Scope detail.**
- Reuse `worker/features/notifications/delivery.ts`; add a per-org
  routing table `notification_routes` (organization_id, event_class,
  channel, target_json, enabled). Event classes:
  `mail.received`, `mail.assigned`, `mail.replied`, `audit.denied`,
  `quota.exceeded`, `sso.disabled`.
- Frontend settings UI exposes the routing table; toggling a route
  triggers an immediate dry-run that delivers a "test notification" to the
  configured channel (subject `[HQBase test]`).

**Acceptance.**
- Disabling `mail.received` for `channel = email` stops new-mail
  notifications for that organization while other channels continue.
- A dry-run notification carries the same signature header as a real
  one but `metadata.dry_run = true`; audit logs record the dry-run.

**Modules.** Worker (`worker/`), app (`app/`), API (`api/`), migrations
(`migrations-after-deploy/`), tests (`test/`).

---

## Priority summary

| ID | Story | Priority |
| --- | --- | --- |
| R-01 | Multi-tenant isolation (organization boundary) | Must |
| R-02 | Branding and theme per organization | Must |
| R-06 | Audit log retention, export, notification | Must |
| R-07 | Login audit (session lifecycle) | Must |
| R-09 | Per-organization API rate limit and quota | Must |
| R-03 | Configurable outbound email signature (per organization) | Should |
| R-04 | Custom email parsing rules (header and attachment) | Should |
| R-08 | SSO / OIDC integration | Should |
| R-10 | Notification channel fan-out | Should |
| R-05 | Attachment OCR | Could |

## Stage 2 input contract

Stage 2 has four tickets. Each ticket owns a slice of the codebase; stories
cross ticket boundaries by intent, not by overlap. When a story touches
multiple tickets, the **leading** ticket is the one that writes the migration
and the API route; the others consume it.

### FOU-40 — `core API extensions` (X5)

**Owns**
- New routes under `/api/organizations/:oid/...` for branding (R-02),
  parsing rules (R-04), audit exports and subscriptions (R-06),
  SSO configuration (R-08), quota configuration (R-09), and notification
  routing (R-10).
- API documentation: update `api/hqbase-mail-api-v2.openapi.json` and the
  matching Postman collection/environment files.

**Must consume from other Stage 2 tickets**
- Migrations and schema types from FOU-43 (X8) for every new table.
- Worker handlers from FOU-42 (X7) for SSO discovery (R-08), audit
  subscription delivery (R-06), quota enforcement (R-09), and notification
  fan-out (R-10).
- Branding API contracts from FOU-41 (X6): the API surface in R-02 is
  defined here, the rendering rules live there.

**Boundary rule.** X5 does not write front-end code or worker glue logic.
It writes handlers, route mounts, OpenAPI artifacts, and the audit-event
emissions for the API layer.

### FOU-41 — `frontend UI/branding` (X6)

**Owns**
- R-02 rendering: CSS variable injection, logo loader, copy override
  consumer.
- New components under `app/components/` for the branding settings page,
  the signature picker (R-03 surface), the parsing-rule editor (R-04
  surface), the SSO config page (R-08 surface), the quota panel (R-09
  surface), and the notification routing table (R-10 surface).
- Two preset palettes shipped as default fall-back.

**Must consume from other Stage 2 tickets**
- API endpoints from FOU-40 (X5).
- Worker route that streams the logo (`/api/organizations/:oid/branding/logo`)
  from FOU-42 (X7).

**Boundary rule.** X6 writes no SQL and no Worker logic. Lint and
`components.json` constraints apply unchanged.

### FOU-42 — `worker customization & integrations` (X7)

**Owns**
- R-01 enforcement: per-request organization resolution and the
  `WHERE organization_id = :oid` predicates on existing query paths.
- R-04 rule engine: the apply step in `worker/email/inbound.ts` plus the
  durable object that runs parsing rules.
- R-06 subscription delivery: signed POSTs through
  `worker/features/notifications/`.
- R-07 audit emissions on session lifecycle in `worker/auth/`.
- R-08 SSO callback handler and the discovery document cache.
- R-09 quota enforcement and the rejection audit event.
- R-10 routing evaluation in `worker/features/notifications/delivery.ts`.

**Must consume from other Stage 2 tickets**
- Tables from FOU-43 (X8).
- The route mounts under `/api/...` from FOU-40 (X5); X7 implements the
  handler logic, X5 wires the route.

**Boundary rule.** X7 does not register Hono routes under `/api/...`;
that registration is X5's job. X7 exposes helper functions imported by
X5.

### FOU-43 — `migrations & data model` (X8)

**Owns**
- New SQL files under `migrations-after-deploy/` for every new table
  (R-01, R-02, R-04, R-06, R-08, R-09, R-10) and for the `organizations`
  backfill.
- New `ALTER TABLE` migrations that add `organization_id` columns to
  every existing table listed in R-01; every such migration must include
  a backfill step that pins existing rows to the sentinel organization.
- Schema types in `worker/db/schema-*.ts` for every new table and every
  new column.
- Rollback document `docs/migrations-rollback.md` listing each new
  migration's inverse.

**Must consume from other Stage 2 tickets**
- The schema is a **precondition** for X5, X6, and X7. X8 ships first;
  X5 and X7 import the schema types, X6 consumes the API.

**Boundary rule.** X8 ships no application code beyond the schema types
and the SQL. It does not register routes, does not write UI, and does not
add handler logic. All DDL is additive — no `DROP TABLE` on existing
rows except in the inverse migration listed in the rollback doc.

### Cross-ticket invariants

1. **AGPL compliance.** No commit strips the `LICENSE` or `NOTICE`
   routes. Any new public asset endpoint must keep both routes reachable.
2. **No secrets in code.** SSO client secrets, signing secrets, and any
   new credential use the existing kid-based secret store. The repo
   never holds a plaintext credential.
3. **Backward-compatible migrations.** Every `migrations-after-deploy/`
   file in Stage 2 must include a fresh-install test and an update test
   in `test/`; existing seed data must survive.
4. **Audit everything.** Each new mutation route in X5 calls
   `recordAudit` with a sanitized metadata payload. X7 ensures that
   worker-driven changes (SSO login, quota rejection, notification
   dispatch) emit audit events too.
5. **No scope drift.** A Stage 2 ticket that needs to grow past the
   boundary above must open a new child issue under FOU-35 instead of
   silently expanding. The Epic owner (Mika) is the only one who may
   re-balance scope mid-stage.

## What Stage 2 does not own

- **Production deployment pipeline** — FOU-44 (X9) picks this up in
  Stage 3; Stage 2 must leave `pnpm deploy:dry-run` green.
- **Monitoring and runbook** — FOU-45 (X10) in Stage 3.
- **End-to-end verification** — FOU-46 (X11) in Stage 4 consumes this
  document as its checklist.
- **User-facing docs** — FOU-47 (X12) in Stage 4 will turn this document
  into `docs/customization.md` for end users; the technical detail here
  stays as the maintainer-facing reference.
