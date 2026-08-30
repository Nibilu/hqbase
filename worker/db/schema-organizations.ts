import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { principals } from "./schema-core";

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey().notNull(),
    slug: text("slug").notNull().unique(),
    displayName: text("display_name").notNull(),
    status: text("status", { enum: ["active", "disabled"] })
      .default("active")
      .notNull(),
    ocrEnabled: integer("ocr_enabled", { mode: "boolean" }).default(false).notNull(),
    auditRetentionDays: integer("audit_retention_days"),
    forbiddenMetadata: text("forbidden_metadata_json", { mode: "json" })
      .$type<string[]>()
      .default(sql`'[]'`)
      .notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    check("organizations_status_check", sql`${table.status} IN ('active', 'disabled')`),
    check("organizations_ocr_enabled_check", sql`${table.ocrEnabled} IN (0, 1)`),
    check(
      "organizations_audit_retention_check",
      sql`${table.auditRetentionDays} IS NULL OR ${table.auditRetentionDays} >= 1`
    )
  ]
);

export const organizationBranding = sqliteTable("organization_branding", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  logoR2Key: text("logo_r2_key"),
  palette: text("palette_json", { mode: "json" }).$type<Record<string, string>>().notNull(),
  copyOverrides: text("copy_overrides_json", { mode: "json" })
    .$type<Record<string, string>>()
    .notNull(),
  emailSignatureHtmlSnapshot: text("email_signature_html_snapshot"),
  updatedByPrincipalId: text("updated_by_principal_id").references(() => principals.id, {
    onDelete: "set null"
  }),
  updatedAt: text("updated_at").notNull()
});

export const parsingRules = sqliteTable(
  "parsing_rules",
  {
    id: text("id").primaryKey().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    matchKind: text("match_kind", {
      enum: ["header", "attachment_mime", "subject_regex"]
    }).notNull(),
    matchSpec: text("match_spec_json", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    actionKind: text("action_kind", { enum: ["tag", "assign", "reject", "webhook"] }).notNull(),
    actionSpec: text("action_spec_json", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull(),
    priority: integer("priority").default(0).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    createdByPrincipalId: text("created_by_principal_id")
      .notNull()
      .references(() => principals.id, { onDelete: "restrict" }),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("parsing_rules_organization_enabled_priority_idx").on(
      table.organizationId,
      table.enabled,
      table.priority,
      table.id
    )
  ]
);

export const auditExportJobs = sqliteTable("audit_export_jobs", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "running", "succeeded", "failed"] })
    .default("pending")
    .notNull(),
  requestedByPrincipalId: text("requested_by_principal_id").references(() => principals.id, {
    onDelete: "set null"
  }),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  r2Key: text("r2_key"),
  manifest: text("manifest_json", { mode: "json" }).$type<Record<string, unknown>>(),
  errorCode: text("error_code"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const auditSubscriptions = sqliteTable("audit_subscriptions", {
  id: text("id").primaryKey().notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  endpointUrl: text("endpoint_url").notNull(),
  signingSecretKid: text("signing_secret_kid").notNull(),
  eventFilter: text("event_filter_json", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(false).notNull(),
  createdByPrincipalId: text("created_by_principal_id").references(() => principals.id, {
    onDelete: "set null"
  }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const organizationSso = sqliteTable("organization_sso", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["google", "microsoft", "feishu", "oidc"] }).notNull(),
  clientId: text("client_id").notNull(),
  clientSecretKid: text("client_secret_kid").notNull(),
  discoveryUrl: text("discovery_url").notNull(),
  scopesCsv: text("scopes_csv").notNull(),
  defaultRole: text("default_role", { enum: ["member", "admin"] })
    .default("member")
    .notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(false).notNull(),
  updatedByPrincipalId: text("updated_by_principal_id").references(() => principals.id, {
    onDelete: "set null"
  }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});

export const organizationSsoAllowedDomains = sqliteTable(
  "organization_sso_allowed_domains",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.domain] })]
);

export const orgQuota = sqliteTable("org_quota", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  windowStart: text("window_start").notNull(),
  sendCount: integer("send_count").default(0).notNull(),
  receiveCount: integer("receive_count").default(0).notNull(),
  apiCallCount: integer("api_call_count").default(0).notNull(),
  sendCeiling: integer("send_ceiling"),
  receiveCeiling: integer("receive_ceiling"),
  apiCallCeiling: integer("api_call_ceiling"),
  updatedAt: text("updated_at").notNull()
});

export const notificationRoutes = sqliteTable(
  "notification_routes",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventClass: text("event_class").notNull(),
    channel: text("channel", { enum: ["email", "webhook", "push"] }).notNull(),
    destination: text("destination").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.eventClass, table.channel, table.destination]
    }),
    index("notification_routes_organization_event_idx").on(
      table.organizationId,
      table.eventClass,
      table.enabled
    )
  ]
);
