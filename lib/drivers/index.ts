import type { DbType, DbConnection } from "../types";

export interface DbDriver {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
  quote(identifier: string): string;
  placeholder(index: number): string;
  dbType: string;
}

export function getDbName(conn: DbConnection): string {
  const type = conn.db_type as DbType;
  const connStr = conn.connection_string;
  try {
    if (type === "postgres" || type === "mysql" || type === "mariadb") {
      return new URL(connStr).pathname.replace(/^\//, "") || connStr;
    }
    if (type === "mssql") {
      return connStr.match(/Database=([^;]+)/i)?.[1] ?? connStr;
    }
    if (type === "sqlite") {
      const p = connStr.replace(/^file:/, "");
      return p.split(/[\\/]/).pop()?.replace(/\.db$/i, "") ?? p;
    }
  } catch {
    // fall through
  }
  return connStr;
}

const driverCache = new Map<number, DbDriver>();

export function getDriver(conn: DbConnection): DbDriver {
  if (driverCache.has(conn.id)) return driverCache.get(conn.id)!;

  const type = conn.db_type as DbType;
  const connStr = conn.connection_string;
  let driver: DbDriver;

  switch (type) {
    case "postgres":
      driver = createPostgresDriver(connStr);
      break;
    case "mysql":
    case "mariadb":
      driver = createMysqlDriver(connStr);
      break;
    case "mssql":
      driver = createMssqlDriver(connStr);
      break;
    case "sqlite":
      driver = createSqliteDriver(connStr);
      break;
    default:
      throw new Error(`Unsupported db_type: ${type}`);
  }

  driverCache.set(conn.id, driver);
  return driver;
}

export async function closeDriver(connId: number): Promise<void> {
  const driver = driverCache.get(connId);
  if (driver) {
    try { await driver.close(); } catch { /* ignore */ }
    driverCache.delete(connId);
  }
}

export function createTempDriver(dbType: string, connStr: string): DbDriver {
  switch (dbType) {
    case "postgres": return createPostgresDriver(connStr);
    case "mysql":
    case "mariadb": return createMysqlDriver(connStr);
    case "mssql": return createMssqlDriver(connStr);
    case "sqlite": return createSqliteDriver(connStr);
    default: throw new Error(`Unsupported db_type: ${dbType}`);
  }
}

function createPostgresDriver(connStr: string): DbDriver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg");
  const hasSSL = /sslmode=(?!disable)/i.test(connStr) || connStr.startsWith("https");
  const pool = new Pool({
    connectionString: connStr,
    ...(hasSSL && { ssl: { rejectUnauthorized: false } }),
  });
  return {
    dbType: "postgres",
    quote: (s) => `"${s}"`,
    placeholder: (i) => `$${i + 1}`,
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async close() { await pool.end(); },
  };
}

function createMysqlDriver(connStr: string): DbDriver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mysql = require("mysql2/promise");
  const hasSSL = /ssl=true/i.test(connStr) || /sslmode=(?!disable)/i.test(connStr);
  const uri = connStr.replace(/^mariadb:\/\//i, "mysql://");
  const pool = mysql.createPool({ uri, ...(hasSSL && { ssl: { rejectUnauthorized: false } }) });
  return {
    dbType: "mysql",
    quote: (s) => `\`${s}\``,
    placeholder: () => "?",
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const [rows] = await pool.execute(sql, params);
      return rows as T[];
    },
    async close() { await pool.end(); },
  };
}

function createMssqlDriver(connStr: string): DbDriver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mssql = require("mssql");
  let pool: typeof mssql.ConnectionPool | null = null;
  const trustConn = /TrustServerCertificate/i.test(connStr)
    ? connStr
    : connStr.trimEnd().replace(/;?$/, ";TrustServerCertificate=true;Encrypt=true");
  const getPool = async () => {
    if (!pool) pool = await mssql.connect(trustConn);
    return pool;
  };
  return {
    dbType: "mssql",
    quote: (s) => `[${s}]`,
    placeholder: (i) => `@p${i}`,
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const p = await getPool();
      const req = p.request();
      if (params) {
        params.forEach((v, i) => req.input(`p${i}`, v));
        let paramSql = sql;
        params.forEach((_, i) => { paramSql = paramSql.replace("?", `@p${i}`); });
        const result = await req.query(paramSql);
        return result.recordset as T[];
      }
      const result = await req.query(sql);
      return result.recordset as T[];
    },
    async close() { await mssql.close(); },
  };
}

function createSqliteDriver(connStr: string): DbDriver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  const client = createClient({
    url: connStr.startsWith("file:") ? connStr : `file:${connStr}`,
  });
  return {
    dbType: "sqlite",
    quote: (s) => `"${s}"`,
    placeholder: () => "?",
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await client.execute({ sql, args: params ?? [] });
      return result.rows as T[];
    },
    async close() { client.close(); },
  };
}
