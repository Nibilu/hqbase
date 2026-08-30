## Organization and customization migration

Migration `migrations-after-deploy/0003_organizations_and_customization.sql` adds the
organization boundary and the additive customization tables.

### Rollback

Do not run a destructive `DROP TABLE` rollback against a customer database. The supported
rollback is to deploy a worker version that does not read the new tables or columns. Keep the
migration ledger at `0003`; D1 does not support down migrations, and removing these objects would
lose customer configuration and audit data.

If the migration must be removed from a disposable local database, reset it and replay the
migrations:

```sh
pnpm db:reset:local
pnpm db:migrate:local
```

The `org_default` organization is the sentinel for rows that existed before the update. It must
not be deleted while legacy rows reference it. Organization-scoped signatures are not enabled by
this additive migration because the existing `email_signatures` scope CHECK constraint requires a
table rebuild; that follow-up must use a reviewed transition migration and preserve all legacy
indexes.

### Contract

The API and worker use `organizations.id` as the tenant key. New configuration tables require an
organization, and existing tenant-bound rows receive `organization_id = 'org_default'`. Secrets
remain indirect through `signing_secret_kid` and `client_secret_kid`; secret values are never
stored in these tables.
