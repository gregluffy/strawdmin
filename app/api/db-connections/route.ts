import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { listDbConnections, createDbConnection } from "@/lib/internal-db";
import { getActiveConnection } from "@/lib/active-connection";
import type { DbType } from "@/lib/types";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const connections = await listDbConnections();
    const activeConn = await getActiveConnection(req);

    return NextResponse.json({
      connections: connections.map((c) => ({
        id: c.id,
        name: c.name,
        db_type: c.db_type,
        connection_string: user.role === "admin" ? c.connection_string : undefined,
        created_at: c.created_at,
        is_active: activeConn?.id === c.id,
      })),
      active_id: activeConn?.id ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { name, db_type, connection_string } = await req.json();
    if (!name || !db_type || !connection_string) {
      return NextResponse.json({ error: "Missing name, db_type, or connection_string" }, { status: 400 });
    }
    const validTypes: DbType[] = ["postgres", "mysql", "mariadb", "mssql", "sqlite"];
    if (!validTypes.includes(db_type)) {
      return NextResponse.json({ error: "Invalid db_type" }, { status: 400 });
    }
    const conn = await createDbConnection(name.trim(), db_type as DbType, connection_string.trim());
    return NextResponse.json(conn, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
