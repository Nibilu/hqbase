import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { applyCurrentMigrations } from "./current-migrations";

describe("organizations migration fresh install", () => {
  beforeAll(async () => {
    await applyCurrentMigrations();
  });

  it("creates the tenant and customization tables", async () => {
    const db = env.DB;
    const tables = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        "organizations",
        "organization_branding",
        "parsing_rules",
        "audit_export_jobs",
        "audit_subscriptions",
        "organization_sso",
        "org_quota",
        "notification_routes"
      )
      .all<{ name: string }>();

    expect(tables.results.map((row) => row.name).sort()).toEqual([
      "audit_export_jobs",
      "audit_subscriptions",
      "notification_routes",
      "org_quota",
      "organization_branding",
      "organization_sso",
      "organizations",
      "parsing_rules"
    ]);
    await expect(
      db.prepare("SELECT id, slug FROM organizations WHERE id = 'org_default'").first()
    ).resolves.toEqual({
      id: "org_default",
      slug: "default"
    });
  });
});
