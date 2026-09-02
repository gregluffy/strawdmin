import type { DbConnection, DbType } from "./types";
import { listDbConnections, getDbConnection, createDbConnection, getUserDbAccess } from "./internal-db";

/**
 * Resolves which connection a request should operate on, honouring the requesting
 * user's DB access grants. Shared by the route-handler (`lib/active-connection.ts`)
 * and server-component (`lib/server-connection.ts`) entry points so that a user can
 * never reach a connection an admin has hidden from them — not via the `active_db_id`
 * cookie, and not via the single-connection fallback.
 *
 * `userId` of null means "no identified user" and is treated as unrestricted; every
 * caller sits behind an auth check already.
 */
export async function resolveActiveConnection(
  activeIdStr: string | undefined,
  userId: number | null
): Promise<DbConnection | null> {
  const access = userId != null ? await getUserDbAccess(userId) : { mode: "all" as const, conn_ids: [] };
  const restricted = access.mode === "restricted";
  const allowedIds = new Set(access.conn_ids);
  const isAllowed = (id: number) => !restricted || allowedIds.has(id);

  if (activeIdStr) {
    const id = parseInt(activeIdStr);
    if (!isNaN(id)) {
      const conn = await getDbConnection(id);
      if (conn && isAllowed(conn.id)) return conn;
    }
  }

  // Migration: if env vars are set and no connections exist yet, auto-create one
  const dbType = process.env.DB_TYPE;
  const connStr = process.env.DB_CONNECTION_STRING;
  if (dbType && connStr) {
    const existing = await listDbConnections();
    if (existing.length === 0) {
      const conn = await createDbConnection("Default", dbType as DbType, connStr);
      return isAllowed(conn.id) ? conn : null;
    }
  }

  const connections = (await listDbConnections()).filter((c) => isAllowed(c.id));
  // Fall back to the only connection if there's exactly one
  if (connections.length === 1) return connections[0];
  // A restricted user's cookie may point at a connection they can no longer see —
  // land them on one they can rather than on an empty dashboard.
  if (restricted && connections.length > 0) return connections[0];

  return null;
}
