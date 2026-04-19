# Repository Guidelines

## Project Structure & Module Organization
Core application code lives in `src/`. Use `src/routes/` for Hono endpoints, `src/middleware/` for request guards, `src/lib/` for shared utilities and services, `src/db/` for D1 access and schema definitions, and `src/config/` plus `src/types/` for runtime constants and shared types. Database migrations live in `migrations/`. Operational docs are in `docs/`, and local/production helper scripts are in `tools/`.

## Build, Test, and Development Commands
Install dependencies with `npm install` on Node `>=24 <25`. Use `npm run dev` to start the Worker locally with `wrangler.dev.jsonc` and local D1 bindings. Run `npm run typecheck` before opening a PR. Regenerate Worker binding types with `npm run types:wrangler` after changing `wrangler*.jsonc`. For schema work, use `npm run d1:generate`, `npm run d1:check`, and `npm run d1:migrate:local`. To reset local data, use `npm run d1:bootstrap:local`.

## Coding Style & Naming Conventions
This repository uses strict TypeScript with ES modules. Follow the route layout documented in `CONTRIBUTING.md`: imports, Zod schemas, internal helpers, exported route instance, handlers, then endpoint registration. Keep route-specific validation and middleware close to the handler. Prefer `success(...)` and `failure(...)` response helpers over ad hoc JSON. Use descriptive camelCase for variables and functions, PascalCase for types, and keep filenames lowercase with hyphens only where the repo already does so, for example `require-permission.ts`.
