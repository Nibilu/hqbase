import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

type MigrationTestEnv = Env & { TEST_MIGRATIONS: D1Migration[] };

describe("organizations migration update", () => {
  it("backfills existing tenant-bound rows without data loss", async () => {
    const testEnv = env as MigrationTestEnv;
    const db = testEnv.DB;
    const migrations = testEnv.TEST_MIGRATIONS;
    await applyD1Migrations(db, migrations.slice(0, -1));
    await db
      .prepare("INSERT INTO mail_domains (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(
        "dom_org_migration",
        "org-migration.example",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z"
      )
      .run();
    await db
      .prepare(
        "INSERT INTO mailboxes (id, address, mail_domain_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        "mbx_org_migration",
        "support@org-migration.example",
        "dom_org_migration",
        "Support",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z"
      )
      .run();
    await db
      .prepare(
        "INSERT INTO audit_events (id, occurred_at, correlation_id, actor_type, action, resource_type, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        "aud_org_migration",
        "2026-01-01T00:00:00Z",
        "corr_org_migration",
        "system",
        "migration.test",
        "test",
        "success"
      )
      .run();
    await db
      .prepare(
        "INSERT INTO rate_limits (scope, subject_hash, window_start, request_count, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
      .bind("global:test", "subject", 1, 1, 2)
      .run();
    await db
      .prepare(
        "INSERT INTO installation_identity (singleton, installation_id, worker_name, created_at, updated_at) VALUES (1, ?, ?, ?, ?)"
      )
      .bind("installation_org_migration", "worker", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    const organizationMigration = migrations.at(-1);
    expect(organizationMigration).toBeDefined();
    await applyD1Migrations(db, [organizationMigration as D1Migration]);
    for (const table of [
      "mailboxes",
      "mail_domains",
      "audit_events",
      "rate_limits",
      "installation_identity"
    ]) {
      const column = await db
        .prepare(`SELECT organization_id FROM ${table} LIMIT 1`)
        .first<{ organization_id: string }>();
      expect(column?.organization_id).toBe("org_default");
    }
    await expect(
      db.prepare("SELECT address FROM mailboxes WHERE id = 'mbx_org_migration'").first()
    ).resolves.toEqual({ address: "support@org-migration.example" });
  });
});
