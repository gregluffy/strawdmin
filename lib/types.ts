export type DbType = "postgres" | "mysql" | "mariadb" | "mssql" | "sqlite";

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
  display_field: string;
}

export interface EncryptionSetting {
  column_name: string;
  algorithm: string;
  salt_column: string | null;
}
