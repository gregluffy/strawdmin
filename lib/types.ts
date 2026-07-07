export type DbType = "postgres" | "mysql" | "mariadb" | "mssql" | "sqlite";

export interface DbConnection {
  id: number;
  name: string;
  db_type: DbType;
  connection_string: string;
  created_at: string;
  is_pinned?: boolean;
  ssh_enabled?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_auth_type?: "password" | "key";
  ssh_password?: string;
  ssh_private_key?: string;
  ssh_passphrase?: string;
}

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary: boolean;
  isAutoIncrement: boolean;
  isJson: boolean;
  fk?: { table: string; column: string };
  defaultValue?: string | null;
}

export interface SchemaTable {
  name: string;
  columns: Column[];
  primaryKey: string;
  sizeBytes?: number;
}

export interface Schema {
  tables: SchemaTable[];
  dbName: string;
}

export interface User {
  id: number;
  username: string;
  password_hash: string;
  role: "admin" | "user";
  created_at: string;
}

export interface JwtPayload {
  sub: number;
  username: string;
  role: "admin" | "user";
  iat?: number;
  exp?: number;
}

export interface PaginatedResult {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageSize: number;
}

export type FilterOperator =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "contains" | "not_contains" | "starts_with" | "ends_with"
  | "is_null" | "is_not_null";

export type FilterLogic = "AND" | "OR";

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value: string;
}

// Column types treated as free-text (substring/LIKE-eligible) by search and filters.
// Shared between server (lib/sql.ts) and client (DataTable) so classification stays in sync.
export const TEXTISH_TYPES = ["text", "varchar", "nvarchar", "char", "string"];

export interface BackupMeta {
  name: string;
  size: number;
  createdAt: string;
}

export interface BackupFile {
  created_at: string;
  db_type: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface FkDisplaySetting {
  column_name: string;
  display_path: string[];
}

export interface EncryptionSetting {
  column_name: string;
  algorithm: string;
  salt_column: string | null;
}

export interface TablePolicy {
  can_view: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface ColumnPolicy {
  hidden: boolean;
  read_only: boolean;
}

export interface AuditLog {
  id: number;
  db_fingerprint: string;
  user_id: number | null;
  username: string;
  action: "INSERT" | "UPDATE" | "DELETE" | "LOGIN" | "LOGIN_FAILED";
  table_name: string | null;
  record_id: string | null;
  changes: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  ip: string | null;
  created_at: string;
}
