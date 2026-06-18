import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { updateDbConnection, deleteDbConnection } from "@/lib/internal-db";
import { closeDriver } from "@/lib/drivers";
import { clearSchemaCache } from "@/lib/introspect";
import type { DbType } from "@/lib/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const connId = parseInt(id);
  if (isNaN(connId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const body = await req.json();
    const { name, db_type, connection_string } = body;

    const updates: Parameters<typeof updateDbConnection>[1] = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (db_type !== undefined) {
      const validTypes: DbType[] = ["postgres", "mysql", "mariadb", "mssql", "sqlite"];
      if (!validTypes.includes(db_type)) return NextResponse.json({ error: "Invalid db_type" }, { status: 400 });
      updates.db_type = db_type as DbType;
    }
    if (connection_string !== undefined) updates.connection_string = String(connection_string).trim();

    // SSH fields — always update if present in body
    if (body.ssh_enabled !== undefined) updates.ssh_enabled = Boolean(body.ssh_enabled);
    if (body.ssh_host !== undefined) updates.ssh_host = body.ssh_host || null;
    if (body.ssh_port !== undefined) updates.ssh_port = body.ssh_port ? Number(body.ssh_port) : null;
    if (body.ssh_user !== undefined) updates.ssh_user = body.ssh_user || null;
    if (body.ssh_auth_type !== undefined) updates.ssh_auth_type = body.ssh_auth_type || null;
    // Credentials: only update if explicitly sent (non-undefined)
    if (body.ssh_password !== undefined) updates.ssh_password = body.ssh_password || null;
    if (body.ssh_private_key !== undefined) updates.ssh_private_key = body.ssh_private_key || null;
    if (body.ssh_passphrase !== undefined) updates.ssh_passphrase = body.ssh_passphrase || null;

    const ok = await updateDbConnection(connId, updates);
    if (!ok) return NextResponse.json({ error: "Connection not found or nothing to update" }, { status: 404 });

    await closeDriver(connId);
    clearSchemaCache(connId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const connId = parseInt(id);
  if (isNaN(connId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const ok = await deleteDbConnection(connId);
    if (!ok) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    await closeDriver(connId);
    clearSchemaCache(connId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
