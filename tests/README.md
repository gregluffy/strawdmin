# Tests

## Running tests

```bash
npm test                # run all tests once
npm run test:watch      # watch mode (re-runs on file save)
npm run test:coverage   # run with V8 coverage report in ./coverage/
```

Run a single file or directory:

```bash
npx vitest run tests/unit/
npx vitest run tests/db/internal-db.test.ts
npx vitest run tests/api/login.test.ts
```

---

## Stack

- **Runner**: [Vitest](https://vitest.dev/) 4.x — native TypeScript, no transpile step, fast startup
- **Internal DB in tests**: `@libsql/client` with `url: ":memory:"` (set via `INTERNAL_DB_URL` in `vitest.config.ts`) — each test gets a fresh in-memory SQLite instance; no files written to disk
- **Route handler tests**: `NextRequest` constructed directly, no HTTP server required
- **No React component tests**: DataTable and RecordForm are too stateful (16+ hooks, 12+ fetch calls) for reliable unit testing at this stage

---

## Test files

### `tests/unit/format.test.ts` — 18 tests

Pure functions in `lib/format.ts`. No setup required.

| Function | What's tested |
|---|---|
| `formatRelativeTime` | Boundary cases at exactly 60s, 1h, 24h; values just above and below each threshold |
| `formatSize` | Boundary cases at 1 KB (1024 B) and 1 MB (1048576 B); values just below each threshold |

Uses `vi.useFakeTimers()` + `vi.setSystemTime()` to pin `Date.now()` so relative-time assertions are deterministic.

---

### `tests/unit/sql.test.ts` — 29 tests

Pure functions in `lib/sql.ts`. No setup required.

| Function | What's tested |
|---|---|
| `quoteIdentifier` | Correct quote character per DB type (postgres → `"`, mysql/mariadb → `` ` ``, mssql → `[]`, sqlite → `"`); case-insensitive and trims whitespace on dbType |
| `placeholder` | Correct placeholder syntax per DB type (postgres → `$1`, `$3`; mssql → `@p0`, `@p5`; others → `?`) |
| `serializeRow` | `Uint8Array` and `Buffer` values become base64 strings; string/number/null/boolean pass through unchanged |
| `isBinaryType` | `binary`, `varbinary`, `image` → true; case-insensitive; `varchar`, `text` → false |
| `deserializeBinary` | Decodes base64 → Buffer only when colType is a binary type; non-string values and non-binary types pass through unchanged |

---

### `tests/unit/crypto.test.ts` — 13 tests

Pure functions in `lib/crypto.ts`. No setup required.

| Function | What's tested |
|---|---|
| `hashSHA256` | Returns 64 hex chars; deterministic; different salts produce different output; empty value/salt handled |
| `hashSHA512` | Returns valid base64; deterministic; different salts produce different output; produces different output from SHA256 for the same input |
| `generateSalt` | Default call → 32 hex chars (16 bytes); parameterized lengths (8 → 16 chars, 32 → 64 chars); two consecutive calls differ |

---

### `tests/stateful/login-limiter.test.ts` — 13 tests

Tests the in-memory brute-force protection in `lib/login-limiter.ts`.

The limiter tracks failures per `ip:<address>` and `user:<username>` keys independently. Lockout triggers at **10 failures** within a **15-minute window** and lasts **15 minutes**.

Uses `vi.useFakeTimers()` to control time, and `_resetForTesting()` (exported from the module) to clear the in-memory `Map` before each test.

| Scenario | Covered |
|---|---|
| Fresh state | Not blocked |
| Null IP | Treated as `ip:unknown`, no crash |
| 9 failures | Not yet blocked |
| 10th failure | Blocked; `retryAfterMs` ≈ LOCKOUT_MS |
| Lockout expiry | After `LOCKOUT_MS + 1ms`, unblocked again |
| Window reset | Failures older than `WINDOW_MS` are forgotten |
| `recordLoginSuccess` | Clears the block immediately |
| IP isolation | IP block applies to any username from that IP |
| Username isolation | Username block applies from any IP |
| Case insensitivity | `"Alice"` failures block `"ALICE"` checks |

---

### `tests/db/internal-db.test.ts` — 41 tests

Integration tests against a real in-memory SQLite database. Exercises all business logic in `lib/internal-db.ts`.

`_resetForTesting()` is called in `beforeEach`, which clears the module-level singleton so the next database call creates a fresh `:memory:` instance and re-runs `ensureTables()`.

| Area | What's tested |
|---|---|
| `isFirstRun` | `true` on empty DB; `false` after first user |
| `createUser` | Returns correct shape (no `password_hash`); throws on duplicate username |
| `getUsers` | Returns all users without `password_hash` |
| `getUserByUsername` | Returns full user including `password_hash`; `null` for unknown; case-sensitive |
| `getUserById` | Returns correct user; `null` for unknown ID |
| `updateUser` | Updates `password_hash` and `role` independently; returns `false` for empty updates; returns `true` for non-existent ID (UPDATE runs, 0 rows affected — documented behavior) |
| `deleteUser` | Returns `true` and removes user; returns `false` for non-existent ID |
| `getUserTablePolicy` | Returns all-`true` defaults when no policy stored |
| `upsertTablePolicy` | Stores custom permissions; second upsert overwrites |
| `getUserColumnPolicies` | Returns `{}` when no policies; correct result after upsert; multiple columns |
| `logAudit` + `getAuditLogs` | Stores and retrieves entries; filters by action, tableName, username (LIKE); pagination (`page`/`pageSize`); `changes` is deserialized from JSON (not a raw string) |
| `exportAllSettings` + `restoreAllSettings` | Full round-trip (create user → add policies → export → reset → recreate user → restore → verify); returns `skipped_users` for unknown usernames |
| `pruneStaleSettings` | Deletes settings for old `db_fingerprint` when a different connection string is activated |

---

### `tests/api/login.test.ts` — 20 tests

Tests the `POST /api/auth/login` route handler in `app/api/auth/login/route.ts` by constructing `NextRequest` objects directly — no HTTP server needed.

All external dependencies are mocked with `vi.mock`:
- `@/lib/internal-db` → `getUserByUsername`, `logAudit`
- `@/lib/auth` → `signToken`
- `@/lib/login-limiter` → `checkLoginAllowed`, `recordLoginFailure`, `recordLoginSuccess`
- `bcryptjs` → `bcrypt.compare`

| Scenario | Status code | What's asserted |
|---|---|---|
| Missing `username` | 400 | Error message contains "required" |
| Missing `password` | 400 | |
| Both missing | 400 | |
| Rate limited | 429 | `Retry-After` header is `ceil(retryAfterMs / 1000)` |
| Unknown username | 401 | `"Invalid credentials"`; `recordLoginFailure` called with correct IP and username; `logAudit(LOGIN_FAILED)` called without `userId` |
| Wrong password | 401 | `recordLoginFailure` called; `logAudit(LOGIN_FAILED, userId)` called |
| Correct credentials | 200 | `{ user: { id, username, role } }`; `recordLoginSuccess` called; `logAudit(LOGIN)` called; `signToken` called with `{ sub, username, role }` |
| Cookie on success | 200 | `Set-Cookie` header contains `auth_token`, `HttpOnly`, `SameSite=Lax` |
| IP from `x-forwarded-for` | — | First IP extracted and passed to `checkLoginAllowed` |
| IP from `x-real-ip` | — | Fallback when `x-forwarded-for` absent |
| No IP headers | — | `null` passed to `checkLoginAllowed` |
| `getUserByUsername` throws | 500 | |

---

## Architecture notes

### Why `INTERNAL_DB_URL`

`lib/internal-db.ts` uses a module-level singleton (a single `@libsql/client` connection). In tests, `vitest.config.ts` sets `process.env.INTERNAL_DB_URL = ":memory:"`. The singleton reads this env var and uses an in-memory SQLite URL instead of creating `data/app.db` on disk. Combined with `_resetForTesting()` in `beforeEach`, each test starts with a clean, empty database.

### Why `server.deps.external`

`vitest.config.ts` externalizes `/@libsql/` and `/^next/`. Without this, Vite's bundler tries to process these packages and breaks: `@libsql/client` ships native `.node` bindings that cannot be bundled, and `next/server` uses CJS/ESM interop that must be resolved by Node's module system directly.
