import { type Context, Hono } from "hono";
import { z } from "zod";
import type { AuthContext } from "../../auth/session";
import { requireAuthContext, requireRole } from "../../auth/session";
import { newId, nowIso } from "../../db/client";
import type { HonoApp } from "../../lib/env";
import { AppError } from "../../lib/errors";
import { parseWith } from "../../lib/validation";
import { recordAudit } from "../audit/service";

export const organizationRoutes = new Hono<HonoApp>();

const organizationId = z.string().min(1).max(100);
const brandingSchema = z.object({
  logoR2Key: z.string().max(512).nullable().optional(),
  palette: z.record(z.string(), z.string().max(200)).default({}),
  copyOverrides: z.record(z.string(), z.string().max(1000)).default({}),
  emailSignatureHtmlSnapshot: z.string().max(100_000).nullable().optional()
});
const ruleSchema = z.object({
  matchKind: z.enum(["header", "attachment_mime", "subject_regex"]),
  matchSpec: z.record(z.string(), z.unknown()),
  actionKind: z.enum(["tag", "assign", "reject", "webhook"]),
  actionSpec: z.record(z.string(), z.unknown()),
  priority: z.number().int().min(-100_000).max(100_000).default(0),
  enabled: z.boolean().default(true)
});
const subscriptionSchema = z.object({
  endpointUrl: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://")),
  signingSecretKid: z.string().min(1).max(200),
  eventFilter: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(false)
});
const ssoSchema = z.object({
  provider: z.enum(["google", "microsoft", "feishu", "oidc"]),
  clientId: z.string().min(1).max(500),
  clientSecretKid: z.string().min(1).max(200),
  discoveryUrl: z.string().url(),
  scopes: z
    .array(z.string().min(1).max(100))
    .min(1)
    .max(30)
    .default(["openid", "email", "profile"]),
  defaultRole: z.enum(["member", "admin"]).default("member"),
  enabled: z.boolean().default(false),
  allowedDomains: z.array(z.string().min(1).max(253)).max(100).default([])
});
const quotaSchema = z.object({
  sendCeiling: z.number().int().nonnegative().nullable().optional(),
  receiveCeiling: z.number().int().nonnegative().nullable().optional(),
  apiCallCeiling: z.number().int().nonnegative().nullable().optional()
});
const notificationRouteSchema = z.object({
  eventClass: z.string().min(1).max(100),
  channel: z.enum(["email", "webhook", "push"]),
  destination: z.string().min(1).max(2048),
  enabled: z.boolean().default(true)
});

organizationRoutes.use("/:organizationId/*", async (c, next) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  await ensureOrganization(c.env.DB, c.req.param("organizationId"));
  await next();
});

organizationRoutes.get("/:organizationId/branding", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT logo_r2_key, palette_json, copy_overrides_json, email_signature_html_snapshot, updated_at
     FROM organization_branding WHERE organization_id = ?`
  )
    .bind(c.req.param("organizationId"))
    .first<Record<string, unknown>>();
  return c.json(row ? mapBranding(row) : { palette: {}, copyOverrides: {}, logoR2Key: null });
});

organizationRoutes.put("/:organizationId/branding", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const id = c.req.param("organizationId");
  const input = parseWith(brandingSchema, await c.req.json().catch(() => ({})));
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO organization_branding
      (organization_id, logo_r2_key, palette_json, copy_overrides_json,
       email_signature_html_snapshot, updated_by_principal_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id) DO UPDATE SET logo_r2_key = excluded.logo_r2_key,
       palette_json = excluded.palette_json, copy_overrides_json = excluded.copy_overrides_json,
       email_signature_html_snapshot = excluded.email_signature_html_snapshot,
       updated_by_principal_id = excluded.updated_by_principal_id, updated_at = excluded.updated_at`
  )
    .bind(
      id,
      input.logoR2Key ?? null,
      JSON.stringify(input.palette),
      JSON.stringify(input.copyOverrides),
      input.emailSignatureHtmlSnapshot ?? null,
      auth.user.id,
      timestamp
    )
    .run();
  await audit(c, auth, "organization.branding.update", id);
  return c.json({ ...input, updatedAt: timestamp });
});

organizationRoutes.post("/:organizationId/branding/logo-upload", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const contentType = c.req.header("content-type")?.split(";", 1)[0] ?? "";
  if (contentType !== "image/png" && contentType !== "image/svg+xml") {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Logo must be PNG or SVG.", 415);
  }
  const key = `organizations/${c.req.param("organizationId")}/branding/${crypto.randomUUID()}`;
  const uploadUrl = new URL(c.req.url);
  uploadUrl.searchParams.set("key", key);
  return c.json({ uploadUrl: uploadUrl.toString(), r2Key: key }, 201);
});

organizationRoutes.put("/:organizationId/branding/logo-upload", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const key = new URL(c.req.url).searchParams.get("key");
  const contentType = c.req.header("content-type")?.split(";", 1)[0] ?? "";
  if (!key?.startsWith(`organizations/${c.req.param("organizationId")}/branding/`)) {
    throw new AppError("INVALID_UPLOAD", "The logo upload key is invalid.");
  }
  if (contentType !== "image/png" && contentType !== "image/svg+xml") {
    throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Logo must be PNG or SVG.", 415);
  }
  await c.env.MAIL_OBJECTS.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ ok: true, r2Key: key });
});

organizationRoutes.get("/:organizationId/branding/logo", async (c) => {
  const row = await c.env.DB.prepare(
    "SELECT logo_r2_key FROM organization_branding WHERE organization_id = ?"
  )
    .bind(c.req.param("organizationId"))
    .first<{ logo_r2_key: string | null }>();
  if (!row?.logo_r2_key) throw new AppError("NOT_FOUND", "Logo not found.", 404);
  const object = await c.env.MAIL_OBJECTS.get(row.logo_r2_key);
  if (!object) throw new AppError("NOT_FOUND", "Logo not found.", 404);
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, max-age=300"
    }
  });
});

organizationRoutes.get("/:organizationId/parsing-rules", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM parsing_rules WHERE organization_id = ? ORDER BY priority ASC, id ASC"
  )
    .bind(c.req.param("organizationId"))
    .all();
  return c.json(rows.results.map(mapRule));
});

organizationRoutes.post("/:organizationId/parsing-rules", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const input = parseWith(ruleSchema, await c.req.json().catch(() => ({})));
  const id = newId("rule");
  const timestamp = nowIso();
  await c.env.DB.prepare(`INSERT INTO parsing_rules
    (id, organization_id, match_kind, match_spec_json, action_kind, action_spec_json, priority, enabled, created_by_principal_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id,
      c.req.param("organizationId"),
      input.matchKind,
      JSON.stringify(input.matchSpec),
      input.actionKind,
      JSON.stringify(input.actionSpec),
      input.priority,
      input.enabled ? 1 : 0,
      auth.user.id,
      timestamp
    )
    .run();
  await audit(c, auth, "organization.parsing_rule.create", id);
  return c.json({ id, ...input, updatedAt: timestamp }, 201);
});

organizationRoutes.patch("/:organizationId/parsing-rules/:ruleId", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const input = parseWith(ruleSchema.partial(), await c.req.json().catch(() => ({})));
  const existing = await c.env.DB.prepare(
    "SELECT * FROM parsing_rules WHERE id = ? AND organization_id = ?"
  )
    .bind(c.req.param("ruleId"), c.req.param("organizationId"))
    .first<Record<string, unknown>>();
  if (!existing) throw new AppError("NOT_FOUND", "Parsing rule not found.", 404);
  const merged = { ...mapRule(existing), ...input };
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `UPDATE parsing_rules SET match_kind = ?, match_spec_json = ?, action_kind = ?, action_spec_json = ?, priority = ?, enabled = ?, updated_at = ? WHERE id = ? AND organization_id = ?`
  )
    .bind(
      merged.matchKind,
      JSON.stringify(merged.matchSpec),
      merged.actionKind,
      JSON.stringify(merged.actionSpec),
      merged.priority,
      merged.enabled ? 1 : 0,
      timestamp,
      c.req.param("ruleId"),
      c.req.param("organizationId")
    )
    .run();
  return c.json({ ...merged, updatedAt: timestamp });
});

organizationRoutes.delete("/:organizationId/parsing-rules/:ruleId", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const result = await c.env.DB.prepare(
    "DELETE FROM parsing_rules WHERE id = ? AND organization_id = ?"
  )
    .bind(c.req.param("ruleId"), c.req.param("organizationId"))
    .run();
  if (!result.meta.changes) throw new AppError("NOT_FOUND", "Parsing rule not found.", 404);
  await audit(c, auth, "organization.parsing_rule.delete", c.req.param("ruleId"));
  return c.body(null, 204);
});

organizationRoutes.post("/:organizationId/parsing-rules/:ruleId/dry-run", async (c) => {
  const rule = await c.env.DB.prepare(
    "SELECT * FROM parsing_rules WHERE id = ? AND organization_id = ?"
  )
    .bind(c.req.param("ruleId"), c.req.param("organizationId"))
    .first<Record<string, unknown>>();
  if (!rule) throw new AppError("NOT_FOUND", "Parsing rule not found.", 404);
  const message = await c.req.json().catch(() => ({}));
  return c.json({
    ruleId: c.req.param("ruleId"),
    matched: false,
    projectedActions: [],
    input: message
  });
});

organizationRoutes.get("/:organizationId/audit-exports", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, status, requested_by_principal_id, started_at, finished_at, r2_key, manifest_json, error_code, created_at, updated_at FROM audit_export_jobs WHERE organization_id = ? ORDER BY created_at DESC LIMIT 100"
  )
    .bind(c.req.param("organizationId"))
    .all();
  return c.json(rows.results.map(mapExport));
});

organizationRoutes.post("/:organizationId/audit-exports", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const id = newId("audit_export");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO audit_export_jobs (id, organization_id, requested_by_principal_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, c.req.param("organizationId"), auth.user.id, timestamp, timestamp)
    .run();
  await audit(c, auth, "organization.audit_export.create", id);
  return c.json({ id, status: "pending", createdAt: timestamp }, 202);
});

organizationRoutes.get("/:organizationId/audit-subscriptions", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, endpoint_url, signing_secret_kid, event_filter_json, enabled, created_at, updated_at FROM audit_subscriptions WHERE organization_id = ? ORDER BY created_at"
  )
    .bind(c.req.param("organizationId"))
    .all();
  return c.json(
    rows.results.map((row) => ({
      id: row.id,
      endpointUrl: row.endpoint_url,
      signingSecretKid: row.signing_secret_kid,
      eventFilter: json(row.event_filter_json),
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  );
});

organizationRoutes.post("/:organizationId/audit-subscriptions", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const input = parseWith(subscriptionSchema, await c.req.json().catch(() => ({})));
  const id = newId("audit_subscription");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO audit_subscriptions (id, organization_id, endpoint_url, signing_secret_kid, event_filter_json, enabled, created_by_principal_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      c.req.param("organizationId"),
      input.endpointUrl,
      input.signingSecretKid,
      JSON.stringify(input.eventFilter),
      input.enabled ? 1 : 0,
      auth.user.id,
      timestamp,
      timestamp
    )
    .run();
  await audit(c, auth, "organization.audit_subscription.create", id);
  return c.json({ id, ...input, createdAt: timestamp, updatedAt: timestamp }, 201);
});

organizationRoutes.delete("/:organizationId/audit-subscriptions/:subscriptionId", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const result = await c.env.DB.prepare(
    "DELETE FROM audit_subscriptions WHERE id = ? AND organization_id = ?"
  )
    .bind(c.req.param("subscriptionId"), c.req.param("organizationId"))
    .run();
  if (!result.meta.changes) throw new AppError("NOT_FOUND", "Audit subscription not found.", 404);
  await audit(c, auth, "organization.audit_subscription.delete", c.req.param("subscriptionId"));
  return c.body(null, 204);
});

organizationRoutes.put("/:organizationId/sso", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const input = parseWith(ssoSchema, await c.req.json().catch(() => ({})));
  const id = c.req.param("organizationId");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO organization_sso (organization_id, provider, client_id, client_secret_kid, discovery_url, scopes_csv, default_role, enabled, updated_by_principal_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id) DO UPDATE SET provider=excluded.provider, client_id=excluded.client_id, client_secret_kid=excluded.client_secret_kid, discovery_url=excluded.discovery_url, scopes_csv=excluded.scopes_csv, default_role=excluded.default_role, enabled=excluded.enabled, updated_by_principal_id=excluded.updated_by_principal_id, updated_at=excluded.updated_at`
  )
    .bind(
      id,
      input.provider,
      input.clientId,
      input.clientSecretKid,
      input.discoveryUrl,
      input.scopes.join(","),
      input.defaultRole,
      input.enabled ? 1 : 0,
      auth.user.id,
      timestamp,
      timestamp
    )
    .run();
  await c.env.DB.prepare("DELETE FROM organization_sso_allowed_domains WHERE organization_id = ?")
    .bind(id)
    .run();
  for (const domain of input.allowedDomains)
    await c.env.DB.prepare(
      "INSERT INTO organization_sso_allowed_domains (organization_id, domain, created_at) VALUES (?, ?, ?)"
    )
      .bind(id, domain.toLowerCase(), timestamp)
      .run();
  await audit(c, auth, "organization.sso.update", id);
  return c.json({ ...input, updatedAt: timestamp });
});

organizationRoutes.get("/:organizationId/quota", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM org_quota WHERE organization_id = ?")
    .bind(c.req.param("organizationId"))
    .first();
  return c.json(
    row ?? {
      organizationId: c.req.param("organizationId"),
      sendCount: 0,
      receiveCount: 0,
      apiCallCount: 0,
      sendCeiling: null,
      receiveCeiling: null,
      apiCallCeiling: null
    }
  );
});

organizationRoutes.put("/:organizationId/quota", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const input = parseWith(quotaSchema, await c.req.json().catch(() => ({})));
  const id = c.req.param("organizationId");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO org_quota (organization_id, window_start, send_ceiling, receive_ceiling, api_call_ceiling, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id) DO UPDATE SET send_ceiling=excluded.send_ceiling, receive_ceiling=excluded.receive_ceiling, api_call_ceiling=excluded.api_call_ceiling, updated_at=excluded.updated_at"
  )
    .bind(
      id,
      timestamp,
      input.sendCeiling ?? null,
      input.receiveCeiling ?? null,
      input.apiCallCeiling ?? null,
      timestamp
    )
    .run();
  await audit(c, auth, "organization.quota.update", id);
  return c.json({ organizationId: id, ...input, updatedAt: timestamp });
});

organizationRoutes.get("/:organizationId/notification-routes", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM notification_routes WHERE organization_id = ? ORDER BY event_class, channel, destination"
  )
    .bind(c.req.param("organizationId"))
    .all();
  return c.json(rows.results);
});

organizationRoutes.post("/:organizationId/notification-routes", async (c) => {
  const auth = await requireAuthContext(c.env, c.req.raw);
  requireRole(auth, ["owner", "admin"]);
  const input = parseWith(notificationRouteSchema, await c.req.json().catch(() => ({})));
  const id = c.req.param("organizationId");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO notification_routes (organization_id, event_class, channel, destination, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, event_class, channel, destination) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at"
  )
    .bind(
      id,
      input.eventClass,
      input.channel,
      input.destination,
      input.enabled ? 1 : 0,
      timestamp,
      timestamp
    )
    .run();
  await audit(c, auth, "organization.notification_route.update", id);
  return c.json(input, 201);
});

async function ensureOrganization(db: D1Database, id: string): Promise<void> {
  if (
    !organizationId.safeParse(id).success ||
    !(await db.prepare("SELECT id FROM organizations WHERE id = ?").bind(id).first())
  )
    throw new AppError("NOT_FOUND", "Organization not found.", 404);
}
async function audit(
  c: Context<HonoApp>,
  auth: AuthContext,
  action: string,
  resourceId: string
): Promise<void> {
  await recordAudit(c.env.DB, {
    organizationId: c.req.param("organizationId") ?? null,
    correlationId: c.get("correlationId"),
    actorType: "user",
    actorId: auth.user.id,
    action,
    resourceType: "organization",
    resourceId,
    outcome: "success"
  });
}
function json(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}
function mapBranding(row: Record<string, unknown>) {
  return {
    logoR2Key: row.logo_r2_key,
    palette: json(row.palette_json),
    copyOverrides: json(row.copy_overrides_json),
    emailSignatureHtmlSnapshot: row.email_signature_html_snapshot,
    updatedAt: row.updated_at
  };
}
function mapRule(row: Record<string, unknown>) {
  return {
    id: row.id,
    matchKind: row.match_kind,
    matchSpec: json(row.match_spec_json),
    actionKind: row.action_kind,
    actionSpec: json(row.action_spec_json),
    priority: row.priority,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at
  };
}
function mapExport(row: Record<string, unknown>) {
  return {
    id: row.id,
    status: row.status,
    requestedByPrincipalId: row.requested_by_principal_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    r2Key: row.r2_key,
    manifest: row.manifest_json ? json(row.manifest_json) : null,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
