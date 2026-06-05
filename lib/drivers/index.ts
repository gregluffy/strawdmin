import type { DbType } from "../types";

export interface DbDriver {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
  quote(identifier: string): string;
  placeholder(index: number): string;
  dbType: string;
}

export function getDbName(): string {
  const type = (process.env.DB_TYPE ?? "sqlite").trim().toLowerCase() as DbType;
  const connStr = process.env.DB_CONNECTION_STRING ?? "";
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

let cachedDriver: DbDriver | null = null;

export function getDriver(): DbDriver {
  if (cachedDriver) return cachedDriver;

  const type = (process.env.DB_TYPE ?? "sqlite").trim().toLowerCase() as DbType;
  const connStr = process.env.DB_CONNECTION_STRING ?? "";

  switch (type) {
    case "postgres":
      cachedDriver = createPostgresDriver(connStr);
      break;
    case "mysql":
    case "mariadb":
      cachedDriver = createMysqlDriver(connStr);
      break;
    case "mssql":
      cachedDriver = createMssqlDriver(connStr);
      break;
    case "sqlite":
      cachedDriver = createSqliteDriver(connStr);
      break;
    default:
      throw new Error(`Unsupported DB_TYPE: ${type}`);
  }

  return cachedDriver;
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
  // mysql2 only accepts mysql:// scheme — normalize mariadb:// if present
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
