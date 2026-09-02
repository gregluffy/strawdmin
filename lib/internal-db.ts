import fs from "fs";
import path from "path";
import type { User, FkDisplaySetting, EncryptionSetting, AuditLog, DbConnection, DbType, DbAccessMode } from "./types";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require("@libsql/client");

type LibsqlClient = {
  execute(opts: { sql: string; args?: unknown[] } | string): Promise<{ rows: Record<string, unknown>[] }>;
};

let client: LibsqlClient | null = null;
let ready: Promise<void> | null = null;

function getDataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

function getDb(): { client: LibsqlClient; ready: Promise<void> } {
  if (!client) {
    const overrideUrl = process.env.INTERNAL_DB_URL;
    if (overrideUrl) {
      client = createClient({ url: overrideUrl });
    } else {
      const dataDir = getDataDir();
      fs.mkdirSync(dataDir, { recursive: true });
      const dbPath = path.join(dataDir, "app.db").replace(/\\/g, "/");
      client = createClient({ url: `file:${dbPath}` });
    }
    ready = ensureTables(client as LibsqlClient);
  }
  return { client: client!, ready: ready! };
}

async function ensureTables(db: LibsqlClient): Promise<void> {
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  )`);
  // Per-user visibility of DB connections. `users.db_access_mode` decides whether the
  // rows here apply at all: 'all' (default) ignores them, 'restricted' limits the user
  // to exactly the connections listed. Added via ALTER TABLE for existing installs.
  try { await db.execute(`ALTER TABLE users ADD COLUMN db_access_mode TEXT NOT NULL DEFAULT 'all'`); } catch { /* already exists */ }
  await db.execute(`CREATE TABLE IF NOT EXISTS user_db_access (
    user_id INTEGER NOT NULL,
    conn_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, conn_id)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS db_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    db_type TEXT NOT NULL,
    connection_string TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  // SSH tunnel columns — added via ALTER TABLE for backwards-compat with existing installs
  for (const [col, def] of [
    ["ssh_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["ssh_host", "TEXT"],
    ["ssh_port", "INTEGER"],
    ["ssh_user", "TEXT"],
    ["ssh_auth_type", "TEXT"],
    ["ssh_password", "TEXT"],
    ["ssh_private_key", "TEXT"],
    ["ssh_passphrase", "TEXT"],
    ["is_pinned", "INTEGER NOT NULL DEFAULT 0"],
  ] as [string, string][]) {
    try { await db.execute(`ALTER TABLE db_connections ADD COLUMN ${col} ${def}`); } catch { /* already exists */ }
  }
  await db.execute(`CREATE TABLE IF NOT EXISTS fk_display_settings (
    db_fingerprint TEXT NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT NOT NULL,
    display_field TEXT NOT NULL,
    PRIMARY KEY (db_fingerprint, table_name, column_name)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS field_encryption_settings (
    db_fingerprint TEXT NOT NULL,
    table_name     TEXT NOT NULL,
    column_name    TEXT NOT NULL,
    algorithm      TEXT NOT NULL,
    salt_column    TEXT,
    PRIMARY KEY (db_fingerprint, table_name, column_name)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS table_view_settings (
    db_fingerprint TEXT NOT NULL,
    table_name     TEXT NOT NULL,
    visible_cols   TEXT NOT NULL,
    sort_col       TEXT NOT NULL,
    sort_dir       TEXT NOT NULL DEFAULT 'asc',
    PRIMARY KEY (db_fingerprint, table_name)
  )`);
  try { await db.execute(`ALTER TABLE table_view_settings ADD COLUMN all_cols TEXT`); } catch { /* already exists */ }
  await db.execute(`CREATE TABLE IF NOT EXISTS table_policies (
    db_fingerprint TEXT NOT NULL,
    user_id        INTEGER NOT NULL,
    table_name     TEXT NOT NULL,
    can_view       INTEGER NOT NULL DEFAULT 1,
    can_insert     INTEGER NOT NULL DEFAULT 1,
    can_update     INTEGER NOT NULL DEFAULT 1,
    can_delete     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (db_fingerprint, user_id, table_name)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS column_policies (
    db_fingerprint TEXT NOT NULL,
    user_id        INTEGER NOT NULL,
    table_name     TEXT NOT NULL,
    column_name    TEXT NOT NULL,
    hidden         INTEGER NOT NULL DEFAULT 0,
    read_only      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (db_fingerprint, user_id, table_name, column_name)
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS audit_logs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    db_fingerprint TEXT NOT NULL,
    user_id        INTEGER,
    username       TEXT NOT NULL,
    action         TEXT NOT NULL,
    table_name     TEXT,
    record_id      TEXT,
    changes        TEXT,
    ip             TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_fp_time
    ON audit_logs(db_fingerprint, created_at DESC)`);
  await db.execute(`CREATE TABLE IF NOT EXISTS login_rate_limits (
    key          TEXT PRIMARY KEY,
    fails        INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS diagram_positions (
    db_fingerprint TEXT NOT NULL,
    table_name     TEXT NOT NULL,
    x              REAL NOT NULL,
    y              REAL NOT NULL,
    PRIMARY KEY (db_fingerprint, table_name)
  )`);
}

export async function db(): Promise<LibsqlClient> {
  const { client, ready } = getDb();
  await ready;
  return client;
}

function getDbFingerprint(connId: number): string {
  return `conn:${connId}`;
}

// ── DB connection management ────────────────────────────────────────────────

function rowToDbConnection(r: Record<string, unknown>): DbConnection {
  return {
    id: Number(r.id),
    name: String(r.name),
    db_type: String(r.db_type) as DbType,
    connection_string: String(r.connection_string),
    created_at: String(r.created_at),
    is_pinned: Boolean(Number(r.is_pinned ?? 0)),
    ssh_enabled: r.ssh_enabled ? Boolean(Number(r.ssh_enabled)) : false,
    ssh_host: r.ssh_host != null ? String(r.ssh_host) : undefined,
    ssh_port: r.ssh_port != null ? Number(r.ssh_port) : undefined,
    ssh_user: r.ssh_user != null ? String(r.ssh_user) : undefined,
    ssh_auth_type: r.ssh_auth_type != null ? (String(r.ssh_auth_type) as "password" | "key") : undefined,
    ssh_password: r.ssh_password != null ? String(r.ssh_password) : undefined,
    ssh_private_key: r.ssh_private_key != null ? String(r.ssh_private_key) : undefined,
    ssh_passphrase: r.ssh_passphrase != null ? String(r.ssh_passphrase) : undefined,
  };
}

const CONN_COLS = "id, name, db_type, connection_string, created_at, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, ssh_passphrase, is_pinned";

export async function listDbConnections(): Promise<DbConnection[]> {
  const c = await db();
  const rows = await c.execute(`SELECT ${CONN_COLS} FROM db_connections ORDER BY id`);
  return rows.rows.map(rowToDbConnection);
}

export async function getDbConnection(id: number): Promise<DbConnection | null> {
  const c = await db();
  const rows = await c.execute({ sql: `SELECT ${CONN_COLS} FROM db_connections WHERE id = ?`, args: [id] });
  if (rows.rows.length === 0) return null;
  return rowToDbConnection(rows.rows[0]);
}

export async function getPinnedDbConnection(): Promise<DbConnection | null> {
  const c = await db();
  const rows = await c.execute(`SELECT ${CONN_COLS} FROM db_connections WHERE is_pinned = 1 LIMIT 1`);
  if (rows.rows.length === 0) return null;
  return rowToDbConnection(rows.rows[0]);
}

export async function setPinnedDbConnection(id: number | null): Promise<void> {
  const c = await db();
  await c.execute("UPDATE db_connections SET is_pinned = 0");
  if (id !== null) {
    await c.execute({ sql: "UPDATE db_connections SET is_pinned = 1 WHERE id = ?", args: [id] });
  }
}

export async function getDiagramPositions(connId: number): Promise<Record<string, { x: number; y: number }>> {
  const c = await db();
  const fp = getDbFingerprint(connId);
  const rows = await c.execute({ sql: "SELECT table_name, x, y FROM diagram_positions WHERE db_fingerprint = ?", args: [fp] });
  const out: Record<string, { x: number; y: number }> = {};
  for (const r of rows.rows) out[String(r.table_name)] = { x: Number(r.x), y: Number(r.y) };
  return out;
}

export async function saveDiagramPositions(connId: number, positions: Record<string, { x: number; y: number }>): Promise<void> {
  const c = await db();
  const fp = getDbFingerprint(connId);
  await c.execute({ sql: "DELETE FROM diagram_positions WHERE db_fingerprint = ?", args: [fp] });
  for (const [table_name, { x, y }] of Object.entries(positions)) {
    await c.execute({ sql: "INSERT INTO diagram_positions (db_fingerprint, table_name, x, y) VALUES (?, ?, ?, ?)", args: [fp, table_name, x, y] });
  }
}

export interface SshSettings {
  ssh_enabled?: boolean;
  ssh_host?: string | null;
  ssh_port?: number | null;
  ssh_user?: string | null;
  ssh_auth_type?: "password" | "key" | null;
  ssh_password?: string | null;
  ssh_private_key?: string | null;
  ssh_passphrase?: string | null;
}

export async function createDbConnection(
  name: string,
  db_type: DbType,
  connection_string: string,
  ssh?: SshSettings
): Promise<DbConnection> {
  const c = await db();
  const created_at = new Date().toISOString();
  await c.execute({
    sql: `INSERT INTO db_connections (name, db_type, connection_string, created_at, ssh_enabled, ssh_host, ssh_port, ssh_user, ssh_auth_type, ssh_password, ssh_private_key, ssh_passphrase)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      name, db_type, connection_string, created_at,
      ssh?.ssh_enabled ? 1 : 0,
      ssh?.ssh_host ?? null,
      ssh?.ssh_port ?? null,
      ssh?.ssh_user ?? null,
      ssh?.ssh_auth_type ?? null,
      ssh?.ssh_password ?? null,
      ssh?.ssh_private_key ?? null,
      ssh?.ssh_passphrase ?? null,
    ],
  });
  const rows = await c.execute({ sql: `SELECT ${CONN_COLS} FROM db_connections WHERE name = ? AND created_at = ?`, args: [name, created_at] });
  return rowToDbConnection(rows.rows[rows.rows.length - 1]);
}

export async function updateDbConnection(
  id: number,
  updates: Partial<Pick<DbConnection, "name" | "db_type" | "connection_string"> & SshSettings>
): Promise<boolean> {
  const c = await db();
  const parts: string[] = [];
  const args: unknown[] = [];
  if (updates.name !== undefined) { parts.push("name = ?"); args.push(updates.name); }
  if (updates.db_type !== undefined) { parts.push("db_type = ?"); args.push(updates.db_type); }
  if (updates.connection_string !== undefined) { parts.push("connection_string = ?"); args.push(updates.connection_string); }
  if (updates.ssh_enabled !== undefined) { parts.push("ssh_enabled = ?"); args.push(updates.ssh_enabled ? 1 : 0); }
  if (updates.ssh_host !== undefined) { parts.push("ssh_host = ?"); args.push(updates.ssh_host || null); }
  if (updates.ssh_port !== undefined) { parts.push("ssh_port = ?"); args.push(updates.ssh_port || null); }
  if (updates.ssh_user !== undefined) { parts.push("ssh_user = ?"); args.push(updates.ssh_user || null); }
  if (updates.ssh_auth_type !== undefined) { parts.push("ssh_auth_type = ?"); args.push(updates.ssh_auth_type || null); }
  // Credentials only updated when explicitly provided (non-undefined, non-null — empty string clears)
  if (updates.ssh_password !== undefined) { parts.push("ssh_password = ?"); args.push(updates.ssh_password || null); }
  if (updates.ssh_private_key !== undefined) { parts.push("ssh_private_key = ?"); args.push(updates.ssh_private_key || null); }
  if (updates.ssh_passphrase !== undefined) { parts.push("ssh_passphrase = ?"); args.push(updates.ssh_passphrase || null); }
  if (parts.length === 0) return false;
  args.push(id);
  await c.execute({ sql: `UPDATE db_connections SET ${parts.join(", ")} WHERE id = ?`, args });
  return true;
}

export async function deleteDbConnection(id: number): Promise<boolean> {
  const c = await db();
  const before = await c.execute({ sql: "SELECT id FROM db_connections WHERE id = ?", args: [id] });
  if (before.rows.length === 0) return false;
  await c.execute({ sql: "DELETE FROM db_connections WHERE id = ?", args: [id] });
  await c.execute({ sql: "DELETE FROM user_db_access WHERE conn_id = ?", args: [id] });
  return true;
}

// ── Per-user DB connection access ───────────────────────────────────────────

export type UserDbAccess = {
  mode: DbAccessMode;
  conn_ids: number[];
};

const UNRESTRICTED: UserDbAccess = { mode: "all", conn_ids: [] };

export async function getUserDbAccess(userId: number): Promise<UserDbAccess> {
  const c = await db();
  const modeRows = await c.execute({ sql: "SELECT db_access_mode FROM users WHERE id = ?", args: [userId] });
  if (modeRows.rows.length === 0) return { ...UNRESTRICTED };
  const mode: DbAccessMode = modeRows.rows[0].db_access_mode === "restricted" ? "restricted" : "all";
  const rows = await c.execute({ sql: "SELECT conn_id FROM user_db_access WHERE user_id = ? ORDER BY conn_id", args: [userId] });
  return { mode, conn_ids: rows.rows.map((r) => Number(r.conn_id)) };
}

export async function setUserDbAccess(userId: number, mode: DbAccessMode, connIds: number[]): Promise<boolean> {
  const c = await db();
  const exists = await c.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [userId] });
  if (exists.rows.length === 0) return false;
  await c.execute({ sql: "UPDATE users SET db_access_mode = ? WHERE id = ?", args: [mode, userId] });
  await c.execute({ sql: "DELETE FROM user_db_access WHERE user_id = ?", args: [userId] });
  if (mode === "restricted") {
    for (const connId of [...new Set(connIds)]) {
      await c.execute({ sql: "INSERT INTO user_db_access (user_id, conn_id) VALUES (?, ?)", args: [userId, connId] });
    }
  }
  return true;
}

/** Access rows for every user, keyed by user id — avoids an N+1 on the users page. */
export async function getAllUserDbAccess(): Promise<Map<number, UserDbAccess>> {
  const c = await db();
  const out = new Map<number, UserDbAccess>();
  const users = await c.execute("SELECT id, db_access_mode FROM users");
  for (const u of users.rows) {
    out.set(Number(u.id), { mode: u.db_access_mode === "restricted" ? "restricted" : "all", conn_ids: [] });
  }
  const rows = await c.execute("SELECT user_id, conn_id FROM user_db_access ORDER BY conn_id");
  for (const r of rows.rows) out.get(Number(r.user_id))?.conn_ids.push(Number(r.conn_id));
  return out;
}

export async function isConnectionAllowedForUser(userId: number, connId: number): Promise<boolean> {
  const access = await getUserDbAccess(userId);
  return access.mode === "all" || access.conn_ids.includes(connId);
}

export async function listDbConnectionsForUser(userId: number): Promise<DbConnection[]> {
  const [connections, access] = await Promise.all([listDbConnections(), getUserDbAccess(userId)]);
  if (access.mode === "all") return connections;
  const allowed = new Set(access.conn_ids);
  return connections.filter((c) => allowed.has(c.id));
}

// ── User functions ──────────────────────────────────────────────────────────

export async function isFirstRun(): Promise<boolean> {
  try {
    const c = await db();
    const rows = await c.execute({ sql: "SELECT 1 FROM users LIMIT 1", args: [] });
    return rows.rows.length === 0;
  } catch {
    return true;
  }
}

export async function getUsers(): Promise<(Omit<User, "password_hash"> & UserDbAccess)[]> {
  const c = await db();
  const rows = await c.execute("SELECT id, username, role, created_at FROM users ORDER BY id");
  const access = await getAllUserDbAccess();
  return rows.rows.map((r) => {
    const id = Number(r.id);
    const a = access.get(id) ?? UNRESTRICTED;
    return {
      id,
      username: String(r.username),
      role: r.role as "admin" | "user",
      created_at: String(r.created_at),
      mode: a.mode,
      conn_ids: a.conn_ids,
    };
  });
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const c = await db();
  const rows = await c.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [username] });
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return {
    id: Number(r.id),
    username: String(r.username),
    password_hash: String(r.password_hash),
    role: r.role as "admin" | "user",
    created_at: String(r.created_at),
  };
}

export async function getUserById(id: number): Promise<User | null> {
  const c = await db();
  const rows = await c.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  return {
    id: Number(r.id),
    username: String(r.username),
    password_hash: String(r.password_hash),
    role: r.role as "admin" | "user",
    created_at: String(r.created_at),
  };
}

export async function createUser(
  username: string,
  password_hash: string,
  role: "admin" | "user"
): Promise<Omit<User, "password_hash">> {
  const c = await db();
  const created_at = new Date().toISOString();
  await c.execute({
    sql: "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
    args: [username, password_hash, role, created_at],
  });
  const rows = await c.execute({ sql: "SELECT * FROM users WHERE username = ?", args: [username] });
  const r = rows.rows[0];
  return {
    id: Number(r.id),
    username: String(r.username),
    role: r.role as "admin" | "user",
    created_at: String(r.created_at),
  };
}

export async function updateUser(
  id: number,
  updates: Partial<Pick<User, "password_hash" | "role">>
): Promise<boolean> {
  const c = await db();
  const parts: string[] = [];
  const args: unknown[] = [];
  if (updates.password_hash !== undefined) { parts.push("password_hash = ?"); args.push(updates.password_hash); }
  if (updates.role !== undefined) { parts.push("role = ?"); args.push(updates.role); }
  if (parts.length === 0) return false;
  args.push(id);
  await c.execute({ sql: `UPDATE users SET ${parts.join(", ")} WHERE id = ?`, args });
  return true;
}

export async function deleteUser(id: number): Promise<boolean> {
  const c = await db();
  const before = await c.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [id] });
  if (before.rows.length === 0) return false;
  await c.execute({ sql: "DELETE FROM users WHERE id = ?", args: [id] });
  await c.execute({ sql: "DELETE FROM user_db_access WHERE user_id = ?", args: [id] });
  return true;
}

// ── FK display settings ─────────────────────────────────────────────────────

function parseDisplayPath(stored: string): string[] {
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
  } catch {}
  return [stored]; // legacy plain string stored before path support
}

export async function getFkSettings(tableName: string, connId: number): Promise<FkDisplaySetting[]> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT column_name, display_field FROM fk_display_settings WHERE db_fingerprint = ? AND table_name = ?",
    args: [fingerprint, tableName],
  });
  return rows.rows.map((r) => ({
    column_name: String(r.column_name),
    display_path: parseDisplayPath(String(r.display_field)),
  }));
}

export async function deleteFkSetting(
  tableName: string,
  columnName: string,
  connId: number
): Promise<void> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  await c.execute({
    sql: "DELETE FROM fk_display_settings WHERE db_fingerprint = ? AND table_name = ? AND column_name = ?",
    args: [fingerprint, tableName, columnName],
  });
}

export async function upsertFkSetting(
  tableName: string,
  columnName: string,
  displayPath: string[],
  connId: number
): Promise<void> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO fk_display_settings (db_fingerprint, table_name, column_name, display_field)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(db_fingerprint, table_name, column_name) DO UPDATE SET display_field = excluded.display_field`,
    args: [fingerprint, tableName, columnName, JSON.stringify(displayPath)],
  });
}

// ── Encryption settings ─────────────────────────────────────────────────────

export async function getEncryptionSettings(tableName: string, connId: number): Promise<EncryptionSetting[]> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT column_name, algorithm, salt_column FROM field_encryption_settings WHERE db_fingerprint = ? AND table_name = ?",
    args: [fingerprint, tableName],
  });
  return rows.rows.map((r) => ({
    column_name: String(r.column_name),
    algorithm: String(r.algorithm),
    salt_column: r.salt_column != null ? String(r.salt_column) : null,
  }));
}

export async function upsertEncryptionSetting(
  tableName: string,
  columnName: string,
  algorithm: string,
  saltColumn: string | undefined,
  connId: number
): Promise<void> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO field_encryption_settings (db_fingerprint, table_name, column_name, algorithm, salt_column)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(db_fingerprint, table_name, column_name)
          DO UPDATE SET algorithm = excluded.algorithm, salt_column = excluded.salt_column`,
    args: [fingerprint, tableName, columnName, algorithm, saltColumn ?? null],
  });
}

export async function deleteEncryptionSetting(
  tableName: string,
  columnName: string,
  connId: number
): Promise<void> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  await c.execute({
    sql: "DELETE FROM field_encryption_settings WHERE db_fingerprint = ? AND table_name = ? AND column_name = ?",
    args: [fingerprint, tableName, columnName],
  });
}

// ── Table view settings ─────────────────────────────────────────────────────

export interface ViewSettings {
  visible_cols: string[];
  all_cols: string[] | null;
  sort_col: string;
  sort_dir: "asc" | "desc";
}

export async function getViewSettings(tableName: string, connId: number): Promise<ViewSettings | null> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT visible_cols, all_cols, sort_col, sort_dir FROM table_view_settings WHERE db_fingerprint = ? AND table_name = ?",
    args: [fingerprint, tableName],
  });
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  try {
    return {
      visible_cols: JSON.parse(String(r.visible_cols)) as string[],
      all_cols: r.all_cols ? (JSON.parse(String(r.all_cols)) as string[]) : null,
      sort_col: String(r.sort_col),
      sort_dir: r.sort_dir === "desc" ? "desc" : "asc",
    };
  } catch {
    return null;
  }
}

export async function upsertViewSettings(
  tableName: string,
  visibleCols: string[],
  allCols: string[],
  sortCol: string,
  sortDir: "asc" | "desc",
  connId: number
): Promise<void> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO table_view_settings (db_fingerprint, table_name, visible_cols, all_cols, sort_col, sort_dir)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(db_fingerprint, table_name)
          DO UPDATE SET visible_cols = excluded.visible_cols, all_cols = excluded.all_cols, sort_col = excluded.sort_col, sort_dir = excluded.sort_dir`,
    args: [fingerprint, tableName, JSON.stringify(visibleCols), JSON.stringify(allCols), sortCol, sortDir],
  });
}

// ── Table & column policies ─────────────────────────────────────────────────

const DEFAULT_TABLE_POLICY = { can_view: true, can_insert: false, can_update: false, can_delete: false };

export async function getUserTablePolicy(
  userId: number,
  tableName: string,
  connId: number
): Promise<{ can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT can_view, can_insert, can_update, can_delete FROM table_policies WHERE db_fingerprint = ? AND user_id = ? AND table_name = ?",
    args: [fingerprint, userId, tableName],
  });
  if (rows.rows.length === 0) return { ...DEFAULT_TABLE_POLICY };
  const r = rows.rows[0];
  return {
    can_view: r.can_view !== 0,
    can_insert: r.can_insert !== 0,
    can_update: r.can_update !== 0,
    can_delete: r.can_delete !== 0,
  };
}

export async function getUserColumnPolicies(
  userId: number,
  tableName: string,
  connId: number
): Promise<Record<string, { hidden: boolean; read_only: boolean }>> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT column_name, hidden, read_only FROM column_policies WHERE db_fingerprint = ? AND user_id = ? AND table_name = ?",
    args: [fingerprint, userId, tableName],
  });
  const out: Record<string, { hidden: boolean; read_only: boolean }> = {};
  for (const r of rows.rows) {
    out[String(r.column_name)] = { hidden: r.hidden !== 0, read_only: r.read_only !== 0 };
  }
  return out;
}

export async function getTablePoliciesForTable(tableName: string, connId: number): Promise<
  { user_id: number; can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }[]
> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT user_id, can_view, can_insert, can_update, can_delete FROM table_policies WHERE db_fingerprint = ? AND table_name = ?",
    args: [fingerprint, tableName],
  });
  return rows.rows.map((r) => ({
    user_id: Number(r.user_id),
    can_view: r.can_view !== 0,
    can_insert: r.can_insert !== 0,
    can_update: r.can_update !== 0,
    can_delete: r.can_delete !== 0,
  }));
}

export async function getColumnPoliciesForTable(tableName: string, connId: number): Promise<
  { user_id: number; column_name: string; hidden: boolean; read_only: boolean }[]
> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT user_id, column_name, hidden, read_only FROM column_policies WHERE db_fingerprint = ? AND table_name = ?",
    args: [fingerprint, tableName],
  });
  return rows.rows.map((r) => ({
    user_id: Number(r.user_id),
    column_name: String(r.column_name),
    hidden: r.hidden !== 0,
    read_only: r.read_only !== 0,
  }));
}

export async function upsertTablePolicy(
  userId: number,
  tableName: string,
  policy: { can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean },
  connId: number
): Promise<void> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO table_policies (db_fingerprint, user_id, table_name, can_view, can_insert, can_update, can_delete)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(db_fingerprint, user_id, table_name)
          DO UPDATE SET can_view=excluded.can_view, can_insert=excluded.can_insert,
                        can_update=excluded.can_update, can_delete=excluded.can_delete`,
    args: [fingerprint, userId, tableName, policy.can_view ? 1 : 0, policy.can_insert ? 1 : 0, policy.can_update ? 1 : 0, policy.can_delete ? 1 : 0],
  });
}

export async function upsertColumnPolicy(
  userId: number,
  tableName: string,
  columnName: string,
  policy: { hidden: boolean; read_only: boolean },
  connId: number
): Promise<void> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO column_policies (db_fingerprint, user_id, table_name, column_name, hidden, read_only)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(db_fingerprint, user_id, table_name, column_name)
          DO UPDATE SET hidden=excluded.hidden, read_only=excluded.read_only`,
    args: [fingerprint, userId, tableName, columnName, policy.hidden ? 1 : 0, policy.read_only ? 1 : 0],
  });
}

// ── Settings backup / restore ───────────────────────────────────────────────

export async function exportAllSettings(connId: number): Promise<{
  fk_display: { table_name: string; column_name: string; display_field: string }[];
  field_encryption: { table_name: string; column_name: string; algorithm: string; salt_column: string | null }[];
  view_settings: { table_name: string; visible_cols: string[]; sort_col: string; sort_dir: string }[];
  table_policies: { user_id: number; username: string; table_name: string; can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }[];
  column_policies: { user_id: number; username: string; table_name: string; column_name: string; hidden: boolean; read_only: boolean }[];
}> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();

  const fkRows = await c.execute({ sql: "SELECT table_name, column_name, display_field FROM fk_display_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  const encRows = await c.execute({ sql: "SELECT table_name, column_name, algorithm, salt_column FROM field_encryption_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  const viewRows = await c.execute({ sql: "SELECT table_name, visible_cols, sort_col, sort_dir FROM table_view_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  const tpRows = await c.execute({ sql: "SELECT tp.user_id, u.username, tp.table_name, tp.can_view, tp.can_insert, tp.can_update, tp.can_delete FROM table_policies tp JOIN users u ON tp.user_id = u.id WHERE tp.db_fingerprint = ?", args: [fingerprint] });
  const cpRows = await c.execute({ sql: "SELECT cp.user_id, u.username, cp.table_name, cp.column_name, cp.hidden, cp.read_only FROM column_policies cp JOIN users u ON cp.user_id = u.id WHERE cp.db_fingerprint = ?", args: [fingerprint] });

  return {
    fk_display: fkRows.rows.map((r) => ({ table_name: String(r.table_name), column_name: String(r.column_name), display_field: String(r.display_field) })),
    field_encryption: encRows.rows.map((r) => ({ table_name: String(r.table_name), column_name: String(r.column_name), algorithm: String(r.algorithm), salt_column: r.salt_column != null ? String(r.salt_column) : null })),
    view_settings: viewRows.rows.map((r) => { try { return { table_name: String(r.table_name), visible_cols: JSON.parse(String(r.visible_cols)), sort_col: String(r.sort_col), sort_dir: String(r.sort_dir) }; } catch { return null; } }).filter(Boolean) as { table_name: string; visible_cols: string[]; sort_col: string; sort_dir: string }[],
    table_policies: tpRows.rows.map((r) => ({ user_id: Number(r.user_id), username: String(r.username), table_name: String(r.table_name), can_view: r.can_view !== 0, can_insert: r.can_insert !== 0, can_update: r.can_update !== 0, can_delete: r.can_delete !== 0 })),
    column_policies: cpRows.rows.map((r) => ({ user_id: Number(r.user_id), username: String(r.username), table_name: String(r.table_name), column_name: String(r.column_name), hidden: r.hidden !== 0, read_only: r.read_only !== 0 })),
  };
}

export async function restoreAllSettings(backup: {
  fk_display?: { table_name: string; column_name: string; display_field: string }[];
  field_encryption?: { table_name: string; column_name: string; algorithm: string; salt_column: string | null }[];
  view_settings?: { table_name: string; visible_cols: string[]; sort_col: string; sort_dir: string }[];
  table_policies?: { username: string; table_name: string; can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }[];
  column_policies?: { username: string; table_name: string; column_name: string; hidden: boolean; read_only: boolean }[];
}, connId: number): Promise<{ skipped_users: string[] }> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();

  await c.execute({ sql: "DELETE FROM fk_display_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM field_encryption_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM table_view_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM table_policies WHERE db_fingerprint = ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM column_policies WHERE db_fingerprint = ?", args: [fingerprint] });

  for (const r of backup.fk_display ?? []) {
    await c.execute({ sql: "INSERT INTO fk_display_settings (db_fingerprint, table_name, column_name, display_field) VALUES (?,?,?,?)", args: [fingerprint, r.table_name, r.column_name, JSON.stringify(parseDisplayPath(r.display_field))] });
  }
  for (const r of backup.field_encryption ?? []) {
    await c.execute({ sql: "INSERT INTO field_encryption_settings (db_fingerprint, table_name, column_name, algorithm, salt_column) VALUES (?,?,?,?,?)", args: [fingerprint, r.table_name, r.column_name, r.algorithm, r.salt_column ?? null] });
  }
  for (const r of backup.view_settings ?? []) {
    await c.execute({ sql: "INSERT INTO table_view_settings (db_fingerprint, table_name, visible_cols, sort_col, sort_dir) VALUES (?,?,?,?,?)", args: [fingerprint, r.table_name, JSON.stringify(r.visible_cols), r.sort_col, r.sort_dir] });
  }

  const skipped_users: string[] = [];
  const usernameToId = new Map<string, number>();
  const allUsers = await c.execute("SELECT id, username FROM users");
  for (const u of allUsers.rows) usernameToId.set(String(u.username), Number(u.id));

  for (const r of backup.table_policies ?? []) {
    const uid = usernameToId.get(r.username);
    if (!uid) { if (!skipped_users.includes(r.username)) skipped_users.push(r.username); continue; }
    await c.execute({ sql: "INSERT INTO table_policies (db_fingerprint, user_id, table_name, can_view, can_insert, can_update, can_delete) VALUES (?,?,?,?,?,?,?)", args: [fingerprint, uid, r.table_name, r.can_view ? 1 : 0, r.can_insert ? 1 : 0, r.can_update ? 1 : 0, r.can_delete ? 1 : 0] });
  }
  for (const r of backup.column_policies ?? []) {
    const uid = usernameToId.get(r.username);
    if (!uid) { if (!skipped_users.includes(r.username)) skipped_users.push(r.username); continue; }
    await c.execute({ sql: "INSERT INTO column_policies (db_fingerprint, user_id, table_name, column_name, hidden, read_only) VALUES (?,?,?,?,?,?)", args: [fingerprint, uid, r.table_name, r.column_name, r.hidden ? 1 : 0, r.read_only ? 1 : 0] });
  }

  return { skipped_users };
}

// ── Audit log ───────────────────────────────────────────────────────────────

export async function logAudit(entry: {
  userId?: number | null;
  username: string;
  action: string;
  tableName?: string;
  recordId?: string;
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
  ip?: string | null;
}, connId: number = 0): Promise<void> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO audit_logs (db_fingerprint, user_id, username, action, table_name, record_id, changes, ip, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      fingerprint,
      entry.userId ?? null,
      entry.username,
      entry.action,
      entry.tableName ?? null,
      entry.recordId ?? null,
      entry.changes ? JSON.stringify(entry.changes) : null,
      entry.ip ?? null,
    ],
  });
}

/** @internal */
export function _resetForTesting(): void {
  client = null;
  ready = null;
}

export async function getAuditLogs(opts: {
  page?: number;
  pageSize?: number;
  action?: string;
  tableName?: string;
  username?: string;
  from?: string;
  to?: string;
}, connId: number): Promise<{ logs: AuditLog[]; total: number }> {
  const fingerprint = getDbFingerprint(connId);
  const c = await db();
  const { page = 1, pageSize = 50, action, tableName, username, from, to } = opts;
  const offset = (Math.max(1, page) - 1) * pageSize;

  // Always include system-level events (connId=0: login, logout) alongside per-connection events
  const systemFingerprint = getDbFingerprint(0);
  const conditions: string[] = [
    fingerprint === systemFingerprint
      ? "db_fingerprint = ?"
      : "(db_fingerprint = ? OR db_fingerprint = ?)",
  ];
  const args: unknown[] = fingerprint === systemFingerprint
    ? [fingerprint]
    : [fingerprint, systemFingerprint];

  if (action) { conditions.push("action = ?"); args.push(action); }
  if (tableName) { conditions.push("table_name = ?"); args.push(tableName); }
  if (username) { conditions.push("username LIKE ?"); args.push(`%${username}%`); }
  if (from) { conditions.push("created_at >= ?"); args.push(from); }
  if (to) { conditions.push("created_at <= ?"); args.push(`${to} 23:59:59`); }

  const where = conditions.join(" AND ");

  const countResult = await c.execute({ sql: `SELECT COUNT(*) as total FROM audit_logs WHERE ${where}`, args });
  const rows = await c.execute({
    sql: `SELECT * FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    args: [...args, pageSize, offset],
  });

  return {
    total: Number(countResult.rows[0]?.total ?? 0),
    logs: rows.rows.map((r) => ({
      id: Number(r.id),
      db_fingerprint: String(r.db_fingerprint),
      user_id: r.user_id != null ? Number(r.user_id) : null,
      username: String(r.username),
      action: String(r.action) as AuditLog["action"],
      table_name: r.table_name != null ? String(r.table_name) : null,
      record_id: r.record_id != null ? String(r.record_id) : null,
      changes: r.changes != null ? (() => { try { return JSON.parse(String(r.changes)); } catch { return null; } })() : null,
      ip: r.ip != null ? String(r.ip) : null,
      created_at: String(r.created_at),
    })),
  };
}
