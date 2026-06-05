# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # dev server on 0.0.0.0:3000
npm run build    # production build (standalone output)
npm run start    # serve the production build
```

Docker:
```bash
docker compose up --build   # build and run with env from .env
```

There are no tests and no linter configured.

## Environment

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|---|---|---|
| `DB_TYPE` | yes | `postgres` \| `mysql` \| `mariadb` \| `mssql` \| `sqlite` |
| `DB_CONNECTION_STRING` | yes | Connection string for the target database |
| `JWT_SECRET` | yes | Random 32+ char string for JWT signing |
| `SECURE_COOKIES` | no | Set to `false` when serving over plain HTTP |
| `BASE_PATH` | no | Sub-path prefix, e.g. `/strawdmin` |
| `DATA_DIR` | no | Override for internal data directory (default: `./data`) |

## Architecture

Strawdmin manages **two completely separate databases**:

### 1. Target database (the one being administered)
Configured via `DB_TYPE` + `DB_CONNECTION_STRING`. Accessed through the driver abstraction in [lib/drivers/index.ts](lib/drivers/index.ts), which provides a uniform `DbDriver` interface (`query`, `quote`, `placeholder`) over pg, mysql2, mssql, and @libsql/client. The driver is a singleton — one connection pool for the process lifetime.

Schema is introspected once per process and cached in memory in [lib/introspect.ts](lib/introspect.ts). Call `clearSchemaCache()` or hit `DELETE /api/schema` to force re-introspection after DDL changes.

SQL generation helpers (identifier quoting, parameter placeholders, binary serialization) live in [lib/sql.ts](lib/sql.ts).

### 2. Internal database (app state)
A local SQLite file at `data/app.db` (via `@libsql/client`). Managed entirely in [lib/internal-db.ts](lib/internal-db.ts). Stores:
- **users** — bcrypt-hashed passwords, roles (`admin` | `user`)
- **fk_display_settings** — per-table FK column → display field mappings
- **field_encryption_settings** — per-column encryption config (SHA256/SHA512 + optional salt column)

Settings rows are keyed by a `db_fingerprint` (`DB_TYPE:DB_CONNECTION_STRING`) and pruned automatically when the fingerprint changes (i.e., when you switch databases).

### Auth
JWT in an `auth_token` httpOnly cookie (7-day expiry, signed with `JWT_SECRET`). There is **no Next.js middleware** — route handlers and server components each verify the token themselves via `verifyToken()` from [lib/auth.ts](lib/auth.ts).

First-run flow: `app/page.tsx` checks `isFirstRun()` and redirects to `/setup` if no users exist.

### BASE_PATH / sub-path deployment
`BASE_PATH` is passed as a Docker build arg and baked into both `basePath` (Next.js routing) and `NEXT_PUBLIC_BASE_PATH` (client-side fetch prefix) at build time. Changing it requires a rebuild (`docker compose up --build`). All client-side fetch calls prefix with `basePath` from [lib/api-url.ts](lib/api-url.ts).

### Route structure
- `app/(auth)/login` — login page
- `app/setup` — first-run admin account creation
- `app/dashboard` — main UI (Sidebar + Header layout)
  - `tables/[tableName]` — paginated table view
  - `tables/[tableName]/[id]` — record edit
  - `tables/[tableName]/new` — record create
  - `backups` — backup/restore
  - `users` — user management (admin only in UI)
- `app/api/` — REST API consumed by the UI
  - `GET /api/schema` — returns introspected schema; `DELETE` clears the cache
  - `GET|POST /api/tables/[table]` — list/create rows
  - `GET|PUT|DELETE /api/tables/[table]/[id]` — read/update/delete a row
  - `GET|POST /api/backups`, `GET|DELETE|POST /api/backups/[name]/restore`
  - `GET|POST /api/users`, `PUT|DELETE /api/users/[id]`
  - `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
  - `GET|POST /api/fk-settings`, `GET|POST /api/fk-display`, `GET /api/fk-options/[table]`
  - `GET|POST /api/encryption-settings`, `POST /api/encrypt`

### Path alias
`@/` resolves to the **repo root** (not `src/`), as configured in `tsconfig.json`.
