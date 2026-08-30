# Local development

## Prerequisites

- Node.js 22 or newer.
- pnpm 11.7.0, as declared by `package.json`.
- A Linux system with glibc 2.35 or newer (the Cloudflare `workerd` binary
  used by Wrangler must be able to start).

Install dependencies from the repository root:

```sh
pnpm install
```

If pnpm is not installed, use the pinned package-manager version once:

```sh
npm exec --yes --package=pnpm@11.7.0 pnpm install
```

## Environment and local bindings

Copy the checked-in template when creating a local environment file:

```sh
cp .env.example .env
```

Do not add secrets to Git. For Wrangler and the local seed command, put local
secret values in `.dev.vars` (or an ignored `.env` file):

```dotenv
BETTER_AUTH_SECRET=replace-with-a-local-secret
HQBASE_LOCAL_SEED_PASSWORD=at-least-8-characters
```

Local development does not need a Cloudflare account ID or API token. Those are
needed only when authenticating Wrangler for remote operations such as deploys.
The local bindings are declared in `wrangler.jsonc`: `DB` uses local D1 state,
and `MAIL_OBJECTS` uses a local R2-compatible bucket. Durable Objects and the
jobs queue also run in Wrangler's local simulator. Local state is stored under
`.wrangler/` and is ignored by Git.

## Start the application

Apply migrations, optionally create the demo workspace, and start both the
Worker API and Vite frontend:

```sh
pnpm db:migrate:local
pnpm db:seed:local # optional; requires .dev.vars above
pnpm dev
```

`pnpm dev` builds the frontend, starts Wrangler on
`http://127.0.0.1:8787`, and starts Vite on `http://127.0.0.1:5173`. Open
`http://127.0.0.1:5173/`; Vite proxies API requests to the Worker. Without the
seed step, use `http://127.0.0.1:5173/setup` for first-run setup.

To reset local D1 and recreate the demo data:

```sh
pnpm db:reset:local
pnpm db:seed:local
```

The reset is local-only and destructive.

## Tests and checks

```sh
pnpm test
```

This runs the unit suite followed by the Cloudflare Worker integration suite.
The integration suite and `pnpm dev` require a working `workerd` binary; on
older Linux hosts, upgrade the host libc or run them in a supported container.

