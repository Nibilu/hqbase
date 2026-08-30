## Deployment pipeline

HQBase uses two GitHub environments. `hqbase-staging` is for pull-request previews and pushes to
`main`. `hqbase-production` is protected and runs only from the `Deploy production` workflow after
manual approval.

### Environments and triggers

| Environment | Config | Trigger | Smoke checks |
| --- | --- | --- | --- |
| staging | `wrangler.staging.toml` | Pull request, push to `main`, or manual dispatch | `/api/health`, OAuth discovery |
| production | `wrangler.production.toml` | Manual dispatch only | `/api/health`, OAuth discovery |

The production GitHub environment must have required reviewers. Select a reviewed commit or branch
when starting a production run.

### GitHub variables and secrets

Configure these names in the matching GitHub environment. Store values only in GitHub Secrets or
Cloudflare. Never commit them and never print them in a workflow log.

Secrets:

- `HQBASE_STAGING_CLOUDFLARE_ACCOUNT_ID` / `HQBASE_PRODUCTION_CLOUDFLARE_ACCOUNT_ID`
- `HQBASE_STAGING_CLOUDFLARE_API_TOKEN` / `HQBASE_PRODUCTION_CLOUDFLARE_API_TOKEN`
- `HQBASE_STAGING_D1_DATABASE_ID` / `HQBASE_PRODUCTION_D1_DATABASE_ID`
- `HQBASE_STAGING_BETTER_AUTH_SECRET` / `HQBASE_PRODUCTION_BETTER_AUTH_SECRET`

Variables:

- `HQBASE_STAGING_R2_BUCKET_NAME` / `HQBASE_PRODUCTION_R2_BUCKET_NAME`
- `HQBASE_STAGING_APP_HOSTNAME` / `HQBASE_PRODUCTION_APP_HOSTNAME`

The D1 and R2 values identify bindings; they are not application data. The Cloudflare API token
must be limited to the target account and required Workers, D1, R2, and zone permissions.

### Migration and deployment order

Each workflow builds the reviewed checkout, renders a temporary Wrangler config from the checked-in
template, applies `migrations/`, deploys the Worker, then applies `migrations-after-deploy/`. A failed
step stops the pipeline. The generated configs are not committed.

Application secrets remain in customer infrastructure. Provision required Worker secrets from a
protected operator session or the workflow's masked `wrangler secret put` step; do not put their
values in a workflow file. D1 and R2 bindings use Cloudflare resource IDs, not application secrets.

### Smoke tests and rollback

The pipeline requires a healthy JSON response from `/api/health` and a valid OAuth discovery
document. If a smoke test fails, stop promotion and use the Cloudflare Worker deployment rollback
procedure. Review D1 migration compatibility before any rollback; post-deploy migrations are
forward-compatible and must not be deleted from the repository.
