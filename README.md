# Strawdmin

A self-hosted database admin UI. Browse tables, edit records, manage users, and create backups — all from your browser.

Supports **PostgreSQL**, **MySQL**, **MariaDB**, **SQL Server**, and **SQLite**.

---

## Features

- **Table browser** — paginated table view with search and column sorting
- **CRUD** — create, read, update, and delete rows; JSON columns get a Monaco editor
- **FK display** — configure which field to show for foreign key columns instead of raw IDs
- **Field encryption** — mark columns as SHA-256 or SHA-512 hashed; values are hashed before being written to the database
- **Backups** — full JSON export of all tables; restore individual backups
- **User management** — multiple users with `admin` / `user` roles
- **Sub-path deployment** — run behind a reverse proxy at any base path without rebuilding
- **Dark / light theme** — via `next-themes`

---

## Quick start with Docker

```bash
cp .env.example .env
# Edit .env — set DB_TYPE, DB_CONNECTION_STRING, and JWT_SECRET
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000) and create your admin account on first run.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DB_TYPE` | yes | `postgres` \| `mysql` \| `mariadb` \| `mssql` \| `sqlite` |
| `DB_CONNECTION_STRING` | yes | Connection string for the database to administer |
| `JWT_SECRET` | yes | Random 32+ character string for JWT signing |
| `SECURE_COOKIES` | no | Set to `false` when serving over plain HTTP (default: secure in production) |
| `BASE_PATH` | no | Sub-path prefix, e.g. `/strawdmin` |
| `DATA_DIR` | no | Override for internal data directory (default: `./data`) |

### Connection string formats

```
# PostgreSQL
postgresql://user:password@localhost:5432/dbname
postgresql://user:password@host:5432/dbname?sslmode=require

# MySQL / MariaDB
mysql://user:password@localhost:3306/dbname
mysql://user:password@host:3306/dbname?ssl=true

# SQL Server (local)
Server=localhost,1433;Database=dbname;User Id=user;Password=pass

# SQL Server (Azure / explicit TLS)
Server=host,1433;Database=dbname;User Id=user;Password=pass;TrustServerCertificate=true;Encrypt=true

# SQLite
/path/to/database.db
```

---

## Sub-path deployment

To serve Strawdmin at a path like `/services/strawdmin`, set `BASE_PATH` in `.env`:

```env
BASE_PATH=/services/strawdmin
```

Example Nginx location block:

```nginx
location /services/strawdmin {
    proxy_pass http://strawdmin:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## Security

- **Brute-force protection** — the login endpoint tracks failures per IP and per username in memory. After 10 failed attempts within 15 minutes, that IP or username is locked out for 15 minutes. The counter resets on a successful login. Because the state is in-memory, it resets on process restart; this is acceptable for a single-process deployment but means it is not cluster-safe.
- **JWT auth** — credentials are exchanged for a signed `auth_token` httpOnly cookie (7-day expiry). There is no session server; `JWT_SECRET` is the only secret that matters — keep it random and at least 32 characters.
- **Intended deployment** — Strawdmin is designed to run on a private network or behind a reverse proxy with its own access controls. It is not hardened for direct exposure to the public internet.

---

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

---

## Data persistence

The internal app state (users, settings) is stored in a SQLite database at `data/app.db`. Backups are stored as JSON files in `data/backups/`. Mount the `data/` directory as a Docker volume to persist state across container restarts.

```yaml
volumes:
  - ./data:/app/data
```
