import type { DbType, DbConnection } from "../types";
import { ensureTunnel, closeTunnel, rewriteForTunnel, openTunnel, parseDbTarget } from "../ssh-tunnel";
import type { SshConfig } from "../ssh-tunnel";

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
      // Avoid new URL() so passwords containing @, #, ?, / don't break parsing.
      const schemeEnd = connStr.indexOf("://");
      const afterScheme = schemeEnd !== -1 ? connStr.slice(schemeEnd + 3) : connStr;
      const atIdx = afterScheme.lastIndexOf("@");
      const fromHost = atIdx !== -1 ? afterScheme.slice(atIdx + 1) : afterScheme;
      const slashIdx = fromHost.indexOf("/");
      if (slashIdx === -1) return connStr;
      const dbName = fromHost.slice(slashIdx + 1).split(/[?#]/)[0];
      return dbName || connStr;
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

  // Build a tunnel promise if SSH is enabled — drivers will await it before first query
  let tunnelPromise: Promise<string> | null = null;
  if (conn.ssh_enabled && conn.ssh_host && conn.ssh_user) {
    const sshCfg: SshConfig = {
      host: conn.ssh_host,
      port: conn.ssh_port,
      user: conn.ssh_user,
      auth_type: conn.ssh_auth_type,
      password: conn.ssh_password,
      private_key: conn.ssh_private_key,
      passphrase: conn.ssh_passphrase,
    };
    tunnelPromise = ensureTunnel(conn.id, sshCfg, type, connStr, () => {
      // SSH connection dropped — evict driver so the next query gets a fresh one
      driverCache.delete(conn.id);
    }).then((h) => rewriteForTunnel(type, connStr, h.localPort));
  }

  let driver: DbDriver;

  switch (type) {
    case "postgres":
      driver = createPostgresDriver(connStr, tunnelPromise);
      break;
    case "mysql":
    case "mariadb":
      driver = createMysqlDriver(connStr, tunnelPromise);
      break;
    case "mssql":
      driver = createMssqlDriver(connStr, tunnelPromise);
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
  closeTunnel(connId);
}

export function createTempDriver(dbType: string, connStr: string): DbDriver {
  switch (dbType) {
    case "postgres": return createPostgresDriver(connStr, null);
    case "mysql":
    case "mariadb": return createMysqlDriver(connStr, null);
    case "mssql": return createMssqlDriver(connStr, null);
    case "sqlite": return createSqliteDriver(connStr);
    default: throw new Error(`Unsupported db_type: ${dbType}`);
  }
}

export async function createTempDriverWithSsh(dbType: string, connStr: string, ssh: SshConfig): Promise<{ driver: DbDriver; closeTunnel: () => void }> {
  const { host, port } = parseDbTarget(dbType as DbType, connStr);
  const handle = await openTunnel(ssh, host, port);
  const effectiveConnStr = rewriteForTunnel(dbType, connStr, handle.localPort);
  const driver = createTempDriver(dbType, effectiveConnStr);
  return { driver, closeTunnel: handle.close };
}

function createPostgresDriver(connStr: string, tunnelPromise: Promise<string> | null): DbDriver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg");

  let poolPromise: Promise<ReturnType<typeof Pool>> | null = null;

  const getPool = () => {
    if (!poolPromise) {
      poolPromise = (async () => {
        const effectiveConnStr = tunnelPromise ? await tunnelPromise : connStr;
        const hasSSL = /sslmode=(?!disable)/i.test(effectiveConnStr) || effectiveConnStr.startsWith("https");
        return new Pool({
          connectionString: effectiveConnStr,
          connectionTimeoutMillis: 10000,
          ...(hasSSL && { ssl: { rejectUnauthorized: false } }),
        });
      })();
    }
    return poolPromise;
  };

  return {
    dbType: "postgres",
    quote: (s) => `"${s}"`,
    placeholder: (i) => `$${i + 1}`,
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const pool = await getPool();
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },
    async close() {
      if (poolPromise) {
        const pool = await poolPromise.catch(() => null);
        if (pool) await pool.end().catch(() => {});
      }
    },
  };
}

function createMysqlDriver(connStr: string, tunnelPromise: Promise<string> | null): DbDriver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mysql = require("mysql2/promise");

  let poolPromise: Promise<ReturnType<typeof mysql.createPool>> | null = null;

  const getPool = () => {
    if (!poolPromise) {
      poolPromise = (async () => {
        const effectiveConnStr = tunnelPromise ? await tunnelPromise : connStr;
        const hasSSL = /ssl=true/i.test(effectiveConnStr) || /sslmode=(?!disable)/i.test(effectiveConnStr);
        const uri = effectiveConnStr.replace(/^mariadb:\/\//i, "mysql://");
        return mysql.createPool({ uri, ...(hasSSL && { ssl: { rejectUnauthorized: false } }) });
      })();
    }
    return poolPromise;
  };

  return {
    dbType: "mysql",
    quote: (s) => `\`${s}\``,
    placeholder: () => "?",
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const pool = await getPool();
      const [rows] = await pool.execute(sql, params);
      return rows as T[];
    },
    async close() {
      if (poolPromise) {
        const pool = await poolPromise.catch(() => null);
        if (pool) await pool.end().catch(() => {});
      }
    },
  };
}

function createMssqlDriver(connStr: string, tunnelPromise: Promise<string> | null): DbDriver {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mssql = require("mssql");

  let poolPromise: Promise<typeof mssql.ConnectionPool> | null = null;

  const getPool = () => {
    if (!poolPromise) {
      poolPromise = (async () => {
        const effectiveConnStr = tunnelPromise ? await tunnelPromise : connStr;
        const trustConn = /TrustServerCertificate/i.test(effectiveConnStr)
          ? effectiveConnStr
          : effectiveConnStr.trimEnd().replace(/;?$/, ";TrustServerCertificate=true;Encrypt=true");
        return mssql.connect(trustConn);
      })();
    }
    return poolPromise;
  };

  return {
    dbType: "mssql",
    quote: (s) => `[${s}]`,
    placeholder: (i) => `@p${i}`,
    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      const pool = await getPool();
      const req = pool.request();
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
    async close() {
      await mssql.close().catch(() => {});
    },
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
