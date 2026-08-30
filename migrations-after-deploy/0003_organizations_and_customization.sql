PRAGMA foreign_keys = ON;

CREATE TABLE organizations (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  ocr_enabled INTEGER NOT NULL DEFAULT 0 CHECK (ocr_enabled IN (0, 1)),
  audit_retention_days INTEGER CHECK (audit_retention_days IS NULL OR audit_retention_days >= 1),
  forbidden_metadata_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO organizations (id, slug, display_name, created_at, updated_at)
VALUES ('org_default', 'default', 'Default organization', datetime('now'), datetime('now'));

ALTER TABLE mailboxes ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE mail_domains ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE email_signatures ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE audit_events ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE rate_limits ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE installation_identity ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE RESTRICT;

UPDATE mailboxes SET organization_id = 'org_default' WHERE organization_id IS NULL;
UPDATE mail_domains SET organization_id = 'org_default' WHERE organization_id IS NULL;
UPDATE email_signatures SET organization_id = 'org_default' WHERE organization_id IS NULL;
UPDATE audit_events SET organization_id = 'org_default' WHERE organization_id IS NULL;
UPDATE rate_limits SET organization_id = 'org_default' WHERE organization_id IS NULL;
UPDATE installation_identity SET organization_id = 'org_default' WHERE organization_id IS NULL;

CREATE INDEX mailboxes_organization_idx ON mailboxes(organization_id, created_at);
CREATE INDEX mail_domains_organization_idx ON mail_domains(organization_id, created_at);
CREATE INDEX email_signatures_organization_idx ON email_signatures(organization_id, created_at);
CREATE INDEX audit_events_organization_time_idx
ON audit_events(organization_id, occurred_at DESC);
CREATE INDEX rate_limits_organization_idx ON rate_limits(organization_id, scope, expires_at);
CREATE UNIQUE INDEX installation_identity_organization_uidx
ON installation_identity(organization_id)
WHERE organization_id IS NOT NULL;

CREATE TABLE organization_branding (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  logo_r2_key TEXT,
  palette_json TEXT NOT NULL DEFAULT '{}',
  copy_overrides_json TEXT NOT NULL DEFAULT '{}',
  email_signature_html_snapshot TEXT,
  updated_by_principal_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL,
  CHECK (json_valid(palette_json) AND json_type(palette_json) = 'object'),
  CHECK (json_valid(copy_overrides_json) AND json_type(copy_overrides_json) = 'object')
);

CREATE TABLE parsing_rules (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_kind TEXT NOT NULL CHECK (match_kind IN ('header', 'attachment_mime', 'subject_regex')),
  match_spec_json TEXT NOT NULL,
  action_kind TEXT NOT NULL CHECK (action_kind IN ('tag', 'assign', 'reject', 'webhook')),
  action_spec_json TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by_principal_id TEXT NOT NULL REFERENCES principals(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL,
  CHECK (json_valid(match_spec_json) AND json_valid(action_spec_json))
);

CREATE INDEX parsing_rules_organization_enabled_priority_idx
ON parsing_rules(organization_id, enabled, priority DESC, id);

CREATE TABLE audit_export_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  requested_by_principal_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
  started_at TEXT,
  finished_at TEXT,
  r2_key TEXT,
  manifest_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX audit_export_jobs_organization_status_idx
ON audit_export_jobs(organization_id, status, created_at DESC);

CREATE TABLE audit_subscriptions (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint_url TEXT NOT NULL,
  signing_secret_kid TEXT NOT NULL,
  event_filter_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  created_by_principal_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (json_valid(event_filter_json) AND json_type(event_filter_json) = 'object')
);

CREATE INDEX audit_subscriptions_organization_enabled_idx
ON audit_subscriptions(organization_id, enabled);

CREATE TABLE organization_sso (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'feishu', 'oidc')),
  client_id TEXT NOT NULL,
  client_secret_kid TEXT NOT NULL,
  discovery_url TEXT NOT NULL,
  scopes_csv TEXT NOT NULL DEFAULT 'openid,email,profile',
  default_role TEXT NOT NULL DEFAULT 'member' CHECK (default_role IN ('member', 'admin')),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  updated_by_principal_id TEXT REFERENCES principals(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE organization_sso_allowed_domains (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  domain TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, domain)
);

CREATE TABLE org_quota (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  window_start TEXT NOT NULL,
  send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),
  receive_count INTEGER NOT NULL DEFAULT 0 CHECK (receive_count >= 0),
  api_call_count INTEGER NOT NULL DEFAULT 0 CHECK (api_call_count >= 0),
  send_ceiling INTEGER CHECK (send_ceiling IS NULL OR send_ceiling >= 0),
  receive_ceiling INTEGER CHECK (receive_ceiling IS NULL OR receive_ceiling >= 0),
  api_call_ceiling INTEGER CHECK (api_call_ceiling IS NULL OR api_call_ceiling >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE notification_routes (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_class TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'webhook', 'push')),
  destination TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, event_class, channel, destination)
);

CREATE INDEX notification_routes_organization_event_idx
ON notification_routes(organization_id, event_class, enabled);

PRAGMA foreign_key_check;
PRAGMA optimize;
