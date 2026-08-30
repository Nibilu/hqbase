## Purpose

This document records the resources and values required before a production HQBase
deployment. Customer credentials and account identifiers stay in the customer or
amber machine secret store. The example file contains no working credentials.

## Resource checklist

| Resource | Required value | Source | Owner | Status |
| --- | --- | --- | --- | --- |
| Cloudflare API token | `CLOUDFLARE_API_TOKEN` | amber machine secret store; use `wrangler secret put` only for Worker runtime secrets | deployment operator | blocked: current token returned HTTP 401 on 2026-08-30 |
| Cloudflare account | account name and ID | Cloudflare dashboard, or authenticated API | account owner | account name reported as `Sanxing6800••••'s Account`; keep the ID out of commits |
| Worker | `hqbase-prod` | Worker name in the deployment configuration | deployment operator | pending authenticated account access |
| Workers subdomain | `hqbase-prod.<account-subdomain>.workers.dev` | Cloudflare Workers dashboard | account owner | pending Worker creation |
| Custom domain | `do.luciia.net` | DNS registrar and Cloudflare Zones page | domain owner | blocked: zone query returned no zone |
| D1 database | `hqbase-prod` and its UUID | Cloudflare D1 dashboard or D1 API | deployment operator | pending authenticated D1 access |
| R2 bucket | `hqbase-prod-mail` | Cloudflare R2 dashboard or R2 API | deployment operator | pending authenticated R2 access |
| R2 lifecycle | retain by default; use an approved retention period for deletion | retention policy owner | product owner | defined; no deletion rule is applied by this change |
| Runtime secret | `BETTER_AUTH_SECRET` | amber machine secret store, then `wrangler secret put BETTER_AUTH_SECRET` | deployment operator | not present in the repository |

## Secret handling

Keep deployment variables in the amber machine secret store or an approved CI
secret store. A local deployment may use a file such as
`~/.config/hqbase/prod.env` with mode `0600`, loaded only for the deployment
command. Do not commit that file, print its contents, or put secrets in issue
comments. The Worker receives `BETTER_AUTH_SECRET` through Wrangler's secret
store. The API token is a deployment credential and is not a Worker variable.

The repository template is `.hqbase/deployments/production/config.example.json`.
Replace its resource placeholders only after authenticated Cloudflare discovery.
Do not copy the account ID or API token into the template.

## Domain readiness

Before attaching `do.luciia.net`, the domain owner must delegate the zone to the
Cloudflare nameservers shown by the Cloudflare dashboard. Then verify that the
zone is active in the target account. Do not add a Worker custom domain while the
zone query is empty.

## AGPL notice

The deployed static assets must expose `/LICENSE` and `/NOTICE`, and the NOTICE
must link to the canonical source repository:
`https://github.com/Nibilu/hqbase`. Keep these routes available in every public
release.

## Verification record

On 2026-08-30, the configured `do.luciia.net` zone query returned an empty
result. Token verification, D1 listing, and R2 listing returned HTTP 401. No
Cloudflare resource was created or modified, and no real credential was written
to this repository.
