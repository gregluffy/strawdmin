import type { Schema, SchemaTable, Column, DbType } from "./types";
import { getDriver, getDbName } from "./drivers";

let cachedSchema: Schema | null = null;

export function clearSchemaCache(): void {
  cachedSchema = null;
}

export async function introspect(): Promise<Schema> {
  if (cachedSchema) return cachedSchema;

  const type = (process.env.DB_TYPE ?? "sqlite") as DbType;
  const driver = getDriver();

  let tables: SchemaTable[];
  switch (type) {
    case "postgres":
      tables = await introspectPostgres(driver);
      break;
    case "mysql":
    case "mariadb":
      tables = await introspectMysql(driver);
      break;
    case "mssql":
      tables = await introspectMssql(driver);
      break;
    case "sqlite":
      tables = await introspectSqlite(driver);
      break;
    default:
      throw new Error(`Unsupported DB_TYPE: ${type}`);
  }

  cachedSchema = { tables, dbName: getDbName() };
  return cachedSchema;
}

export async function getTable(name: string): Promise<SchemaTable | null> {
  const schema = await introspect();
  return schema.tables.find((t) => t.name === name) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function introspectPostgres(driver: any): Promise<SchemaTable[]> {
  type PgCol = {
    table_name: string; column_name: string; data_type: string;
    is_nullable: string; column_default: string | null; is_identity: string;
  };
  type PkRow = { table_name: string; column_name: string };
  type FkRow = { table_name: string; column_name: string; foreign_table_name: string; foreign_column_name: string };
  type SizeRow = { table_name: string; size_bytes: string | number };

  const colRows = (await driver.query(
    `SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default, c.is_identity
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON c.table_name = t.table_name AND c.table_schema = t.table_schema
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
     ORDER BY c.table_name, c.ordinal_position`
  )) as PgCol[];

  const pkRows = (await driver.query(
    `SELECT kcu.table_name, kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'`
  )) as PkRow[];

  const fkRows = (await driver.query(
    `SELECT
       kcu.table_name, kcu.column_name,
       ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
  )) as FkRow[];

  const sizeMap = new Map<string, number>();
  try {
    const sizeRows = (await driver.query(
      `SELECT relname AS table_name, pg_total_relation_size(relid) AS size_bytes
       FROM pg_catalog.pg_statio_user_tables`
    )) as SizeRow[];
    for (const r of sizeRows) sizeMap.set(r.table_name, Number(r.size_bytes));
  } catch {
    // size info unavailable (e.g. missing pg_statio_user_tables permission)
  }

  const pkSet = new Set(pkRows.map((r) => `${r.table_name}.${r.column_name}`));
  const fkMap = new Map<string, { table: string; column: string }>();
  for (const r of fkRows) {
    fkMap.set(`${r.table_name}.${r.column_name}`, {
      table: r.foreign_table_name,
      column: r.foreign_column_name,
    });
  }

  const tableMap = new Map<string, Column[]>();
  for (const r of colRows) {
    const key = `${r.table_name}.${r.column_name}`;
    const col: Column = {
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === "YES",
      isPrimary: pkSet.has(key),
      isAutoIncrement: r.is_identity === "YES" || (r.column_default?.includes("nextval") ?? false),
      isJson: r.data_type === "json" || r.data_type === "jsonb",
      fk: fkMap.get(key),
      defaultValue: r.column_default,
    };
    if (!tableMap.has(r.table_name)) tableMap.set(r.table_name, []);
    tableMap.get(r.table_name)!.push(col);
  }

  return buildTables(tableMap, sizeMap);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function introspectMysql(driver: any): Promise<SchemaTable[]> {
  type DbRow = { db: string };
  type MysqlCol = {
    TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string;
    IS_NULLABLE: string; COLUMN_DEFAULT: string | null; EXTRA: string; COLUMN_KEY: string;
  };
  type MysqlFk = {
    TABLE_NAME: string; COLUMN_NAME: string;
    REFERENCED_TABLE_NAME: string; REFERENCED_COLUMN_NAME: string;
  };
  type SizeRow = { table_name: string; size_bytes: string | number };

  const dbName = (await driver.query("SELECT DATABASE() as db")) as DbRow[];
  const currentDb = dbName[0]?.db ?? "";

  const colRows = (await driver.query(
    `SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, c.EXTRA, c.COLUMN_KEY
     FROM information_schema.COLUMNS c
     JOIN information_schema.TABLES t
       ON c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_SCHEMA = t.TABLE_SCHEMA
     WHERE c.TABLE_SCHEMA = ? AND t.TABLE_TYPE = 'BASE TABLE'
     ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    [currentDb]
  )) as MysqlCol[];

  const fkRows = (await driver.query(
    `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL`,
    [currentDb]
  )) as MysqlFk[];

  const sizeMap = new Map<string, number>();
  try {
    const sizeRows = (await driver.query(
      `SELECT TABLE_NAME AS table_name, DATA_LENGTH + INDEX_LENGTH AS size_bytes
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE()`
    )) as SizeRow[];
    for (const r of sizeRows) sizeMap.set(r.table_name, Number(r.size_bytes));
  } catch {
    // size info unavailable
  }

  const fkMap = new Map<string, { table: string; column: string }>();
  for (const r of fkRows) {
    fkMap.set(`${r.TABLE_NAME}.${r.COLUMN_NAME}`, {
      table: r.REFERENCED_TABLE_NAME,
      column: r.REFERENCED_COLUMN_NAME,
    });
  }

  const tableMap = new Map<string, Column[]>();
  for (const r of colRows) {
    const key = `${r.TABLE_NAME}.${r.COLUMN_NAME}`;
    const col: Column = {
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      nullable: r.IS_NULLABLE === "YES",
      isPrimary: r.COLUMN_KEY === "PRI",
      isAutoIncrement: r.EXTRA?.includes("auto_increment") ?? false,
      isJson: r.DATA_TYPE === "json",
      fk: fkMap.get(key),
      defaultValue: r.COLUMN_DEFAULT,
    };
    if (!tableMap.has(r.TABLE_NAME)) tableMap.set(r.TABLE_NAME, []);
    tableMap.get(r.TABLE_NAME)!.push(col);
  }

  return buildTables(tableMap, sizeMap);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function introspectMssql(driver: any): Promise<SchemaTable[]> {
  type MssqlCol = {
    TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string;
    IS_NULLABLE: string; COLUMN_DEFAULT: string | null; CHARACTER_MAXIMUM_LENGTH: number | null;
  };
  type MssqlPk = { TABLE_NAME: string; COLUMN_NAME: string };
  type MssqlFk = { TABLE_NAME: string; COLUMN_NAME: string; REFERENCED_TABLE: string; REFERENCED_COLUMN: string };
  type MssqlId = { TABLE_NAME: string; COLUMN_NAME: string };
  type SizeRow = { table_name: string; size_bytes: string | number };

  const colRows = (await driver.query(
    `SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, c.CHARACTER_MAXIMUM_LENGTH
     FROM INFORMATION_SCHEMA.COLUMNS c
     JOIN INFORMATION_SCHEMA.TABLES t
       ON c.TABLE_NAME = t.TABLE_NAME AND c.TABLE_SCHEMA = t.TABLE_SCHEMA
     WHERE c.TABLE_SCHEMA = 'dbo' AND t.TABLE_TYPE = 'BASE TABLE'
     ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`
  )) as MssqlCol[];

  const pkRows = (await driver.query(
    `SELECT kcu.TABLE_NAME, kcu.COLUMN_NAME
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
       ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_SCHEMA = 'dbo'`
  )) as MssqlPk[];

  const fkRows = (await driver.query(
    `SELECT
       fkc.TABLE_NAME, fkc.COLUMN_NAME,
       pkc.TABLE_NAME AS REFERENCED_TABLE, pkc.COLUMN_NAME AS REFERENCED_COLUMN
     FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE fkc ON rc.CONSTRAINT_NAME = fkc.CONSTRAINT_NAME
     JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE pkc ON rc.UNIQUE_CONSTRAINT_NAME = pkc.CONSTRAINT_NAME`
  )) as MssqlFk[];

  const identityRows = (await driver.query(
    `SELECT OBJECT_NAME(object_id) AS TABLE_NAME, name AS COLUMN_NAME
     FROM sys.columns WHERE is_identity = 1`
  )) as MssqlId[];

  const sizeMap = new Map<string, number>();
  try {
    const sizeRows = (await driver.query(
      `SELECT t.name AS table_name, SUM(a.total_pages) * 8192 AS size_bytes
       FROM sys.tables t
       JOIN sys.indexes i ON t.object_id = i.object_id
       JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
       JOIN sys.allocation_units a ON p.partition_id = a.container_id
       WHERE t.is_ms_shipped = 0
       GROUP BY t.name`
    )) as SizeRow[];
    for (const r of sizeRows) sizeMap.set(r.table_name, Number(r.size_bytes));
  } catch {
    // size info unavailable
  }

  const pkSet = new Set(pkRows.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
  const identitySet = new Set(identityRows.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
  const fkMap = new Map<string, { table: string; column: string }>();
  for (const r of fkRows) {
    fkMap.set(`${r.TABLE_NAME}.${r.COLUMN_NAME}`, {
      table: r.REFERENCED_TABLE,
      column: r.REFERENCED_COLUMN,
    });
  }

  const tableMap = new Map<string, Column[]>();
  for (const r of colRows) {
    const key = `${r.TABLE_NAME}.${r.COLUMN_NAME}`;
    const isMaxLen = r.CHARACTER_MAXIMUM_LENGTH === -1;
    const colLower = r.COLUMN_NAME.toLowerCase();
    const isJson =
      (r.DATA_TYPE === "nvarchar" && isMaxLen && colLower.includes("json")) ||
      r.DATA_TYPE === "xml";

    const col: Column = {
      name: r.COLUMN_NAME,
      type: r.DATA_TYPE,
      nullable: r.IS_NULLABLE === "YES",
      isPrimary: pkSet.has(key),
      isAutoIncrement: identitySet.has(key),
      isJson,
      fk: fkMap.get(key),
      defaultValue: r.COLUMN_DEFAULT,
    };
    if (!tableMap.has(r.TABLE_NAME)) tableMap.set(r.TABLE_NAME, []);
    tableMap.get(r.TABLE_NAME)!.push(col);
  }

  return buildTables(tableMap, sizeMap);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function introspectSqlite(driver: any): Promise<SchemaTable[]> {
  type SqliteTable = { name: string };
  type SqliteCol = { name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
  type SqliteFk = { from: string; table: string; to: string };
  type SizeRow = { table_name: string; size_bytes: string | number };

  const tablesResult = (await driver.query(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
  )) as SqliteTable[];

  const tableMap = new Map<string, Column[]>();

  for (const { name: tableName } of tablesResult) {
    const cols = (await driver.query(`PRAGMA table_info("${tableName}")`)) as SqliteCol[];
    const fks = (await driver.query(`PRAGMA foreign_key_list("${tableName}")`)) as SqliteFk[];

    const fkMap = new Map<string, { table: string; column: string }>();
    for (const fk of fks) {
      fkMap.set(fk.from, { table: fk.table, column: fk.to });
    }

    const pkCols = cols.filter((c) => c.pk > 0);
    const isRowidAuto = pkCols.length === 1 && pkCols[0].type.toUpperCase().includes("INT");

    const columns: Column[] = cols.map((c) => {
      const typeLower = (c.type ?? "").toLowerCase();
      const nameLower = c.name.toLowerCase();
      const isJson =
        typeLower === "json" ||
        typeLower === "jsonb" ||
        nameLower.endsWith("_json") ||
        nameLower.endsWith("_data") ||
        nameLower === "metadata" ||
        nameLower === "payload";
      return {
        name: c.name,
        type: c.type || "TEXT",
        nullable: c.notnull === 0 && c.pk === 0,
        isPrimary: c.pk > 0,
        isAutoIncrement: c.pk > 0 && isRowidAuto,
        isJson,
        fk: fkMap.get(c.name),
        defaultValue: c.dflt_value,
      };
    });

    tableMap.set(tableName, columns);
  }

  const sizeMap = new Map<string, number>();
  try {
    const sizeRows = (await driver.query(
      `SELECT name AS table_name, SUM(pgsize) AS size_bytes FROM dbstat GROUP BY name`
    )) as SizeRow[];
    for (const r of sizeRows) sizeMap.set(r.table_name, Number(r.size_bytes));
  } catch {
    // dbstat virtual table not available
  }

  return buildTables(tableMap, sizeMap);
}

function buildTables(tableMap: Map<string, Column[]>, sizeMap?: Map<string, number>): SchemaTable[] {
  const tables: SchemaTable[] = [];
  for (const [name, columns] of tableMap) {
    const pk = columns.find((c) => c.isPrimary)?.name ?? columns[0]?.name ?? "id";
    const sizeBytes = sizeMap?.get(name);
    tables.push({ name, columns, primaryKey: pk, ...(sizeBytes != null && { sizeBytes }) });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}
