import type { NextRequest } from "next/server";
import type { DbConnection, DbType } from "./types";
import { listDbConnections, getDbConnection, createDbConnection } from "./internal-db";

export async function getActiveConnection(req: NextRequest): Promise<DbConnection | null> {
  const activeIdStr = req.cookies.get("active_db_id")?.value;

  if (activeIdStr) {
    const id = parseInt(activeIdStr);
    if (!isNaN(id)) {
      const conn = await getDbConnection(id);
      if (conn) return conn;
    }
  }

  // Migration: if env vars are set and no connections exist yet, auto-create one
  const dbType = process.env.DB_TYPE;
  const connStr = process.env.DB_CONNECTION_STRING;
  if (dbType && connStr) {
    const existing = await listDbConnections();
    if (existing.length === 0) {
      const conn = await createDbConnection("Default", dbType as DbType, connStr);
      return conn;
    }
  }

  // Fall back to the only connection if there's exactly one
  const connections = await listDbConnections();
  if (connections.length === 1) return connections[0];

  return null;
}
