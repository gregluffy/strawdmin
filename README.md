# Strawdmin

A self-hosted database admin UI. Browse tables, edit records, manage users, and create backups — all from your browser.

Supports **PostgreSQL**, **MySQL**, **MariaDB**, **SQL Server**, and **SQLite**.

![Table browser](assets/home.png)

---

## Features

### Table browser & CRUD
Paginated table view with search and column sorting. Create, edit, duplicate, and delete rows. JSON columns get a Monaco editor.

### FK display
Configure which field to show for foreign key columns instead of raw IDs — names, emails, slugs, or any other column from the related table.

![FK display](assets/fk-mask.png)

### Column visibility & row expand
Hide columns you don't need on the table view. Expand any row inline to see all its fields, including hidden ones.

![Column visibility and row expand](assets/hide-cols.png)

### Write-time hashing
Mark columns that your application stores as hashes (e.g. passwords). Configure the algorithm (SHA-256 or SHA-512) and an optional salt column per field.

![Hashing configuration](assets/hashing-set.png)

When editing a record, a lock icon appears on hashed fields with a "Set hashed value" link.

![Lock icon on hashed field](assets/hashing-use-1.png)

Support staff enter the plaintext value — Strawdmin hashes it with the configured algorithm and salt before saving. The original value is never stored.

![Hash & Apply modal](assets/hashing-use-2.png)

### Access policies
Control what each user can do per table (view, insert, update, delete) and per column (hidden, read-only).

![Access policies](assets/policies.png)

### Backups
Full JSON export of all table data with one click. Restore individual backups when needed. The App Settings Backup lets you export and import all configuration (FK display mappings, hashing settings, column preferences, access policies) separately from the data.

![Backups](assets/backups.png)

### Audit log
Every login, create, update, and delete is recorded. Filter by action type, table, username, and date range.

![Audit log](assets/auditlogs.png)

### Other
- **User management** — multiple users with `admin` / `user` roles
- **Dark / light theme**
- **Sub-path deployment** — run behind a reverse proxy at any base path without rebuilding

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

- **Brute-force protection** — the login endpoint tracks failures per IP and per username. After 10 failed attempts within 15 minutes the account/IP is locked out for 15 minutes; a successful login resets the counter. The state is in-memory — fine for a single-process deployment, but not suitable for multi-replica setups.
- **JWT auth** — credentials are exchanged for a signed `auth_token` httpOnly, `sameSite=lax` cookie (7-day expiry). `JWT_SECRET` is the only secret that matters — keep it random and at least 32 characters.
- **Password policy** — minimum 8 characters, enforced server-side on account creation and password changes. Passwords are stored as bcrypt hashes (cost factor 12).
- **Recommended deployment** — because Strawdmin has direct read/write access to your database, running it on a private network or behind a VPN is the right architecture regardless of how the app itself is secured. It is not intended to be the only layer of access control between an attacker and your database.

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

---

## License

MIT — see [LICENSE](LICENSE).

See [DISCLAIMER.md](DISCLAIMER.md) for warranty, security, and data-safety notices.
