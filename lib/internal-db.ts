import fs from "fs";
import path from "path";
import type { User, FkDisplaySetting, EncryptionSetting } from "./types";

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
    const dataDir = getDataDir();
    fs.mkdirSync(dataDir, { recursive: true });
    // Normalize to forward slashes — @libsql/client requires a valid file: URL
    // and Windows path.join() returns backslashes which break the URL parser.
    const dbPath = path.join(dataDir, "app.db").replace(/\\/g, "/");
    client = createClient({ url: `file:${dbPath}` });
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
}

async function db(): Promise<LibsqlClient> {
  const { client, ready } = getDb();
  await ready;
  return client;
}

function getDbFingerprint(): string {
  const type = process.env.DB_TYPE ?? "sqlite";
  const conn = process.env.DB_CONNECTION_STRING ?? "";
  return `${type}:${conn}`;
}

async function pruneStaleSettings(fingerprint: string): Promise<void> {
  const c = await db();
  await c.execute({ sql: "DELETE FROM fk_display_settings WHERE db_fingerprint != ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM field_encryption_settings WHERE db_fingerprint != ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM table_view_settings WHERE db_fingerprint != ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM table_policies WHERE db_fingerprint != ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM column_policies WHERE db_fingerprint != ?", args: [fingerprint] });
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

export async function getUsers(): Promise<Omit<User, "password_hash">[]> {
  const c = await db();
  const rows = await c.execute("SELECT id, username, role, created_at FROM users ORDER BY id");
  return rows.rows.map((r) => ({
    id: Number(r.id),
    username: String(r.username),
    role: r.role as "admin" | "user",
    created_at: String(r.created_at),
  }));
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
  return true;
}

// ── FK display settings ─────────────────────────────────────────────────────

export async function getFkSettings(tableName: string): Promise<FkDisplaySetting[]> {
  const fingerprint = getDbFingerprint();
  await pruneStaleSettings(fingerprint);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT column_name, display_field FROM fk_display_settings WHERE db_fingerprint = ? AND table_name = ?",
    args: [fingerprint, tableName],
  });
  return rows.rows.map((r) => ({
    column_name: String(r.column_name),
    display_field: String(r.display_field),
  }));
}

export async function upsertFkSetting(
  tableName: string,
  columnName: string,
  displayField: string
): Promise<void> {
  const fingerprint = getDbFingerprint();
  await pruneStaleSettings(fingerprint);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO fk_display_settings (db_fingerprint, table_name, column_name, display_field)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(db_fingerprint, table_name, column_name) DO UPDATE SET display_field = excluded.display_field`,
    args: [fingerprint, tableName, columnName, displayField],
  });
}

// ── Encryption settings ─────────────────────────────────────────────────────

export async function getEncryptionSettings(tableName: string): Promise<EncryptionSetting[]> {
  const fingerprint = getDbFingerprint();
  await pruneStaleSettings(fingerprint);
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
  saltColumn?: string
): Promise<void> {
  const fingerprint = getDbFingerprint();
  await pruneStaleSettings(fingerprint);
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
  columnName: string
): Promise<void> {
  const fingerprint = getDbFingerprint();
  await pruneStaleSettings(fingerprint);
  const c = await db();
  await c.execute({
    sql: "DELETE FROM field_encryption_settings WHERE db_fingerprint = ? AND table_name = ? AND column_name = ?",
    args: [fingerprint, tableName, columnName],
  });
}

// ── Table view settings ─────────────────────────────────────────────────────

export interface ViewSettings {
  visible_cols: string[];
  sort_col: string;
  sort_dir: "asc" | "desc";
}

export async function getViewSettings(tableName: string): Promise<ViewSettings | null> {
  const fingerprint = getDbFingerprint();
  await pruneStaleSettings(fingerprint);
  const c = await db();
  const rows = await c.execute({
    sql: "SELECT visible_cols, sort_col, sort_dir FROM table_view_settings WHERE db_fingerprint = ? AND table_name = ?",
    args: [fingerprint, tableName],
  });
  if (rows.rows.length === 0) return null;
  const r = rows.rows[0];
  try {
    return {
      visible_cols: JSON.parse(String(r.visible_cols)) as string[],
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
  sortCol: string,
  sortDir: "asc" | "desc"
): Promise<void> {
  const fingerprint = getDbFingerprint();
  await pruneStaleSettings(fingerprint);
  const c = await db();
  await c.execute({
    sql: `INSERT INTO table_view_settings (db_fingerprint, table_name, visible_cols, sort_col, sort_dir)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(db_fingerprint, table_name)
          DO UPDATE SET visible_cols = excluded.visible_cols, sort_col = excluded.sort_col, sort_dir = excluded.sort_dir`,
    args: [fingerprint, tableName, JSON.stringify(visibleCols), sortCol, sortDir],
  });
}

// ── Table & column policies ─────────────────────────────────────────────────

const DEFAULT_TABLE_POLICY = { can_view: true, can_insert: true, can_update: true, can_delete: true };

export async function getUserTablePolicy(
  userId: number,
  tableName: string
): Promise<{ can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }> {
  const fingerprint = getDbFingerprint();
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
  tableName: string
): Promise<Record<string, { hidden: boolean; read_only: boolean }>> {
  const fingerprint = getDbFingerprint();
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

export async function getTablePoliciesForTable(tableName: string): Promise<
  { user_id: number; can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }[]
> {
  const fingerprint = getDbFingerprint();
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

export async function getColumnPoliciesForTable(tableName: string): Promise<
  { user_id: number; column_name: string; hidden: boolean; read_only: boolean }[]
> {
  const fingerprint = getDbFingerprint();
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
  policy: { can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }
): Promise<void> {
  const fingerprint = getDbFingerprint();
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
  policy: { hidden: boolean; read_only: boolean }
): Promise<void> {
  const fingerprint = getDbFingerprint();
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

export async function exportAllSettings(): Promise<{
  fk_display: { table_name: string; column_name: string; display_field: string }[];
  field_encryption: { table_name: string; column_name: string; algorithm: string; salt_column: string | null }[];
  view_settings: { table_name: string; visible_cols: string[]; sort_col: string; sort_dir: string }[];
  table_policies: { user_id: number; username: string; table_name: string; can_view: boolean; can_insert: boolean; can_update: boolean; can_delete: boolean }[];
  column_policies: { user_id: number; username: string; table_name: string; column_name: string; hidden: boolean; read_only: boolean }[];
}> {
  const fingerprint = getDbFingerprint();
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
}): Promise<{ skipped_users: string[] }> {
  const fingerprint = getDbFingerprint();
  const c = await db();

  // Clear existing settings for this fingerprint
  await c.execute({ sql: "DELETE FROM fk_display_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM field_encryption_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM table_view_settings WHERE db_fingerprint = ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM table_policies WHERE db_fingerprint = ?", args: [fingerprint] });
  await c.execute({ sql: "DELETE FROM column_policies WHERE db_fingerprint = ?", args: [fingerprint] });

  for (const r of backup.fk_display ?? []) {
    await c.execute({ sql: "INSERT INTO fk_display_settings (db_fingerprint, table_name, column_name, display_field) VALUES (?,?,?,?)", args: [fingerprint, r.table_name, r.column_name, r.display_field] });
  }
  for (const r of backup.field_encryption ?? []) {
    await c.execute({ sql: "INSERT INTO field_encryption_settings (db_fingerprint, table_name, column_name, algorithm, salt_column) VALUES (?,?,?,?,?)", args: [fingerprint, r.table_name, r.column_name, r.algorithm, r.salt_column ?? null] });
  }
  for (const r of backup.view_settings ?? []) {
    await c.execute({ sql: "INSERT INTO table_view_settings (db_fingerprint, table_name, visible_cols, sort_col, sort_dir) VALUES (?,?,?,?,?)", args: [fingerprint, r.table_name, JSON.stringify(r.visible_cols), r.sort_col, r.sort_dir] });
  }

  // Resolve usernames to IDs for policy rows
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
