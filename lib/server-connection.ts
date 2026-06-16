import { cookies } from "next/headers";
import type { DbConnection, DbType } from "./types";
import { listDbConnections, getDbConnection, createDbConnection } from "./internal-db";

export async function getServerActiveConnection(): Promise<DbConnection | null> {
  const cookieStore = await cookies();
  const activeIdStr = cookieStore.get("active_db_id")?.value;

  if (activeIdStr) {
    const id = parseInt(activeIdStr);
    if (!isNaN(id)) {
      const conn = await getDbConnection(id);
      if (conn) return conn;
    }
  }

  const dbType = process.env.DB_TYPE;
  const connStr = process.env.DB_CONNECTION_STRING;
  if (dbType && connStr) {
    const existing = await listDbConnections();
    if (existing.length === 0) {
      const conn = await createDbConnection("Default", dbType as DbType, connStr);
      return conn;
    }
  }

  const connections = await listDbConnections();
  if (connections.length === 1) return connections[0];

  return null;
}
