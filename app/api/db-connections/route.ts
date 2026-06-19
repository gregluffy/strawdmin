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
        is_active: activeConn?.id === c.id,
        is_pinned: c.is_pinned ?? false,
        created_at: c.created_at,
        // SSH config — never expose credentials, only expose whether they exist
        ssh_enabled: c.ssh_enabled ?? false,
        ssh_host: user.role === "admin" ? (c.ssh_host ?? null) : undefined,
        ssh_port: user.role === "admin" ? (c.ssh_port ?? 22) : undefined,
        ssh_user: user.role === "admin" ? (c.ssh_user ?? null) : undefined,
        ssh_auth_type: user.role === "admin" ? (c.ssh_auth_type ?? "password") : undefined,
        has_ssh_private_key: user.role === "admin" ? c.ssh_private_key != null : undefined,
        has_ssh_password: user.role === "admin" ? c.ssh_password != null : undefined,
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
    const body = await req.json();
    const { name, db_type, connection_string } = body;
    if (!name || !db_type || !connection_string) {
      return NextResponse.json({ error: "Missing name, db_type, or connection_string" }, { status: 400 });
    }
    const validTypes: DbType[] = ["postgres", "mysql", "mariadb", "mssql", "sqlite"];
    if (!validTypes.includes(db_type)) {
      return NextResponse.json({ error: "Invalid db_type" }, { status: 400 });
    }
    const conn = await createDbConnection(name.trim(), db_type as DbType, connection_string.trim(), {
      ssh_enabled: Boolean(body.ssh_enabled),
      ssh_host: body.ssh_host || null,
      ssh_port: body.ssh_port ? Number(body.ssh_port) : null,
      ssh_user: body.ssh_user || null,
      ssh_auth_type: body.ssh_auth_type || null,
      ssh_password: body.ssh_password || null,
      ssh_private_key: body.ssh_private_key || null,
      ssh_passphrase: body.ssh_passphrase || null,
    });
    // Don't return credentials in response
    const { ssh_password: _p, ssh_private_key: _k, ssh_passphrase: _pp, ...safe } = conn;
    void _p; void _k; void _pp;
    return NextResponse.json(safe, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
