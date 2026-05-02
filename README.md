# dcm-api

Family Contributions Management API using Hono + Drizzle + Cloudflare Workers + D1.

## Authentication and Authorization (Auth0)
- Validation of JWT RS256 access token against Auth0 JWKS.
- Mandatory validations: `iss` (`AUTH0_ISSUER`) and `aud` (`AUTH0_AUDIENCE`).
- Master Authorization Document: **[RBAC.md](./docs/RBAC.md)**.
- Versioned tenant-facing Auth0 assets for manual operations or export/import reference live in `auth0-tenant-config/`, including tenant Actions, email HTML, and the versioned reset-email subject text.

## Environments (official)
- `local`: development with local D1 (`--local`) and variables in `.dev.vars`.
- `production`: canonical single remote Worker `dcm-api`.

## Migrations
- The local migration history was consolidated into a single initial base:
  - `migrations/0000_initial_schema.sql`

## Local Development

### Prerequisites
- **Node.js**: Version 24+.

```bash
npm install
```

Copy `.dev.vars.example` → `.dev.vars` and complete the values.

### Development Server
```bash
npm run dev
```

`npm run dev` uses `wrangler.dev.jsonc` and local D1. It does not hit production.

### Worker Bindings Types
```bash
npm run types:wrangler
```

Execute every time you change `wrangler.jsonc`.

### Local D1
```bash
# Leaves the local DB clean and applies migrations
npm run d1:reset:local

# Loads idempotent local seed
npm run d1:seed:local

# Shortcut: reset + seed
npm run d1:bootstrap:local
```

#### Technical Tools (`tools/`)
The `tools/` directory contains automation scripts for data flows:
- `tools/local/d1/reset.sh`: Purges the local database and applies all migrations from scratch.
- `tools/local/d1/seed.sh`: Inserts sample test data for local development.
- `tools/local/d1/snapshot.sh`: Creates a `.sql` backup of the current state of your local DB in `.wrangler/d1-snapshots/`.
- `tools/local/d1/restore.sh`: Allows restoring a specific local snapshot.
- `tools/local/d1/inspect.sh`: Inspects the local D1 database only.
- `tools/production/smoke-rbac.sh`: Runs smoke tests against the production API to validate that Auth0 permissions are correctly mapped.

### Schema (Drizzle)
```bash
# Generates a new migration from the schema
npm run d1:generate

# Checks for conflicts between migrations
npm run d1:check
```

Apply migration locally:
```bash
npm run d1:migrate:local
```

---

## Production

> **Required environment variables:** `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`

### Deploy
```bash
npm run deploy
```

### Migrations
```bash
npx wrangler d1 migrations apply DCM_DB_BINDING --remote
```

### Smoke Tests
```bash
# Production RBAC smoke test
./tools/production/smoke-rbac.sh
```
